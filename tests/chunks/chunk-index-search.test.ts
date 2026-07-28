import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GongpilChunkIndexStore, GongpilChunkIndexStoreError } from "../../core/src/chunk-index-store.ts";
import { ParseDocumentChunks } from "../../core/src/chunk-parser.ts";
import { GongpilDocumentStore, type GongpilDocumentSnapshot } from "../../core/src/document-store.ts";
import { GongpilProjectStore } from "../../core/src/project-store.ts";

test("한글·한자·이모지와 CRLF 문서 청크가 UTF-8 byte [start,end) 좌표로 원문을 복원한다", () => {
  const content = "서문 😀\r\n\r\n# 第一章\r\n한글 본문 é\r\n\r\n## 다음\r\n끝";
  const document = CreateSnapshot("story.md", content);
  const chunks = ParseDocumentChunks(document);
  assert.deepEqual(chunks.map((chunk) => chunk.title), ["도입부", "第一章", "다음"]);
  const buffer = Buffer.from(content, "utf8");
  for (const chunk of chunks) {
    const restored = buffer.subarray(chunk.coordinate.byteStart, chunk.coordinate.byteEnd).toString("utf8");
    assert.equal(restored, chunk.content);
    assert.match(chunk.coordinate.display, /^[0-9A-F]{8}-[0-9A-F]{8}$/);
    assert.ok(chunk.coordinate.lineStart >= 1);
    assert.ok(chunk.coordinate.lineEnd >= chunk.coordinate.lineStart);
  }
  assert.equal(chunks[1].coordinate.byteStart, Buffer.byteLength("서문 😀\r\n\r\n", "utf8"));
});

test("JSON 최상위 속성과 배열 항목, 일반 text 문단을 구조 단위로 나눈다", () => {
  const jsonChunks = ParseDocumentChunks(CreateSnapshot(
    "settings.json",
    JSON.stringify({ 인물: { 이름: "연화", 태그: ["검", "달"] }, 장면: "비 내리는 밤" }, null, 2),
  ));
  assert.deepEqual(jsonChunks.map((chunk) => chunk.title), ["인물", "장면"]);
  assert.ok(jsonChunks[0].content.includes("연화"));

  const arrayChunks = ParseDocumentChunks(CreateSnapshot("list.json", "[\n  {\"id\": 1},\n  {\"id\": 2}\n]"));
  assert.deepEqual(arrayChunks.map((chunk) => chunk.title), ["[0]", "[1]"]);

  const textChunks = ParseDocumentChunks(CreateSnapshot("notes.txt", "첫 문단\r\n계속\r\n\r\n둘째 문단\n\n셋째"));
  assert.deepEqual(textChunks.map((chunk) => chunk.content), ["첫 문단\r\n계속", "둘째 문단", "셋째"]);
});

test("32KB보다 큰 청크를 UTF-8 문자 경계를 보존해 하위 분할한다", () => {
  const content = `# 큰 장면\n${"😀한".repeat(8_000)}`;
  const chunks = ParseDocumentChunks(CreateSnapshot("large.md", content));
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map((chunk) => chunk.content).join(""), content);
  for (const chunk of chunks) {
    assert.ok(chunk.coordinate.byteEnd - chunk.coordinate.byteStart <= 32 * 1024);
    assert.doesNotMatch(chunk.content, /\uFFFD/);
  }
});

test("revision 기반 색인이 변경 문서만 갱신하고 검색 및 stale 선택을 처리한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-chunk-index-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  const indexStore = new GongpilChunkIndexStore(dataRoot, documentStore);
  try {
    const project = await projectStore.CreateProject("청크 테스트");
    const first = await documentStore.CreateDocument(
      project.projectId,
      "world/인물.md",
      "# 연화\n달빛 아래 검을 든다.\n\n# 백운\n산길을 걷는다.",
    );
    const placeDocument = await documentStore.CreateDocument(
      project.projectId,
      "world/장소.txt",
      "청명산은 북쪽에 있다.\n\n연무곡은 남쪽이다.",
    );
    const initial = await indexStore.List(project.projectId, first.path);
    const unchangedChunkId = (await indexStore.List(project.projectId, placeDocument.path))[0].chunkId;
    assert.equal(initial.length, 2);
    const oldChunkId = initial[0].chunkId;
    const search = await indexStore.Search(project.projectId, "달빛 검");
    assert.equal(search[0].chunk.title, "연화");
    assert.ok(search[0].score > 0);

    const saved = await documentStore.SaveDocument(
      project.projectId,
      first.path,
      first.revision,
      "# 연화\n폭우 속에서 창을 든다.\n\n# 백운\n산길을 걷는다.",
    );
    const updated = await indexStore.UpdateDocument(project.projectId, saved);
    assert.notEqual(updated[0].chunkId, oldChunkId);
    assert.equal((await indexStore.Search(project.projectId, "폭우 창"))[0].chunk.title, "연화");
    assert.equal((await indexStore.Search(project.projectId, "달빛 검")).length, 0);
    assert.equal((await indexStore.List(project.projectId, placeDocument.path))[0].chunkId, unchangedChunkId);
    await assert.rejects(
      indexStore.Resolve(project.projectId, [oldChunkId]),
      (error: unknown) => error instanceof GongpilChunkIndexStoreError
        && error.code === "CHUNK_SELECTION_STALE",
    );

    const indexDirectory = join(dataRoot, "indexes", "chunks");
    await mkdir(indexDirectory, { recursive: true });
    await writeFile(
      join(indexDirectory, `${project.projectId}.json`),
      JSON.stringify({
        schemaVersion: 1,
        projectId: project.projectId,
        updatedAt: new Date().toISOString(),
        documents: [{ path: saved.path, revision: saved.revision, chunks: [{ chunkId: 7 }] }],
      }),
      "utf8",
    );
    const reloaded = new GongpilChunkIndexStore(dataRoot, documentStore);
    const persisted = await reloaded.List(project.projectId, first.path);
    assert.equal(persisted[0].revision, saved.revision);
    assert.equal(persisted[0].content.includes("폭우"), true);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("인스턴스가 청크 검색·선택·좌표 표시 UI와 명령 계약을 제공한다", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(join(process.cwd(), "browser", "src", "index.html"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "app.js"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "styles.css"), "utf8"),
  ]);
  assert.match(html, /id="chunkSearchForm"/);
  assert.match(html, /id="selectVisibleChunksButton"/);
  assert.match(html, /id="chunkList"/);
  assert.match(script, /chunk\.list/);
  assert.match(script, /chunk\.search/);
  assert.match(script, /chunkIds: \[\.\.\.state\.selectedChunkIds\]/);
  assert.match(script, /coordinate\.display/);
  assert.match(styles, /\.chunk-option/);
});

function CreateSnapshot(path: string, content: string): GongpilDocumentSnapshot {
  return {
    fileId: `file-${path}`,
    path,
    name: path.split("/").at(-1) ?? path,
    revision: "revision-test",
    size: Buffer.byteLength(content, "utf8"),
    updatedAt: "2026-07-28T00:00:00.000Z",
    content,
    encoding: "utf-8",
    newline: content.includes("\r\n") ? "crlf" : (content.includes("\n") ? "lf" : "none"),
  };
}
