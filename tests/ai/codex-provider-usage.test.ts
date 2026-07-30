import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GongpilCodexAppServerClient } from "../../core/src/codex-app-server-client.ts";

test("격리된 Codex App Server가 ChatGPT 상태와 토큰 사용량 및 구조화 제안을 반환한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-codex-provider-"));
  const codexHome = join(testRoot, "isolated-codex-home");
  const workspaceRoot = join(testRoot, "workspace");
  const client = new GongpilCodexAppServerClient({
    executablePath: process.execPath,
    executableArgs: [join(process.cwd(), "tests", "fixtures", "fake-codex-app-server.mjs")],
    codexHome,
    workspaceRoot,
    model: "gpt-5.6-terra",
  });
  try {
    const status = await client.GetStatus();
    assert.equal(status.configured, true);
    assert.equal(status.authMode, "chatgpt");
    assert.equal(status.planType, "pro");
    assert.equal(status.rateLimits?.primary.usedPercent, 12);
    await access(join(codexHome, "fake-app-server-started.txt"));

    const response = await client.Generate({ instructions: "한국어로 답하세요.", input: "문장을 다듬어줘" });
    assert.equal(response.text, "수정안을 준비했습니다.");
    assert.deepEqual(response.proposal, {
      action: "replace",
      path: "draft.md",
      content: "수정된 본문",
      summary: "문장을 다듬었습니다.",
    });
    assert.deepEqual(response.usage, {
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 40,
      reasoningOutputTokens: 10,
    });
  }
  finally {
    await client.Stop();
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Codex가 같은 턴에서 프로젝트 청크 검색과 읽기 동적 도구를 호출한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-codex-tools-"));
  const calls: Array<{ tool: string; arguments: unknown }> = [];
  const client = new GongpilCodexAppServerClient({
    executablePath: process.execPath,
    executableArgs: [join(process.cwd(), "tests", "fixtures", "fake-codex-app-server.mjs")],
    codexHome: join(testRoot, "codex-home"),
    workspaceRoot: join(testRoot, "workspace"),
    model: "gpt-5.6-terra",
  });
  try {
    const response = await client.Generate({
      instructions: "필요한 프로젝트 청크를 찾아 답하세요.",
      input: "연화가 사용하는 무기가 뭐야?",
      dynamicTools: [
        {
          type: "function",
          name: "gongpil_search_project_chunks",
          description: "프로젝트 청크 검색",
          inputSchema: { type: "object" },
        },
        {
          type: "function",
          name: "gongpil_read_project_chunks",
          description: "프로젝트 청크 읽기",
          inputSchema: { type: "object" },
        },
      ],
      onDynamicToolCall: async (call) => {
        calls.push({ tool: call.tool, arguments: call.arguments });
        return {
          success: true,
          contentItems: [{ type: "inputText", text: JSON.stringify({ ok: true }) }],
        };
      },
    });
    assert.equal(response.dynamicToolsEnabled, true);
    assert.equal(response.text, "자동으로 관련 청크를 읽었습니다.");
    assert.deepEqual(calls, [
      { tool: "gongpil_search_project_chunks", arguments: { query: "연화의 무기", limit: 5 } },
      { tool: "gongpil_read_project_chunks", arguments: { chunkIds: ["chunk-memory-test"] } },
    ]);
  }
  finally {
    await client.Stop();
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("동적 도구를 모르는 Codex App Server에서는 기존 정적 컨텍스트로 후퇴한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-codex-fallback-"));
  const client = new GongpilCodexAppServerClient({
    executablePath: process.execPath,
    executableArgs: [
      join(process.cwd(), "tests", "fixtures", "fake-codex-app-server.mjs"),
      "--reject-dynamic-tools",
    ],
    codexHome: join(testRoot, "codex-home"),
    workspaceRoot: join(testRoot, "workspace"),
    model: "gpt-5.6-terra",
  });
  try {
    const response = await client.Generate({
      instructions: "한국어로 답하세요.",
      input: "문장을 다듬어줘",
      dynamicTools: [{
        type: "function",
        name: "gongpil_search_project_chunks",
        description: "프로젝트 청크 검색",
        inputSchema: { type: "object" },
      }],
      onDynamicToolCall: async () => ({ success: true, contentItems: [] }),
    });
    assert.equal(response.dynamicToolsEnabled, false);
    assert.equal(response.text, "수정안을 준비했습니다.");
  }
  finally {
    await client.Stop();
    await rm(testRoot, { recursive: true, force: true });
  }
});
