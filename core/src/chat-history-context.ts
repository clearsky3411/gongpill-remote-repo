import { createHash } from "node:crypto";

import type { GongpilChatClassification, GongpilChatMessage } from "./chat-store.ts";
import { EstimateTokenCount } from "./context-builder.ts";

const DEFAULT_MAX_MESSAGES = 400;
const DEFAULT_MAX_CHUNK_BYTES = 2_000;

export interface GongpilChatHistoryChunk {
  chunkId: string;
  turnId: string;
  messageId: string;
  role: GongpilChatMessage["role"];
  createdAt: string;
  classification?: GongpilChatClassification;
  ordinal: number;
  byteStart: number;
  byteEnd: number;
  content: string;
  contentSha256: string;
  preview: string;
  estimatedTokens: number;
}

export interface GongpilChatHistoryTurn {
  turnId: string;
  userMessageId?: string;
  assistantMessageIds: string[];
  createdAt: string;
  classification?: GongpilChatClassification;
  chunkIds: string[];
  preview: string;
  estimatedTokens: number;
}

export interface GongpilChatHistoryIndex {
  turns: GongpilChatHistoryTurn[];
  chunks: GongpilChatHistoryChunk[];
  totalMessageCount: number;
  truncatedMessageCount: number;
}

export class GongpilChatHistoryContextError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilChatHistoryContextError";
    this.code = code;
  }

  public readonly code: string;
}

export function CreateChatHistoryIndex(
  messages: readonly GongpilChatMessage[],
  options: { maxMessages?: number; maxChunkBytes?: number } = {},
): GongpilChatHistoryIndex {
  const maxMessages = ClampInteger(options.maxMessages ?? DEFAULT_MAX_MESSAGES, 1, 2_000);
  const maxChunkBytes = ClampInteger(options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES, 256, 32_000);
  const visibleMessages = messages.slice(Math.max(0, messages.length - maxMessages));
  const turnByUserMessageId = new Map<string, MutableTurn>();
  const turns: MutableTurn[] = [];
  const chunks: GongpilChatHistoryChunk[] = [];

  for (const message of visibleMessages) {
    let turn: MutableTurn | undefined;
    if (message.role === "assistant" && message.inReplyToMessageId !== undefined) {
      turn = turnByUserMessageId.get(message.inReplyToMessageId);
    }
    if (turn === undefined) {
      turn = {
        turnId: `history-turn:${message.role === "user" ? message.messageId : `orphan:${message.messageId}`}`,
        assistantMessageIds: [],
        createdAt: message.createdAt,
        chunkIds: [],
        preview: CreatePreview(message.content),
        estimatedTokens: 0,
      };
      turns.push(turn);
    }
    if (message.role === "user") {
      turn.userMessageId = message.messageId;
      turnByUserMessageId.set(message.messageId, turn);
    }
    else {
      turn.assistantMessageIds.push(message.messageId);
    }
    turn.classification = MergeClassification(turn.classification, message.classification);
    const messageChunks = CreateMessageChunks(message, turn.turnId, maxChunkBytes);
    turn.chunkIds.push(...messageChunks.map((chunk) => chunk.chunkId));
    turn.estimatedTokens += messageChunks.reduce((total, chunk) => total + chunk.estimatedTokens, 0);
    chunks.push(...messageChunks);
  }

  return {
    turns,
    chunks,
    totalMessageCount: messages.length,
    truncatedMessageCount: messages.length - visibleMessages.length,
  };
}

