import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveBootstrapPaths } from "../../client/src/bootstrap-paths.ts";
import { GongpilClientBootstrap } from "../../client/src/client-bootstrap.ts";
import { GongpilCoreProcessManager } from "../../client/src/core-process-manager.ts";
import {
  GongpilOpenAiResponsesAdapter,
  GongpilOpenAiResponsesError,
} from "../../platform/network-runtime/src/external/openai-responses-adapter.ts";

const APP_ROOT = process.cwd();
const CORE_ENTRY_PATH = join(APP_ROOT, "core", "src", "core-process.ts");
const TEST_API_KEY = ["sk", "test_abcdefghijklmnopqrstuvwxyz"].join("-");

test("OpenAI 스트리밍 응답을 승인 전 제안으로 저장하고 승인 뒤 문서에 적용한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-ai-e2e-"));
  const dataRoot = join(testRoot, "data");
  const envFile = join(testRoot, ".env.local");
  await writeFile(envFile, `OPENAI_API_KEY=${TEST_API_KEY}\n`, "utf8");
  let receivedAuthorization = "";
  let receivedBody: Record<string, unknown> | undefined;
  const mockServer = createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization ?? "";
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    receivedBody = JSON.parse(body) as Record<string, unknown>;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "x-request-id": "req-provider-test",
    });
    const frames = [
      { type: "response.created", response: { id: "resp-test" } },
      { type: "response.output_text.delta", delta: "수정안을 " },
      { type: "response.output_text.delta", delta: "준비했습니다." },
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: "call-test",
          name: "propose_document",
          arguments: JSON.stringify({
            action: "replace",
            path: "ignored.md",
            content: "긴장감이 높아진 수정 본문",
            summary: "장면의 긴장감을 높였습니다.",
          }),
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp-test",
          usage: {
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 200 },
            output_tokens: 100,
            output_tokens_details: { reasoning_tokens: 20 },
          },
        },
      },
    ];
    for (const frame of frames) {
      response.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  mockServer.listen(0, "127.0.0.1");
  await once(mockServer, "listening");
  const address = mockServer.address();
  assert.ok(address !== null && typeof address !== "string");

  const manager = new GongpilCoreProcessManager({
    coreEntryPath: CORE_ENTRY_PATH,
    coreEnvironment: {
      GONGPIL_OPENAI_ENV_FILE: envFile,
      GONGPIL_OPENAI_MODEL: "gpt-5.6-terra",
      GONGPIL_OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    },
  });
  const bootstrap = new GongpilClientBootstrap(manager);
  const sessionId = "session-ai-e2e";
  const config: GongpilClientBootstrapConfig = {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: "launch-ai-e2e",
    sessionId,
    mode: "installed",
    clientVersion: "0.1.0",
    selectedCoreVersion: "0.1.0",
    supportedCoreProtocol: { major: 1, minMinor: 0, maxMinor: 0 },
    paths: ResolveBootstrapPaths({
      mode: "installed",
      sessionId,
      appRoot: APP_ROOT,
      installedDataRoot: dataRoot,
      bundledRuntimePath: process.execPath,
    }),
    activation: { reason: "startup", requireHealthCheck: true },
  };

  try {
    await bootstrap.ActivateCore(config);
    const runtime = bootstrap.GetNetworkRuntime();
    const events: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
    runtime.Subscribe((event) => events.push(event as typeof events[number]));
    const projectResult = await runtime.Send("project.create", { name: "AI 공동 집필" });
    const project = projectResult.payload?.project as { projectId: string };
    const personaWorkspaceResult = await runtime.Send("persona.workspace.read", {
      projectId: project.projectId,
    });
    const defaultPersonaId = personaWorkspaceResult.payload?.workspace.personas[0].personaId as string;
    const personaVersionResult = await runtime.Send("persona.version.create", {
      projectId: project.projectId,
      personaId: defaultPersonaId,
      name: "긴장감 편집자",
      systemInstructions: "장면의 긴장 구조를 우선 검토한다.",
      workStyle: "선택한 근거만 사용한다.",
      styleGuide: "감각적인 한국어",
      forbiddenExpressions: ["명백히"],
      referencePriorities: ["명시 선택 청크"],
    });
    assert.equal(personaVersionResult.state, "succeeded");
    const documentResult = await runtime.Send("document.create", {
      projectId: project.projectId,
      path: "draft/scene.md",
      content: "# 선택 장면\n기존 본문\n\n# 제외 장면\n전달하지 않을 내용",
    });
    const original = documentResult.payload?.document as { revision: string };
    const chunkListResult = await runtime.Send("chunk.list", {
      projectId: project.projectId,
      documentPath: "draft/scene.md",
    });
    const selectedChunk = chunkListResult.payload?.chunks[0] as { chunkId: string };

    const chatResult = await runtime.Send("chat.message.send", {
      projectId: project.projectId,
      documentPath: "draft/scene.md",
      chunkIds: [selectedChunk.chunkId],
      message: "긴장감을 높여줘",
    });
    assert.equal(chatResult.state, "succeeded", JSON.stringify(chatResult.error));
    const proposal = chatResult.payload?.proposal as {
      proposalId: string;
      path: string;
      status: string;
      expectedRevision: string;
    };
    assert.equal(proposal.path, "draft/scene.md");
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.expectedRevision, original.revision);
    assert.equal(receivedAuthorization, `Bearer ${TEST_API_KEY}`);
    assert.equal(receivedBody?.model, "gpt-5.6-terra");
    assert.equal(receivedBody?.stream, true);
    assert.match(String(receivedBody?.instructions), /긴장감 편집자 v2/);
    assert.match(String(receivedBody?.instructions), /장면의 긴장 구조를 우선 검토한다/);
    assert.match(String(receivedBody?.input), /선택 장면/);
    assert.doesNotMatch(String(receivedBody?.input), /전달하지 않을 내용/);
    await WaitFor(() => events.some((event) => event.eventName === "proposal.created"));
    assert.ok(events.some((event) => event.eventName === "chat.message.delta"));
    assert.ok(events.some((event) => event.eventName === "proposal.created"));

    const beforeApply = await runtime.Send("document.read", {
      projectId: project.projectId,
      path: "draft/scene.md",
    });
    assert.equal(beforeApply.payload?.document.content, "# 선택 장면\n기존 본문\n\n# 제외 장면\n전달하지 않을 내용");

    const applyResult = await runtime.Send("proposal.apply", {
      projectId: project.projectId,
      proposalId: proposal.proposalId,
    });
    assert.equal(applyResult.state, "succeeded");
    assert.equal(applyResult.payload?.document.content, "긴장감이 높아진 수정 본문");
    const sessionResult = await runtime.Send("chat.session.read", { projectId: project.projectId });
    assert.equal(sessionResult.payload?.configured, true);
    assert.equal(sessionResult.payload?.session.messages.length, 2);
    assert.equal(sessionResult.payload?.session.messages[0].contextSnapshot.persona.version, 2);
    assert.equal(sessionResult.payload?.session.messages[0].contextSnapshot.sources.length, 1);
    assert.equal(sessionResult.payload?.session.messages[0].contextSnapshot.sources[0].revision, original.revision);
    assert.equal(sessionResult.payload?.session.messages[0].contextSnapshot.sources[0].content.includes("선택 장면"), true);
    assert.equal(sessionResult.payload?.session.messages[1].inReplyToMessageId, sessionResult.payload?.session.messages[0].messageId);
    assert.equal(sessionResult.payload?.session.proposals[0].status, "applied");
    const usageResult = await runtime.Send("ai.usage.read", {});
    assert.deepEqual(usageResult.payload?.latest, {
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 100,
      reasoningOutputTokens: 20,
      estimatedCostUsd: 0.00355,
      pricingLabel: "openai-standard-estimate",
      pricingSource: "https://developers.openai.com/api/docs/models/compare",
    });

    const firstUserMessageId = sessionResult.payload?.session.messages[0].messageId as string;
    const classificationResult = await runtime.Send("chat.message.classification.update", {
      projectId: project.projectId,
      messageId: firstUserMessageId,
      classification: { topic: "긴장감", task: "장면 퇴고", session: "첫 작업", labels: ["중요"] },
    });
    assert.equal(classificationResult.state, "succeeded");
    const historyResult = await runtime.Send("chat.history.list", { projectId: project.projectId });
    assert.equal(historyResult.state, "succeeded");
    assert.equal(historyResult.payload?.history.turns.length, 1);
    assert.equal(historyResult.payload?.history.turns[0].classification.topic, "긴장감");
    const firstTurnId = historyResult.payload?.history.turns[0].turnId as string;
    const previewResult = await runtime.Send("chat.context.preview", {
      projectId: project.projectId,
      historyTurnIds: [firstTurnId],
      message: "앞 대화를 이어서 검토해줘",
    });
    assert.equal(previewResult.state, "succeeded", JSON.stringify(previewResult.error));
    assert.deepEqual(
      previewResult.payload?.snapshot.sources.map((source: { sourceKind: string }) => source.sourceKind),
      ["conversation", "conversation"],
    );
    const stalePreview = await runtime.Send("chat.context.preview", {
      projectId: project.projectId,
      historyChunkIds: ["history-chunk:other-project"],
    });
    assert.equal(stalePreview.state, "failed");
    assert.equal(stalePreview.error?.code, "CHAT_HISTORY_SELECTION_STALE");

    const followUpResult = await runtime.Send("chat.message.send", {
      projectId: project.projectId,
      documentPath: "draft/scene.md",
      historyTurnIds: [firstTurnId],
      message: "앞 대화를 반영해서 한 번 더 다듬어줘",
    });
    assert.equal(followUpResult.state, "succeeded", JSON.stringify(followUpResult.error));
    assert.match(String(receivedBody?.input), /긴장감을 높여줘/);
    assert.match(String(receivedBody?.input), /수정안을 준비했습니다/);
    assert.doesNotMatch(String(receivedBody?.input), /contextSnapshot/);
    const followedSession = await runtime.Send("chat.session.read", { projectId: project.projectId });
    assert.equal(followedSession.payload?.session.messages.length, 4);
    assert.equal(
      followedSession.payload?.session.messages[2].contextSnapshot.sources
        .filter((source: { sourceKind: string }) => source.sourceKind === "conversation").length,
      2,
    );
  }
  finally {
    await bootstrap.Stop();
    mockServer.close();
    await once(mockServer, "close");
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("OpenAI insufficient_quota를 재시도 오류가 아닌 결제 한도 오류로 구분한다", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(429, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota" },
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  try {
    await assert.rejects(
      new GongpilOpenAiResponsesAdapter().CreateResponse({
        apiKey: TEST_API_KEY,
        model: "gpt-5.6-terra",
        instructions: "test",
        input: "test",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      }),
      (error: unknown) => error instanceof GongpilOpenAiResponsesError
        && error.code === "AI_QUOTA_EXHAUSTED"
        && error.retryable === false,
    );
  }
  finally {
    server.close();
    await once(server, "close");
  }
});

async function WaitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("이벤트 수신 대기 시간 초과");
}
