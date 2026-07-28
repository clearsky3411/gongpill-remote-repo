import { createHash } from "node:crypto";
import { extname } from "node:path";

import type { GongpilDocumentSnapshot } from "./document-store.ts";

const MAX_CHUNK_BYTES = 32 * 1024;

export interface GongpilChunkCoordinate {
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
  display: string;
}

export interface GongpilChunkDescriptor {
  chunkId: string;
  fileId: string;
  path: string;
  revision: string;
  format: "markdown" | "json" | "text";
  kind: "markdown-section" | "json-property" | "json-item" | "json-root" | "text-paragraph";
  title: string;
  ordinal: number;
  coordinate: GongpilChunkCoordinate;
  content: string;
  preview: string;
}

interface CharacterRange {
  start: number;
  end: number;
  kind: GongpilChunkDescriptor["kind"];
  title: string;
}

interface CoordinateIndex {
  byteOffsets: Uint32Array;
  lineStarts: number[];
}

export function ParseDocumentChunks(
  document: GongpilDocumentSnapshot,
): GongpilChunkDescriptor[] {
  const format = ResolveFormat(document.path);
  const ranges = format === "markdown"
    ? ParseMarkdownRanges(document.content)
    : format === "json"
      ? ParseJsonRanges(document.content)
      : ParseTextRanges(document.content);
  const index = CreateCoordinateIndex(document.content);
  const splitRanges = ranges.flatMap((range) => SplitOversizedRange(document.content, index, range));
  return splitRanges.map((range, ordinal) => CreateChunk(document, format, index, range, ordinal));
}

function ParseMarkdownRanges(content: string): CharacterRange[] {
  const headings = [...content.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/gm)];
  if (headings.length === 0) {
    return ParseTextRanges(content).map((range) => ({ ...range, kind: "markdown-section" }));
  }
  const ranges: CharacterRange[] = [];
  const firstStart = headings[0].index ?? 0;
  AddTrimmedRange(ranges, content, 0, firstStart, "markdown-section", "도입부");
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const start = heading.index ?? 0;
    const end = index + 1 < headings.length ? headings[index + 1].index ?? content.length : content.length;
    AddTrimmedRange(
      ranges,
      content,
      start,
      end,
      "markdown-section",
      (heading[2] ?? "제목 없음").trim(),
    );
  }
  return ranges;
}

function ParseJsonRanges(content: string): CharacterRange[] {
  try {
    JSON.parse(content);
  }
  catch {
    return ParseTextRanges(content).map((range) => ({ ...range, kind: "json-root", title: "JSON 원문" }));
  }
  const rootStart = SkipWhitespaceForward(content, 0, content.length);
  const rootEnd = SkipWhitespaceBackward(content, rootStart, content.length);
  if (rootStart >= rootEnd || (content[rootStart] !== "{" && content[rootStart] !== "[")) {
    return [{ start: rootStart, end: rootEnd, kind: "json-root", title: "JSON 값" }];
  }
  const entries = SplitJsonContainer(content, rootStart, rootEnd);
  return entries.length === 0
    ? [{ start: rootStart, end: rootEnd, kind: "json-root", title: "빈 JSON" }]
    : entries;
}

function SplitJsonContainer(content: string, rootStart: number, rootEnd: number): CharacterRange[] {
  const isObject = content[rootStart] === "{";
  const ranges: CharacterRange[] = [];
  let entryStart = rootStart + 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const closeIndex = rootEnd - 1;
  const pushEntry = (rawStart: number, rawEnd: number): void => {
    const start = SkipWhitespaceForward(content, rawStart, rawEnd);
    const end = SkipWhitespaceBackward(content, start, rawEnd);
    if (start >= end) {
      return;
    }
    const ordinal = ranges.length;
    ranges.push({
      start,
      end,
      kind: isObject ? "json-property" : "json-item",
      title: isObject ? ReadJsonPropertyTitle(content.slice(start, end), ordinal) : `[${ordinal}]`,
    });
  };
  for (let index = rootStart + 1; index < closeIndex; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      }
      else if (character === "\\") {
        escaped = true;
      }
      else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 0) {
      pushEntry(entryStart, index);
      entryStart = index + 1;
    }
  }
  pushEntry(entryStart, closeIndex);
  return ranges;
}

function ReadJsonPropertyTitle(entry: string, ordinal: number): string {
  const match = /^\s*("(?:\\.|[^"\\])*")\s*:/.exec(entry);
  if (match === null) {
    return `속성 ${ordinal + 1}`;
  }
  try {
    return String(JSON.parse(match[1]));
  }
  catch {
    return `속성 ${ordinal + 1}`;
  }
}