export function ResolveChatHistorySelection(
  index: GongpilChatHistoryIndex,
  selection: {
    chunkIds?: readonly string[];
    turnIds?: readonly string[];
    recentTurnCount?: number;
  },
): GongpilChatHistoryChunk[] {
  const selectedChunkIds = new Set<string>();
  const turnById = new Map(index.turns.map((turn) => [turn.turnId, turn]));
  const chunkById = new Map(index.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const recentTurnCount = ClampInteger(selection.recentTurnCount ?? 0, 0, 100);
  for (const turn of index.turns.slice(Math.max(0, index.turns.length - recentTurnCount))) {
    for (const chunkId of turn.chunkIds) {
      selectedChunkIds.add(chunkId);
    }
  }
  for (const turnId of selection.turnIds ?? []) {
    const turn = turnById.get(turnId);
    if (turn === undefined) {
      throw new GongpilChatHistoryContextError(
        "CHAT_HISTORY_SELECTION_STALE",
        "선택한 이전 대화 턴이 없거나 현재 프로젝트에 속하지 않습니다. 대화 목록을 새로 불러오세요.",
      );
    }
    for (const chunkId of turn.chunkIds) {
      selectedChunkIds.add(chunkId);
    }
  }
  for (const chunkId of selection.chunkIds ?? []) {
    if (!chunkById.has(chunkId)) {
      throw new GongpilChatHistoryContextError(
        "CHAT_HISTORY_SELECTION_STALE",
        "선택한 이전 대화 청크가 없거나 현재 프로젝트에 속하지 않습니다. 대화 목록을 새로 불러오세요.",
      );
    }
    selectedChunkIds.add(chunkId);
  }
  return index.chunks.filter((chunk) => selectedChunkIds.has(chunk.chunkId));
}

function CreateMessageChunks(
  message: GongpilChatMessage,
  turnId: string,
  maxChunkBytes: number,
): GongpilChatHistoryChunk[] {
  const ranges = SplitUtf8Ranges(message.content, maxChunkBytes);
  return ranges.map((range, ordinal) => {
    const contentSha256 = CreateContentHash(range.content);
    return {
      chunkId: `history-chunk:${message.messageId}:${range.byteStart}-${range.byteEnd}:${contentSha256.slice(0, 12)}`,
      turnId,
      messageId: message.messageId,
      role: message.role,
      createdAt: message.createdAt,
      classification: CloneClassification(message.classification),
      ordinal,
      byteStart: range.byteStart,
      byteEnd: range.byteEnd,
      content: range.content,
      contentSha256,
      preview: CreatePreview(range.content),
      estimatedTokens: EstimateTokenCount(range.content),
    };
  });
}

function SplitUtf8Ranges(
  content: string,
  maxChunkBytes: number,
): Array<{ byteStart: number; byteEnd: number; content: string }> {
  if (content.length === 0) {
    return [{ byteStart: 0, byteEnd: 0, content: "" }];
  }
  const ranges: Array<{ byteStart: number; byteEnd: number; content: string }> = [];
  let characterStart = 0;
  let byteStart = 0;
  while (characterStart < content.length) {
    let characterEnd = FindHardCharacterEnd(content, characterStart, maxChunkBytes);
    if (characterEnd < content.length) {
      const window = content.slice(characterStart, characterEnd);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const lineBreak = window.lastIndexOf("\n");
      const softBreak = paragraphBreak >= 0 ? paragraphBreak + 2 : lineBreak + 1;
      if (softBreak > 0 && Buffer.byteLength(window.slice(0, softBreak), "utf8") >= maxChunkBytes / 2) {
        characterEnd = characterStart + softBreak;
      }
    }
    const chunkContent = content.slice(characterStart, characterEnd);
    const byteEnd = byteStart + Buffer.byteLength(chunkContent, "utf8");
    ranges.push({ byteStart, byteEnd, content: chunkContent });
    characterStart = characterEnd;
    byteStart = byteEnd;
  }
  return ranges;
}

function FindHardCharacterEnd(content: string, characterStart: number, maxChunkBytes: number): number {
  let characterEnd = characterStart;
  let byteLength = 0;
  while (characterEnd < content.length) {
    const codePoint = content.codePointAt(characterEnd)!;
    const character = String.fromCodePoint(codePoint);
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > maxChunkBytes && characterEnd > characterStart) {
      break;
    }
    byteLength += characterBytes;
    characterEnd += character.length;
  }
  return characterEnd;
}

function MergeClassification(
  base: GongpilChatClassification | undefined,
  next: GongpilChatClassification | undefined,
): GongpilChatClassification | undefined {
  if (base === undefined && next === undefined) {
    return undefined;
  }
  return {
    topic: next?.topic ?? base?.topic,
    task: next?.task ?? base?.task,
    session: next?.session ?? base?.session,
    labels: [...new Set([...(base?.labels ?? []), ...(next?.labels ?? [])])],
  };
}

function CloneClassification(
  classification: GongpilChatClassification | undefined,
): GongpilChatClassification | undefined {
  return classification === undefined ? undefined : {
    ...classification,
    labels: classification.labels === undefined ? undefined : [...classification.labels],
  };
}

function CreatePreview(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function CreateContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function ClampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

interface MutableTurn extends GongpilChatHistoryTurn {
  classification?: GongpilChatClassification;
}
