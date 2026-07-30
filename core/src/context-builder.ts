import { createHash, randomUUID } from "node:crypto";

import type { GongpilChunkDescriptor } from "./chunk-parser.ts";
import type { GongpilChatHistoryChunk } from "./chat-history-context.ts";
import type { GongpilChatClassification } from "./chat-store.ts";
import type { GongpilDocumentSnapshot } from "./document-store.ts";
import type { GongpilPairWriterRetrievalTrace } from "./pair-writer-context-tools.ts";
import type { GongpilActivePersonaContext } from "./persona-store.ts";

export interface GongpilDocumentSourceSnapshot {
  sourceId: string;
  sourceKind: "document";
  selectionKind: "explicit" | "active-document" | "pair-writer";
  chunkId?: string;
  fileId: string;
  path: string;
  revision: string;
  title: string;
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
  content: string;
  contentSha256: string;
}

export interface GongpilConversationSourceSnapshot {
  sourceId: string;
  sourceKind: "conversation";
  selectionKind: "conversation";
  historyChunkId: string;
  messageId: string;
  turnId: string;
  role: "user" | "assistant";
  createdAt: string;
  classification?: GongpilChatClassification;
  byteStart: number;
  byteEnd: number;
  content: string;
  contentSha256: string;
}

export type GongpilSourceSnapshot = GongpilDocumentSourceSnapshot | GongpilConversationSourceSnapshot;

export interface GongpilContextOmissionSnapshot {
  sourceReference: string;
  sourceKind: GongpilSourceSnapshot["sourceKind"];
  reason: "duplicate" | "token-budget";
}

export interface GongpilContextSnapshot {
  snapshotId: string;
  createdAt: string;
  persona: {
    personaId: string;
    versionId: string;
    version: number;
    name: string;
    systemInstructions: string;
    workStyle: string;
    styleGuide: string;
    forbiddenExpressions: string[];
    referencePriorities: string[];
  };
  profile: {
    profileId: string;
    name: string;
    instructions: string;
    contextTokenBudget: number;
  };
  requestedSourceCount: number;
  includedSourceCount: number;
  omittedSourceCount: number;
  estimatedInputTokens: number;
  warnings: string[];
  omissions: GongpilContextOmissionSnapshot[];
  sources: GongpilSourceSnapshot[];
  automaticRetrieval?: {
    dynamicToolsEnabled: boolean;
    searchQueries: string[];
    requestedChunkIds: string[];
    includedChunkIds: string[];
    warnings: string[];
  };
}

export interface GongpilBuiltWritingContext {
  instructions: string;
  input: string;
  snapshot: GongpilContextSnapshot;
}