function ParseTextRanges(content: string): CharacterRange[] {
  const ranges: CharacterRange[] = [];
  let start = 0;
  for (const separator of content.matchAll(/\r?\n[ \t]*\r?\n+/g)) {
    const separatorStart = separator.index ?? content.length;
    AddTrimmedRange(ranges, content, start, separatorStart, "text-paragraph", `문단 ${ranges.length + 1}`);
    start = separatorStart + separator[0].length;
  }
  AddTrimmedRange(ranges, content, start, content.length, "text-paragraph", `문단 ${ranges.length + 1}`);
  if (ranges.length === 0 && content.length === 0) {
    ranges.push({ start: 0, end: 0, kind: "text-paragraph", title: "빈 문서" });
  }
  return ranges;
}

function AddTrimmedRange(
  ranges: CharacterRange[],
  content: string,
  rawStart: number,
  rawEnd: number,
  kind: CharacterRange["kind"],
  title: string,
): void {
  const start = SkipWhitespaceForward(content, rawStart, rawEnd);
  const end = SkipWhitespaceBackward(content, start, rawEnd);
  if (start < end) {
    ranges.push({ start, end, kind, title });
  }
}

function SplitOversizedRange(
  content: string,
  index: CoordinateIndex,
  range: CharacterRange,
): CharacterRange[] {
  if (index.byteOffsets[range.end] - index.byteOffsets[range.start] <= MAX_CHUNK_BYTES) {
    return [range];
  }
  const parts: CharacterRange[] = [];
  let start = range.start;
  let part = 1;
  while (start < range.end) {
    const targetByte = index.byteOffsets[start] + MAX_CHUNK_BYTES;
    let low = start + 1;
    let high = range.end;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (index.byteOffsets[middle] <= targetByte) {
        low = middle;
      }
      else {
        high = middle - 1;
      }
    }
    let end = Math.max(start + 1, low);
    const newline = content.lastIndexOf("\n", end - 1);
    if (newline > start + 256) {
      end = newline + 1;
    }
    if (end < range.end && IsLowSurrogate(content.charCodeAt(end))) {
      end -= 1;
    }
    parts.push({ ...range, start, end, title: `${range.title} · ${part}` });
    start = end;
    part += 1;
  }
  return parts;
}

function CreateChunk(
  document: GongpilDocumentSnapshot,
  format: GongpilChunkDescriptor["format"],
  index: CoordinateIndex,
  range: CharacterRange,
  ordinal: number,
): GongpilChunkDescriptor {
  const byteStart = index.byteOffsets[range.start];
  const byteEnd = index.byteOffsets[range.end];
  const lineStart = FindLine(index.lineStarts, range.start);
  const lineEnd = FindLine(index.lineStarts, Math.max(range.start, range.end - 1));
  const content = document.content.slice(range.start, range.end);
  const identity = `${document.fileId}\0${document.revision}\0${byteStart}\0${byteEnd}\0${range.kind}`;
  return {
    chunkId: `chunk-${createHash("sha256").update(identity).digest("hex").slice(0, 28)}`,
    fileId: document.fileId,
    path: document.path,
    revision: document.revision,
    format,
    kind: range.kind,
    title: range.title,
    ordinal,
    coordinate: {
      byteStart,
      byteEnd,
      lineStart,
      lineEnd,
      display: `${byteStart.toString(16).toUpperCase().padStart(8, "0")}-${byteEnd.toString(16).toUpperCase().padStart(8, "0")}`,
    },
    content,
    preview: content.replace(/\s+/g, " ").trim().slice(0, 180),
  };
}

function CreateCoordinateIndex(content: string): CoordinateIndex {
  const byteOffsets = new Uint32Array(content.length + 1);
  const lineStarts = [0];
  let byteOffset = 0;
  for (let index = 0; index < content.length;) {
    byteOffsets[index] = byteOffset;
    const codePoint = content.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    byteOffset += Buffer.byteLength(String.fromCodePoint(codePoint), "utf8");
    if (width === 2) {
      byteOffsets[index + 1] = byteOffsets[index];
    }
    index += width;
    byteOffsets[index] = byteOffset;
  }
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return { byteOffsets, lineStarts };
}

function FindLine(lineStarts: number[], characterIndex: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= characterIndex) {
      low = middle + 1;
    }
    else {
      high = middle - 1;
    }
  }
  return high + 1;
}

function SkipWhitespaceForward(content: string, start: number, end: number): number {
  while (start < end && /\s/.test(content[start])) {
    start += 1;
  }
  return start;
}

function SkipWhitespaceBackward(content: string, start: number, end: number): number {
  while (end > start && /\s/.test(content[end - 1])) {
    end -= 1;
  }
  return end;
}

function ResolveFormat(path: string): GongpilChunkDescriptor["format"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  return extension === ".json" ? "json" : "text";
}

function IsLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}
