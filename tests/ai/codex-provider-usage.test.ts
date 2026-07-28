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
