import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("인스턴스가 이전 대화 선택·분류·통합 토큰 미리보기 UI를 제공한다", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(join(process.cwd(), "browser", "src", "index.html"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "app.js"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "styles.css"), "utf8"),
  ]);

  assert.match(html, /id="historyRecentCount"[^>]*value="10"/);
  assert.match(html, /id="selectRecentHistoryButton"/);
  assert.match(html, /id="clearHistorySelectionButton"/);
  assert.match(html, /id="historyClassificationFilter"/);
  assert.match(html, /id="selectFilteredHistoryButton"/);
  assert.match(html, /id="historyList"/);
  assert.match(html, /id="contextPreviewSummary"/);
  assert.match(html, /id="contextPreviewSources"/);
  assert.match(html, /id="contextPreviewOmissions"/);

  assert.match(script, /async function LoadChatHistory/);
  assert.match(script, /function RenderChatHistorySelection/);
  assert.match(script, /async function PreviewContext/);
  assert.match(script, /async function UpdateHistoryClassification/);
  assert.match(script, /runtime\.Send\("chat\.history\.list"/);
  assert.match(script, /runtime\.Send\("chat\.context\.preview"/);
  assert.match(script, /runtime\.Send\("chat\.message\.classification\.update"/);
  assert.match(script, /historyChunkIds: \[\.\.\.state\.selectedHistoryChunkIds\]/);
  assert.match(script, /source\.sourceKind === "conversation"/);
  assert.match(script, /omission\.reason === "duplicate"/);

  assert.match(styles, /\.history-turn/);
  assert.match(styles, /\.history-chunk-option/);
  assert.match(styles, /\.history-classification-editor/);
  assert.match(styles, /\.context-preview-panel/);
  assert.match(styles, /\.context-preview-omissions/);
});