export function BuildWritingContext(value: {
  baseInstructions: string;
  projectName: string;
  userText: string;
  activePersona: GongpilActivePersonaContext;
  selectedChunks?: readonly GongpilChunkDescriptor[];
  selectedHistoryChunks?: readonly GongpilChatHistoryChunk[];
  activeDocument?: GongpilDocumentSnapshot;
}): GongpilBuiltWritingContext {
  const instructions = CreateInstructions(value.baseInstructions, value.activePersona);
  const candidates = CreateSourceCandidates(
    value.selectedChunks ?? [],
    value.selectedHistoryChunks ?? [],
    value.activeDocument,
  );
  const fixedInput = `프로젝트: ${value.projectName}\n사용자 요청:\n${value.userText}`;
  const budget = value.activePersona.profile.contextTokenBudget;
  const fixedEstimatedTokens = EstimateTokenCount(`${instructions}\n${fixedInput}`);
  let estimatedTokens = fixedEstimatedTokens;
  const sources: GongpilSourceSnapshot[] = [];
  const omissions: GongpilContextOmissionSnapshot[] = [];
  const sourceBlocks: string[] = [];
  const includedContentHashes = new Set<string>();
  for (const candidate of candidates) {
    if (includedContentHashes.has(candidate.contentSha256)) {
      omissions.push(CreateOmission(candidate, "duplicate"));
      continue;
    }
    const block = CreateSourceBlock(candidate, sourceBlocks.length + 1);
    const blockTokens = EstimateTokenCount(block);
    if (estimatedTokens + blockTokens > budget) {
      omissions.push(CreateOmission(candidate, "token-budget"));
      continue;
    }
    sources.push(candidate);
    sourceBlocks.push(block);
    includedContentHashes.add(candidate.contentSha256);
    estimatedTokens += blockTokens;
  }
  const omittedSourceCount = omissions.length;
  const warnings: string[] = [];
  if (fixedEstimatedTokens > budget) {
    warnings.push("페르소나 지시와 사용자 요청만으로 작업 프로필의 토큰 예산을 초과했습니다.");
  }
  const duplicateCount = omissions.filter((omission) => omission.reason === "duplicate").length;
  const budgetOmissionCount = omissions.filter((omission) => omission.reason === "token-budget").length;
  if (duplicateCount > 0) {
    warnings.push(`같은 내용의 출처 ${duplicateCount}개를 중복으로 제외했습니다.`);
  }
  if (budgetOmissionCount > 0) {
    warnings.push(`컨텍스트 토큰 예산으로 출처 ${budgetOmissionCount}개를 제외했습니다.`);
  }
  if (candidates.length > 0 && sources.length === 0) {
    warnings.push("선택한 출처가 하나도 포함되지 않았습니다. 작업 프로필의 토큰 예산을 늘리세요.");
  }
  const contextText = sourceBlocks.length > 0
    ? sourceBlocks.join("\n\n")
    : "선택되어 포함된 출처 없음";
  const warningText = warnings.length > 0
    ? `\n\n컨텍스트 경고:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  const input = `프로젝트: ${value.projectName}\n${contextText}${warningText}\n\n사용자 요청:\n${value.userText}`;
  estimatedTokens = EstimateTokenCount(`${instructions}\n${input}`);
  return {
    instructions,
    input,
    snapshot: {
      snapshotId: `context-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      persona: {
        personaId: value.activePersona.persona.personaId,
        versionId: value.activePersona.version.versionId,
        version: value.activePersona.version.version,
        name: value.activePersona.version.name,
        systemInstructions: value.activePersona.version.systemInstructions,
        workStyle: value.activePersona.version.workStyle,
        styleGuide: value.activePersona.version.styleGuide,
        forbiddenExpressions: [...value.activePersona.version.forbiddenExpressions],
        referencePriorities: [...value.activePersona.version.referencePriorities],
      },
      profile: {
        profileId: value.activePersona.profile.profileId,
        name: value.activePersona.profile.name,
        instructions: value.activePersona.profile.instructions,
        contextTokenBudget: budget,
      },
      requestedSourceCount: candidates.length,
      includedSourceCount: sources.length,
      omittedSourceCount,
      estimatedInputTokens: estimatedTokens,
      warnings,
      omissions,
      sources,
    },
  };
}

export function EstimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

