import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

writeFileSync(join(process.env.CODEX_HOME, "fake-app-server-started.txt"), "isolated", "utf8");

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

input.on("line", (line) => {
  const request = JSON.parse(line);
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
    send({ id: request.id, result: { thread: { id: "thread-test" } } });
    return;
  }
  if (request.method === "turn/start") {
    send({ id: request.id, result: { turn: { id: "turn-test" } } });
    setTimeout(() => {
      const output = JSON.stringify({
        answer: "수정안을 준비했습니다.",
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
    }, 10);
    return;
  }
  if (request.method === "turn/interrupt") {
    send({ id: request.id, result: {} });
  }
});
