import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GongpilChatStore } from "../../core/src/chat-store.ts";
import { GongpilChunkIndexStore } from "../../core/src/chunk-index-store.ts";
import {
  BuildWritingContext,
  FinalizePairWriterContextSnapshot,
} from "../../core/src/context-builder.ts";
import type { GongpilChunkDescriptor } from "../../core/src/chunk-parser.ts";
import { GongpilDocumentStore } from "../../core/src/document-store.ts";
import { GongpilPairWriterContextTools } from "../../core/src/pair-writer-context-tools.ts";
import { GongpilPersonaStore } from "../../core/src/persona-store.ts";
import { GongpilProjectStore } from "../../core/src/project-store.ts";

test("페르소나 버전을 누적하고 작업 프로필과 활성 버전을 전환한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-persona-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const personaStore = new GongpilPersonaStore(dataRoot);
  try {
    const project = await projectStore.CreateProject("페르소나 테스트");
    const initial = await personaStore.ReadWorkspace(project.projectId);
    assert.equal(initial.personas[0].versions[0].version, 1);
    const versioned = await personaStore.CreateVersion(project.projectId, {
      personaId: initial.personas[0].personaId,
      name: "냉정한 설정 편집자",
      systemInstructions: "설정 충돌을 먼저 찾는다.",
      workStyle: "근거를 표로 정리한다.",
      styleGuide: "간결한 한국어",
      forbiddenExpressions: ["대충"],
      referencePriorities: ["명시 선택 청크", "현재 문서"],
    });
    assert.equal(versioned.personas[0].versions.length, 2);
    assert.equal(versioned.personas[0].versions[1].version, 2);
    assert.equal(versioned.selection.versionId, versioned.personas[0].versions[1].versionId);

    const profiled = await personaStore.SaveProfile(project.projectId, {
      name: "짧은 검토",
      instructions: "설정 오류만 지적한다.",
      contextTokenBudget: 1_000,
    });
    assert.equal(profiled.profiles.length, 2);
    assert.equal(profiled.selection.profileId, profiled.profiles[1].profileId);
    const selected = await personaStore.UpdateSelection(project.projectId, {
      versionId: initial.personas[0].versions[0].versionId,
      profileId: initial.profiles[0].profileId,
    });
    assert.equal(selected.selection.versionId, initial.personas[0].versions[0].versionId);
    assert.equal((await personaStore.GetActiveContext(project.projectId)).version.version, 1);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("컨텍스트가 중복을 제거하고 토큰 예산 누락을 경고하며 실제 출처 snapshot을 보존한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-context-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const personaStore = new GongpilPersonaStore(dataRoot);
  const chatStore = new GongpilChatStore(dataRoot);
  try {
    const project = await projectStore.CreateProject("컨텍스트 테스트");
    await personaStore.SaveProfile(project.projectId, {
      name: "작은 예산",
      instructions: "출처를 우선한다.",
      contextTokenBudget: 1_000,
    });
    const activePersona = await personaStore.GetActiveContext(project.projectId);
    const first = CreateChunk("chunk-1", "world/인물.md", "rev-before", "# 연화\n검을 든다.");
    const oversized = CreateChunk("chunk-2", "world/설정.md", "rev-large", "가".repeat(4_000));
    const built = BuildWritingContext({
      baseInstructions: "공필 안전 규칙",
      projectName: project.name,
      userText: "설정 충돌을 찾아줘",
      activePersona,
      selectedChunks: [first, first, oversized],
    });
    assert.equal(built.snapshot.requestedSourceCount, 2);
    assert.equal(built.snapshot.includedSourceCount, 1);
    assert.equal(built.snapshot.omittedSourceCount, 1);
    assert.match(built.snapshot.warnings[0], /출처 1개/);
    assert.equal(built.snapshot.sources[0].selectionKind, "explicit");
    assert.equal(built.snapshot.sources[0].revision, "rev-before");
    assert.equal(built.snapshot.sources[0].content, first.content);
    assert.match(built.snapshot.sources[0].contentSha256, /^[a-f0-9]{64}$/);
    assert.match(built.instructions, /기본 공동 집필자 v1/);

    const userMessage = await chatStore.AppendMessage(project.projectId, "user", "설정 충돌을 찾아줘", {
      contextSnapshot: built.snapshot,
    });
    first.content = "수정된 원문";
    await chatStore.AppendMessage(project.projectId, "assistant", "검토했습니다.", {
      inReplyToMessageId: userMessage.messageId,
    });
    const session = await chatStore.ReadSession(project.projectId);
    assert.equal(session.messages[0].contextSnapshot?.sources[0].content, "# 연화\n검을 든다.");
    assert.equal(session.messages[1].inReplyToMessageId, userMessage.messageId);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("기존 메타데이터 없는 채팅 JSON을 그대로 읽는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-chat-legacy-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const chatStore = new GongpilChatStore(dataRoot);
  try {
    const project = await projectStore.CreateProject("이전 채팅");
    const chatPath = join(dataRoot, "chats", `${project.projectId}.json`);
    await mkdir(join(dataRoot, "chats"), { recursive: true });
    await writeFile(chatPath, JSON.stringify({
      projectId: project.projectId,
      messages: [{ messageId: "old", role: "user", content: "이전 메시지", createdAt: "2026-01-01T00:00:00.000Z" }],
      proposals: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }), "utf8");
    const session = await chatStore.ReadSession(project.projectId);
    assert.equal(session.messages[0].content, "이전 메시지");
    assert.equal(session.messages[0].contextSnapshot, undefined);
    assert.match(await readFile(chatPath, "utf8"), /이전 메시지/);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("페어 작가가 검색 후보를 본 뒤 필요한 프로젝트 청크만 읽고 snapshot에 확정한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-pair-writer-context-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  const chunkIndexStore = new GongpilChunkIndexStore(dataRoot, documentStore);
  const personaStore = new GongpilPersonaStore(dataRoot);
  const chatStore = new GongpilChatStore(dataRoot);
  try {
    const project = await projectStore.CreateProject("페어 작가 기억 테스트");
    await documentStore.CreateDocument(
      project.projectId,
      "world/인물.md",
      "# 연화\n연화는 달빛을 머금은 은색 검 월영을 사용한다.\n\n# 백운\n백운은 활을 사용한다.",
    );
    const activePersona = await personaStore.GetActiveContext(project.projectId);
    const built = BuildWritingContext({
      baseInstructions: "필요한 프로젝트 근거를 찾는다.",
      projectName: project.name,
      userText: "연화의 무기는 뭐야?",
      activePersona,
    });
    const tools = new GongpilPairWriterContextTools({
      projectId: project.projectId,
      chunkIndexStore,
      contextSnapshot: built.snapshot,
    });
    const searchResult = await tools.Handle({
      threadId: "thread-test",
      turnId: "turn-test",
      callId: "search-test",
      tool: "gongpil_search_project_chunks",
      arguments: { query: "연화 무기", limit: 5 },
    });
    assert.equal(searchResult.success, true);
    const searchPayload = JSON.parse(searchResult.contentItems[0].text);
    assert.equal(searchPayload.candidates.length, 1);
    assert.equal(searchPayload.candidates[0].title, "연화");

    const readResult = await tools.Handle({
      threadId: "thread-test",
      turnId: "turn-test",
      callId: "read-test",
      tool: "gongpil_read_project_chunks",
      arguments: { chunkIds: [searchPayload.candidates[0].chunkId] },
    });
    assert.equal(readResult.success, true);
    assert.match(readResult.contentItems[0].text, /월영/);

    const finalized = FinalizePairWriterContextSnapshot(built.snapshot, tools.GetTrace(), true);
    assert.equal(finalized.automaticRetrieval?.dynamicToolsEnabled, true);
    assert.deepEqual(finalized.automaticRetrieval?.searchQueries, ["연화 무기"]);
    assert.equal(finalized.automaticRetrieval?.includedChunkIds.length, 1);
    assert.equal(finalized.sources[0].selectionKind, "pair-writer");
    assert.match(finalized.sources[0].content, /은색 검 월영/);

    const userMessage = await chatStore.AppendMessage(project.projectId, "user", "연화의 무기는 뭐야?", {
      contextSnapshot: built.snapshot,
    });
    await chatStore.UpdateMessageContextSnapshot(project.projectId, userMessage.messageId, finalized);
    const stored = await chatStore.ReadSession(project.projectId);
    assert.equal(stored.messages[0].contextSnapshot?.sources[0].selectionKind, "pair-writer");
    assert.equal(stored.messages[0].contextSnapshot?.automaticRetrieval?.searchQueries[0], "연화 무기");

    const selectedChunk = (await chunkIndexStore.Search(project.projectId, "연화 무기", { limit: 1 }))[0].chunk;
    const pinned = BuildWritingContext({
      baseInstructions: "명시 선택 출처를 우선한다.",
      projectName: project.name,
      userText: "연화의 무기는 뭐야?",
      activePersona,
      selectedChunks: [selectedChunk],
    });
    const duplicateTools = new GongpilPairWriterContextTools({
      projectId: project.projectId,
      chunkIndexStore,
      contextSnapshot: pinned.snapshot,
    });
    await duplicateTools.Handle({
      threadId: "thread-test",
      turnId: "turn-test",
      callId: "duplicate-read-test",
      tool: "gongpil_read_project_chunks",
      arguments: { chunkIds: [selectedChunk.chunkId] },
    });
    const duplicateTrace = duplicateTools.GetTrace();
    assert.equal(duplicateTrace.retrievedChunks.length, 0);
    assert.deepEqual(duplicateTrace.omissions, [{ chunkId: selectedChunk.chunkId, reason: "duplicate" }]);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("인스턴스가 페르소나·프로필 전환과 요청 출처 확인 UI를 제공한다", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(join(process.cwd(), "browser", "src", "index.html"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "app.js"), "utf8"),
    readFile(join(process.cwd(), "browser", "src", "styles.css"), "utf8"),
  ]);
  assert.match(html, /id="personaSelect"/);
  assert.match(html, /id="personaVersionSelect"/);
  assert.match(html, /id="profileSelect"/);
  assert.match(html, /id="profileBudgetInput"/);
  assert.match(script, /persona\.workspace\.read/);
  assert.match(script, /persona\.version\.create/);
  assert.match(script, /persona\.profile\.save/);
  assert.match(script, /persona\.selection\.update/);
  assert.match(script, /function RenderContextSnapshot/);
  assert.match(script, /source\.revision\.slice/);
  assert.match(script, /페어 작가 자동 참조/);
  assert.match(script, /context-retrieval-summary/);
  assert.match(styles, /\.context-snapshot/);
  assert.match(styles, /\.source-snapshot/);
});

function CreateChunk(
  chunkId: string,
  path: string,
  revision: string,
  content: string,
): GongpilChunkDescriptor {
  return {
    chunkId,
    fileId: `file-${chunkId}`,
    path,
    revision,
    format: "markdown",
    kind: "markdown-section",
    title: path,
    ordinal: 0,
    coordinate: {
      byteStart: 0,
      byteEnd: Buffer.byteLength(content, "utf8"),
      lineStart: 1,
      lineEnd: content.split("\n").length,
      display: `00000000-${Buffer.byteLength(content, "utf8").toString(16).padStart(8, "0").toUpperCase()}`,
    },
    content,
    preview: content.slice(0, 100),
  };
}