export function FinalizePairWriterContextSnapshot(
  snapshot: GongpilContextSnapshot,
  trace: GongpilPairWriterRetrievalTrace,
  dynamicToolsEnabled: boolean,
): GongpilContextSnapshot {
  const contentHashes = new Set(snapshot.sources.map((source) => source.contentSha256));
  const automaticSources: GongpilDocumentSourceSnapshot[] = [];
  const omissions = trace.omissions.map((omission): GongpilContextOmissionSnapshot => ({
    sourceReference: omission.chunkId,
    sourceKind: "document",
    reason: omission.reason,
  }));
  for (const chunk of trace.retrievedChunks) {
    const source = CreateDocumentSource(chunk, "pair-writer");
    if (contentHashes.has(source.contentSha256)) {
      if (!omissions.some((omission) => omission.sourceReference === chunk.chunkId)) {
        omissions.push(CreateOmission(source, "duplicate"));
      }
      continue;
    }
    automaticSources.push(source);
    contentHashes.add(source.contentSha256);
  }
  const automaticWarnings = [...trace.warnings];
  if (!dynamicToolsEnabled) {
    automaticWarnings.push("현재 Codex 버전이 자동 청크 검색 도구를 지원하지 않아 명시 선택 컨텍스트만 사용했습니다.");
  }
  const uniqueWarnings = [...new Set([...snapshot.warnings, ...automaticWarnings])];
  const estimatedAutomaticTokens = automaticSources.reduce(
    (total, source, index) => total + EstimateTokenCount(CreateSourceBlock(source, snapshot.sources.length + index + 1)),
    0,
  );
  return {
    ...snapshot,
    requestedSourceCount: snapshot.requestedSourceCount + new Set(trace.requestedChunkIds).size,
    includedSourceCount: snapshot.includedSourceCount + automaticSources.length,
    omittedSourceCount: snapshot.omittedSourceCount + omissions.length,
    estimatedInputTokens: snapshot.estimatedInputTokens + estimatedAutomaticTokens,
    warnings: uniqueWarnings,
    omissions: [...snapshot.omissions.map((omission) => ({ ...omission })), ...omissions],
    sources: [...snapshot.sources.map(CloneSource), ...automaticSources],
    automaticRetrieval: {
      dynamicToolsEnabled,
      searchQueries: [...trace.searchQueries],
      requestedChunkIds: [...trace.requestedChunkIds],
      includedChunkIds: automaticSources
        .map((source) => source.chunkId)
        .filter((chunkId): chunkId is string => chunkId !== undefined),
      warnings: automaticWarnings,
    },
  };
}

function CreateInstructions(
  baseInstructions: string,
  activePersona: GongpilActivePersonaContext,
): string {
  const forbidden = activePersona.version.forbiddenExpressions.length > 0
    ? activePersona.version.forbiddenExpressions.join(", ")
    : "없음";
  const priorities = activePersona.version.referencePriorities.length > 0
    ? activePersona.version.referencePriorities.join(" > ")
    : "명시된 출처 우선";
  return [
    baseInstructions,
    "",
    `[페르소나 ${activePersona.version.name} v${activePersona.version.version}]`,
    `시스템 지시: ${activePersona.version.systemInstructions}`,
    `작업 방식: ${activePersona.version.workStyle || "별도 지정 없음"}`,
    `문체 기준: ${activePersona.version.styleGuide || "별도 지정 없음"}`,
    `금지 표현: ${forbidden}`,
    `참조 우선순위: ${priorities}`,
    `[작업 프로필 ${activePersona.profile.name}]`,
    activePersona.profile.instructions || "별도 프로필 지시 없음",
  ].join("\n");
}

function CreateSourceCandidates(
  selectedChunks: readonly GongpilChunkDescriptor[],
  selectedHistoryChunks: readonly GongpilChatHistoryChunk[],
  activeDocument?: GongpilDocumentSnapshot,
): GongpilSourceSnapshot[] {
  const documentSources: GongpilDocumentSourceSnapshot[] = [];
  if (selectedChunks.length > 0) {
    const uniqueChunks = new Map<string, GongpilChunkDescriptor>();
    for (const chunk of selectedChunks) {
      if (!uniqueChunks.has(chunk.chunkId)) {
        uniqueChunks.set(chunk.chunkId, chunk);
      }
    }
    documentSources.push(...[...uniqueChunks.values()].map((chunk) => CreateDocumentSource(chunk, "explicit")));
  }
  else if (activeDocument !== undefined) {
    documentSources.push({
      sourceId: `source-${randomUUID()}`,
      sourceKind: "document",
      selectionKind: "active-document",
      fileId: activeDocument.fileId,
      path: activeDocument.path,
      revision: activeDocument.revision,
      title: activeDocument.name,
      byteStart: 0,
      byteEnd: Buffer.byteLength(activeDocument.content, "utf8"),
      lineStart: 1,
      lineEnd: Math.max(1, activeDocument.content.split(/\r?\n/).length),
      content: activeDocument.content,
      contentSha256: CreateContentHash(activeDocument.content),
    });
  }
  const uniqueHistoryChunks = new Map<string, GongpilChatHistoryChunk>();
  for (const chunk of selectedHistoryChunks) {
    if (!uniqueHistoryChunks.has(chunk.chunkId)) {
      uniqueHistoryChunks.set(chunk.chunkId, chunk);
    }
  }
  const conversationSources: GongpilConversationSourceSnapshot[] = [...uniqueHistoryChunks.values()].map((chunk) => ({
    sourceId: `source-${randomUUID()}`,
    sourceKind: "conversation",
    selectionKind: "conversation",
    historyChunkId: chunk.chunkId,
    messageId: chunk.messageId,
    turnId: chunk.turnId,
    role: chunk.role,
    createdAt: chunk.createdAt,
    classification: chunk.classification,
    byteStart: chunk.byteStart,
    byteEnd: chunk.byteEnd,
    content: chunk.content,
    contentSha256: chunk.contentSha256,
  }));
  return [...documentSources, ...conversationSources];
}

