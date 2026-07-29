import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CreateChatHistoryIndex,
  GongpilChatHistoryContextError,
  ResolveChatHistorySelection,
} from "../../core/src/chat-history-context.ts";
import { GongpilChatStore, GongpilChatStoreError, type GongpilChatMessage } from "../../core/src/chat-store.ts";
import { BuildWritingContext } from "../../core/src/context-builder.ts";
import type { GongpilChunkDescriptor } from "../../core/src/chunk-parser.ts";
import { GongpilPersonaStore } from "../../core/src/persona-store.ts";
import { GongpilProjectStore } from "../../core/src/project-store.ts";

test("이전 대화를 턴과 UTF-8 byte 청크로 만들고 최근·개별 선택을 해석한다", () => {
  const longMessage = `첫 문단\n\n${"가".repeat(300)}`;
  const messages: GongpilChatMessage[] = [
    {
      messageId: "message-user-1",
      role: "user",
      content: longMessage,
      createdAt: "2026-07-29T00:00:00.000Z",
      classification: { topic: "등장인물", task: "퇴고", labels: ["중요"] },
      contextSnapshot: { privateMarker: "재귀 포함 금지" } as never,
    },
    {
      messageId: "message-assistant-1",
      role: "assistant",
      content: "첫 답변",
      createdAt: "2026-07-29T00:00:01.000Z",
      inReplyToMessageId: "message-user-1",
    },
    {
      messageId: "message-user-2",
      role: "user",
      content: "두 번째 요청",
      createdAt: "2026-07-29T00:01:00.000Z",
      classification: { session: "야간 작업" },
    },
    {
      messageId: "message-assistant-2",
      role: "assistant",
      content: "두 번째 답변",
      createdAt: "2026-07-29T00:01:01.000Z",
      inReplyToMessageId: "message-user-2",
    },
  ];
  const history = CreateChatHistoryIndex(messages, { maxChunkBytes: 256 });
  assert.equal(history.turns.length, 2);
  assert.equal(history.turns[0].classification?.topic, "등장인물");
  assert.ok(history.turns[0].chunkIds.length > 2);
  const firstMessageChunks = history.chunks.filter((chunk) => chunk.messageId === "message-user-1");
  assert.equal(firstMessageChunks.map((chunk) => chunk.content).join(""), longMessage);
  assert.equal(firstMessageChunks.at(-1)?.byteEnd, Buffer.byteLength(longMessage, "utf8"));
  assert.doesNotMatch(history.chunks.map((chunk) => chunk.content).join("\n"), /재귀 포함 금지/);

  const recent = ResolveChatHistorySelection(history, { recentTurnCount: 1 });
  assert.deepEqual([...new Set(recent.map((chunk) => chunk.turnId))], [history.turns[1].turnId]);
  const firstTurn = ResolveChatHistorySelection(history, { turnIds: [history.turns[0].turnId] });
  assert.equal(firstTurn.length, history.turns[0].chunkIds.length);
  assert.throws(
    () => ResolveChatHistorySelection(history, { chunkIds: ["history-chunk:other-project"] }),
    (error: unknown) => error instanceof GongpilChatHistoryContextError
      && error.code === "CHAT_HISTORY_SELECTION_STALE",
  );
});

test("문서와 대화 출처를 한 예산에서 중복 제거하고 제외 이유를 snapshot에 남긴다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-history-context-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const personaStore = new GongpilPersonaStore(dataRoot);
  try {
    const project = await projectStore.CreateProject("대화 컨텍스트");
    const activePersona = await personaStore.GetActiveContext(project.projectId);
    const duplicatedContent = "연화는 검을 든다.";
    const history = CreateChatHistoryIndex([
      {
        messageId: "message-user",
        role: "user",
        content: duplicatedContent,
        createdAt: "2026-07-29T00:00:00.000Z",
        classification: { topic: "연화", labels: ["설정"] },
        contextSnapshot: { privateMarker: "snapshot 내부는 포함하지 않는다" } as never,
      },
      {
        messageId: "message-assistant",
        role: "assistant",
        content: "검은 왕실에서 물려받았다.",
        createdAt: "2026-07-29T00:00:01.000Z",
        inReplyToMessageId: "message-user",
      },
    ]);
    const selectedHistoryChunks = ResolveChatHistorySelection(history, { recentTurnCount: 1 });
    const built = BuildWritingContext({
      baseInstructions: "공필 안전 규칙",
      projectName: project.name,
      userText: "앞 설정을 이어서 써줘",
      activePersona,
      selectedChunks: [CreateChunk("document-chunk", duplicatedContent)],
      selectedHistoryChunks,
    });

    assert.equal(built.snapshot.requestedSourceCount, 3);
    assert.equal(built.snapshot.includedSourceCount, 2);
    assert.equal(built.snapshot.omittedSourceCount, 1);
    assert.deepEqual(built.snapshot.omissions.map((omission) => omission.reason), ["duplicate"]);
    assert.equal(built.snapshot.omissions[0].sourceKind, "conversation");
    assert.deepEqual(built.snapshot.sources.map((source) => source.sourceKind), ["document", "conversation"]);
    const conversationSource = built.snapshot.sources.find((source) => source.sourceKind === "conversation");
    assert.equal(conversationSource?.messageId, "message-assistant");
    assert.match(built.input, /검은 왕실에서 물려받았다/);
    assert.doesNotMatch(built.input, /snapshot 내부는 포함하지 않는다/);
    assert.match(built.snapshot.warnings.join("\n"), /중복으로 제외/);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("메시지 분류를 프로젝트별로 저장하고 빈 분류로 제거한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-chat-classification-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const chatStore = new GongpilChatStore(dataRoot);
  try {
    const firstProject = await projectStore.CreateProject("첫 프로젝트");
    const secondProject = await projectStore.CreateProject("둘째 프로젝트");
    const message = await chatStore.AppendMessage(firstProject.projectId, "user", "분류할 메시지");
    const classified = await chatStore.UpdateMessageClassification(firstProject.projectId, message.messageId, {
      topic: "  세계관  ",
      task: "설정 검토",
      session: "출근 전",
      labels: ["핵심", "핵심"],
    });
    assert.deepEqual(classified.classification, {
      topic: "세계관",
      task: "설정 검토",
      session: "출근 전",
      labels: ["핵심"],
    });
    assert.deepEqual((await chatStore.ReadSession(firstProject.projectId)).messages[0].classification, classified.classification);
    await assert.rejects(
      chatStore.UpdateMessageClassification(secondProject.projectId, message.messageId, { topic: "침범" }),
      (error: unknown) => error instanceof GongpilChatStoreError && error.code === "CHAT_MESSAGE_NOT_FOUND",
    );
    const cleared = await chatStore.UpdateMessageClassification(firstProject.projectId, message.messageId, {});
    assert.equal(cleared.classification, undefined);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

function CreateChunk(chunkId: string, content: string): GongpilChunkDescriptor {
  return {
    chunkId,
    fileId: `file-${chunkId}`,
    path: "world/character.md",
    revision: "revision-1",
    format: "markdown",
    kind: "markdown-section",
    title: "연화",
    ordinal: 0,
    coordinate: {
      byteStart: 0,
      byteEnd: Buffer.byteLength(content, "utf8"),
      lineStart: 1,
      lineEnd: 1,
      display: "00000000-00000000",
    },
    content,
    preview: content,
  };
}
