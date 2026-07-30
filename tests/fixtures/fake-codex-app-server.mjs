import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

writeFileSync(join(process.env.CODEX_HOME, "fake-app-server-started.txt"), "isolated", "utf8");

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const rejectDynamicTools = process.argv.includes("--reject-dynamic-tools");
let dynamicToolsEnabled = false;
let activeTurn;

const completeTurn = (answer = "수정안을 준비했습니다.") => {
  const output = JSON.stringify({
    answer,
    proposal: {
      action: "replace",
      path: "draft.md",
      content: "수정된 본문",
      summary: "문장을 다듬었습니다.",
    },
  });
  send({ method: "item/agentMessage/delta", params: { threadId: "thread-test", turnId: "turn-test", delta: output } });
  send({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-test",
      tokenUsage: {
        last: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 },
        total: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 },
      },
    },
  });
  send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "completed" } } });
};

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === undefined && request.id === "tool-search-test") {
    if (request.result?.success !== true) {
      completeTurn("검색 도구가 실패했습니다.");
      return;
    }
    send({
      id: "tool-read-test",
      method: "item/tool/call",
      params: {
        threadId: "thread-test",
        turnId: "turn-test",
        callId: "call-read-test",
        tool: "gongpil_read_project_chunks",
        arguments: { chunkIds: ["chunk-memory-test"] },
      },
    });
    return;
  }
  if (request.method === undefined && request.id === "tool-read-test") {
    completeTurn(request.result?.success === true ? "자동으로 관련 청크를 읽었습니다." : "읽기 도구가 실패했습니다.");
    return;
  }
  if (request.method === "initialized") {
    return;
  }
  if (request.method === "initialize") {
    send({ id: request.id, result: { userAgent: "fake-codex" } });
    return;
  }
  if (request.method === "account/read") {
    send({ id: request.id, result: { account: { type: "chatgpt", planType: "pro" } } });
    return;
  }
  if (request.method === "account/rateLimits/read") {
    send({ id: request.id, result: { rateLimits: { primary: { usedPercent: 12 } } } });
    return;
  }
  if (request.method === "account/usage/read") {
    send({ id: request.id, result: { summary: { lifetimeTokens: 1234 } } });
    return;
  }
  if (request.method === "account/login/start") {
    send({ id: request.id, result: { loginId: "login-test", authUrl: "https://example.test/login" } });
    return;
  }
  if (request.method === "thread/start") {
    if (request.params?.sandbox !== "read-only") {
      send({ id: request.id, error: { message: `unexpected sandbox: ${request.params?.sandbox}` } });
      return;
    }
    if (rejectDynamicTools && Array.isArray(request.params?.dynamicTools)) {
      send({ id: request.id, error: { message: "unknown field dynamicTools" } });
      return;
    }
    dynamicToolsEnabled = Array.isArray(request.params?.dynamicTools)
      && request.params.dynamicTools.some((tool) => tool.name === "gongpil_search_project_chunks")
      && request.params.dynamicTools.some((tool) => tool.name === "gongpil_read_project_chunks");
    send({ id: request.id, result: { thread: { id: "thread-test" } } });
    return;
  }
  if (request.method === "turn/start") {
    if (request.params?.sandboxPolicy?.type !== "readOnly") {
      send({ id: request.id, error: { message: `unexpected sandbox policy: ${request.params?.sandboxPolicy?.type}` } });
      return;
    }
    send({ id: request.id, result: { turn: { id: "turn-test" } } });
    activeTurn = request;
    setTimeout(() => {
      if (dynamicToolsEnabled) {
        send({
          id: "tool-search-test",
          method: "item/tool/call",
          params: {
            threadId: "thread-test",
            turnId: "turn-test",
            callId: "call-search-test",
            tool: "gongpil_search_project_chunks",
            arguments: { query: "연화의 무기", limit: 5 },
          },
        });
        return;
      }
      if (activeTurn === request) {
        completeTurn();
      }
    }, 10);
    return;
  }
  if (request.method === "turn/interrupt") {
    send({ id: request.id, result: {} });
  }
});