function CreateSourceBlock(source: GongpilSourceSnapshot, index: number): string {
  if (source.sourceKind === "conversation") {
    const classification = FormatClassification(source.classification);
    return [
      `--- 출처 ${index} (이전 대화) ---`,
      `역할: ${source.role}`,
      `시간: ${source.createdAt}`,
      `턴: ${source.turnId}`,
      `메시지: ${source.messageId}`,
      `분류: ${classification}`,
      `UTF-8 bytes: [${source.byteStart}, ${source.byteEnd})`,
      source.content,
      `--- 출처 ${index} 끝 ---`,
    ].join("\n");
  }
  const selectionLabel = source.selectionKind === "explicit"
    ? "명시 선택"
    : source.selectionKind === "pair-writer"
      ? "페어 작가 자동 참조"
      : "현재 문서";
  return [
    `--- 출처 ${index} (${selectionLabel}) ---`,
    `문서: ${source.path}`,
    `revision: ${source.revision}`,
    `UTF-8 bytes: [${source.byteStart}, ${source.byteEnd})`,
    `lines: ${source.lineStart}-${source.lineEnd}`,
    `제목: ${source.title}`,
    source.content,
    `--- 출처 ${index} 끝 ---`,
  ].join("\n");
}

function CreateOmission(
  source: GongpilSourceSnapshot,
  reason: GongpilContextOmissionSnapshot["reason"],
): GongpilContextOmissionSnapshot {
  return {
    sourceReference: source.sourceKind === "conversation"
      ? source.historyChunkId
      : source.chunkId ?? source.fileId,
    sourceKind: source.sourceKind,
    reason,
  };
}

function FormatClassification(classification: GongpilChatClassification | undefined): string {
  if (classification === undefined) {
    return "미분류";
  }
  const values = [
    classification.topic === undefined ? undefined : `주제=${classification.topic}`,
    classification.task === undefined ? undefined : `작업=${classification.task}`,
    classification.session === undefined ? undefined : `세션=${classification.session}`,
    classification.labels === undefined ? undefined : `라벨=${classification.labels.join(", ")}`,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0 ? values.join("; ") : "미분류";
}

function CreateContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function CreateDocumentSource(
  chunk: GongpilChunkDescriptor,
  selectionKind: GongpilDocumentSourceSnapshot["selectionKind"],
): GongpilDocumentSourceSnapshot {
  return {
    sourceId: `source-${randomUUID()}`,
    sourceKind: "document",
    selectionKind,
    chunkId: chunk.chunkId,
    fileId: chunk.fileId,
    path: chunk.path,
    revision: chunk.revision,
    title: chunk.title,
    byteStart: chunk.coordinate.byteStart,
    byteEnd: chunk.coordinate.byteEnd,
    lineStart: chunk.coordinate.lineStart,
    lineEnd: chunk.coordinate.lineEnd,
    content: chunk.content,
    contentSha256: CreateContentHash(chunk.content),
  };
}

function CloneSource(source: GongpilSourceSnapshot): GongpilSourceSnapshot {
  return source.sourceKind === "conversation"
    ? {
      ...source,
      classification: source.classification === undefined
        ? undefined
        : { ...source.classification, labels: source.classification.labels === undefined
          ? undefined
          : [...source.classification.labels] },
    }
    : { ...source };
}
