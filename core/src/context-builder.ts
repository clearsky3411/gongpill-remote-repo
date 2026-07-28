import { createHash, randomUUID } from "node:crypto";

import type { GongpilChunkDescriptor } from "./chunk-parser.ts";
import type { GongpilDocumentSnapshot } from "./document-store.ts";
import type { GongpilActivePersonaContext } from "./persona-store.ts";

export interface GongpilSourceSnapshot {
  sourceId: string;
  selectionKind: "explicit" | "active-document";
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
  sources: GongpilSourceSnapshot[];
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
  activeDocument?: GongpilDocumentSnapshot;
}): GongpilBuiltWritingContext {
  const instructions = CreateInstructions(value.baseInstructions, value.activePersona);
  const candidates = CreateSourceCandidates(value.selectedChunks ?? [], value.activeDocument);
  const fixedInput = `프로젝트: ${value.projectName}\n사용자 요청:\n${value.userText}`;
  const budget = value.activePersona.profile.contextTokenBudget;
  const fixedEstimatedTokens = EstimateTokenCount(`${instructions}\n${fixedInput}`);
  let estimatedTokens = fixedEstimatedTokens;
  const sources: GongpilSourceSnapshot[] = [];
  const sourceBlocks: string[] = [];
  for (const candidate of candidates) {
    const block = CreateSourceBlock(candidate, sourceBlocks.length + 1);
    const blockTokens = EstimateTokenCount(block);
    if (estimatedTokens + blockTokens > budget) {
      continue;
    }
    sources.push(candidate);
    sourceBlocks.push(block);
    estimatedTokens += blockTokens;
  }
  const omittedSourceCount = candidates.length - sources.length;
  const warnings: string[] = [];
  if (fixedEstimatedTokens > budget) {
    warnings.push("페르소나 지시와 사용자 요청만으로 작업 프로필의 토큰 예산을 초과했습니다.");
  }
  if (omittedSourceCount > 0) {
    warnings.push(`컨텍스트 토큰 예산으로 출처 ${omittedSourceCount}개를 제외했습니다.`);
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
      sources,
    },
  };
}

export function EstimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
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
  activeDocument?: GongpilDocumentSnapshot,
): GongpilSourceSnapshot[] {
  if (selectedChunks.length > 0) {
    const uniqueChunks = new Map<string, GongpilChunkDescriptor>();
    for (const chunk of selectedChunks) {
      if (!uniqueChunks.has(chunk.chunkId)) {
        uniqueChunks.set(chunk.chunkId, chunk);
      }
    }
    return [...uniqueChunks.values()].map((chunk) => ({
      sourceId: `source-${randomUUID()}`,
      selectionKind: "explicit",
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
    }));
  }
  if (activeDocument === undefined) {
    return [];
  }
  return [{
    sourceId: `source-${randomUUID()}`,
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
  }];
}

function CreateSourceBlock(source: GongpilSourceSnapshot, index: number): string {
  return [
    `--- 출처 ${index} (${source.selectionKind === "explicit" ? "명시 선택" : "현재 문서"}) ---`,
    `문서: ${source.path}`,
    `revision: ${source.revision}`,
    `UTF-8 bytes: [${source.byteStart}, ${source.byteEnd})`,
    `lines: ${source.lineStart}-${source.lineEnd}`,
    `제목: ${source.title}`,
    source.content,
    `--- 출처 ${index} 끝 ---`,
  ].join("\n");
}

function CreateContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
