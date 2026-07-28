import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GongpilDiagnosticLogStore } from "../../core/src/diagnostic-log-store.ts";

test("개발 로그는 허용된 실행 정보만 저장하고 키·경로·문서 내용을 제거한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-diagnostic-log-"));
  try {
    const store = new GongpilDiagnosticLogStore(testRoot);
    await store.Append({
      level: "error",
      source: "openai-api",
      code: "AI_REQUEST_FAILED\nunsafe",
      message: "요청 실패\n다시 확인",
      requestId: "request:test-1",
      details: {
        provider: "openai-api",
        model: "gpt-5.6-terra",
        httpStatus: 429,
        personaVersion: 2,
        contextSources: 3,
        contextOmitted: 1,
        apiKey: "sk-should-never-appear",
        documentPath: "G:\\secret\\draft.md",
        documentContent: "비밀 원고",
      },
    });
    const entries = await store.Read();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].code, "AI_REQUEST_FAILED unsafe");
    assert.deepEqual(entries[0].details, {
      provider: "openai-api",
      model: "gpt-5.6-terra",
      httpStatus: 429,
      personaVersion: 2,
      contextSources: 3,
      contextOmitted: 1,
    });
    const serialized = JSON.stringify(entries);
    assert.doesNotMatch(serialized, /sk-should|secret|비밀 원고/);
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("인스턴스 셸이 AI 사용 정보와 개발 로그 대화상자 계약을 제공한다", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(join(process.cwd(), "browser", "src", "index.html"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "app.js"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "styles.css"), "utf8"),
  ]);
  assert.match(html, /id="usageButton"/);
  assert.match(html, /id="logsButton"/);
  assert.match(html, /id="observabilityDialog"/);
  assert.match(script, /ai\.usage\.read/);
  assert.match(script, /diagnostics\.logs\.read/);
  assert.match(script, /API 달러 비용 없음/);
  assert.match(styles, /\.observability-dialog/);
  assert.match(styles, /\.log-entry\[data-level="error"\]/);
});
