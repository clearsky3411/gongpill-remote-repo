import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const GONGPIL_PART_WINDOW_IDS = ["projects", "documents", "editor", "co-writer"] as const;
export const GONGPIL_CO_WRITER_PART_SECTION_IDS = ["context", "chat", "request"] as const;
export type GongpilPartWindowId = typeof GONGPIL_PART_WINDOW_IDS[number];
export type GongpilCoWriterPartSectionId = typeof GONGPIL_CO_WRITER_PART_SECTION_IDS[number];

export interface GongpilPartWindowLayout {
  minimized: boolean;
  widthCssPx: number;
}

export interface GongpilPartSectionLayout {
  collapsed: boolean;
  heightCssPx: number;
}

export interface GongpilCoWriterLayout {
  partSectionOrder: GongpilCoWriterPartSectionId[];
  partSections: Record<GongpilCoWriterPartSectionId, GongpilPartSectionLayout>;
}

export interface GongpilInstanceLayout {
  schemaVersion: 2;
  partWindowOrder: GongpilPartWindowId[];
  partWindows: Record<GongpilPartWindowId, GongpilPartWindowLayout>;
  coWriter: GongpilCoWriterLayout;
  updatedAt: string;
}

export class GongpilInstanceLayoutStoreError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilInstanceLayoutStoreError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilInstanceLayoutStore {
  public constructor(dataRoot: string) {
    this.layoutPath = join(dataRoot, "settings", "instance-layout.json");
  }

  public async Read(): Promise<GongpilInstanceLayout> {
    return await this.RunExclusive(async () => await this.ReadUnsafe());
  }

  public async Update(value: unknown): Promise<GongpilInstanceLayout> {
    return await this.RunExclusive(async () => {
      const layout = NormalizeLayout(value, new Date().toISOString());
      await this.Write(layout);
      return layout;
    });
  }

  public GetLayoutPath(): string {
    return this.layoutPath;
  }

  private async ReadUnsafe(): Promise<GongpilInstanceLayout> {
    try {
      const value = JSON.parse(RemoveByteOrderMark(await readFile(this.layoutPath, "utf8")));
      return NormalizeLayout(value, undefined);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return CreateDefaultInstanceLayout();
      }
      if (error instanceof SyntaxError) {
        throw new GongpilInstanceLayoutStoreError(
          "INSTANCE_LAYOUT_CORRUPT",
          "Instance Part Window 설정 파일이 손상되었습니다.",
        );
      }
      throw error;
    }
  }

  private async Write(layout: GongpilInstanceLayout): Promise<void> {
    const layoutRoot = dirname(this.layoutPath);
    await mkdir(layoutRoot, { recursive: true });
    const temporaryPath = `${this.layoutPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(layout, null, 2)}\n`, "utf8");
      await handle.sync();
    }
    finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.layoutPath);
    }
    catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async RunExclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(action, action);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return await result;
  }

  private readonly layoutPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();
}

export function CreateDefaultInstanceLayout(): GongpilInstanceLayout {
  return {
    schemaVersion: 2,
    partWindowOrder: [...GONGPIL_PART_WINDOW_IDS],
    partWindows: {
      projects: { minimized: false, widthCssPx: 210 },
      documents: { minimized: false, widthCssPx: 240 },
      editor: { minimized: false, widthCssPx: 640 },
      "co-writer": { minimized: false, widthCssPx: 420 },
    },
    coWriter: {
      partSectionOrder: [...GONGPIL_CO_WRITER_PART_SECTION_IDS],
      partSections: {
        context: { collapsed: true, heightCssPx: 280 },
        chat: { collapsed: false, heightCssPx: 420 },
        request: { collapsed: false, heightCssPx: 240 },
      },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function NormalizeLayout(value: unknown, updatedAtOverride: string | undefined): GongpilInstanceLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.schemaVersion === 1) {
    return MigrateVersionOneLayout(candidate, updatedAtOverride);
  }
  if (candidate.schemaVersion !== 2) {
    throw InvalidLayout("지원하지 않는 Instance Part Window 설정 버전입니다.");
  }
  const partWindowOrder = NormalizeIdentifierOrder(
    candidate.partWindowOrder,
    GONGPIL_PART_WINDOW_IDS,
    RequirePartWindowId,
    "모든 Part Window는 순서에 정확히 한 번씩 포함되어야 합니다.",
  );
  const partWindowsCandidate = RequireExactRecord(
    candidate.partWindows,
    GONGPIL_PART_WINDOW_IDS,
    "Part Window 설정의 ID 구성이 올바르지 않습니다.",
  );
  const partWindows = Object.fromEntries(GONGPIL_PART_WINDOW_IDS.map((partWindowId) => [
    partWindowId,
    NormalizePartWindow(partWindowId, partWindowsCandidate[partWindowId]),
  ])) as unknown as GongpilInstanceLayout["partWindows"];
  const coWriter = NormalizeCoWriter(candidate.coWriter);
  const updatedAt = updatedAtOverride ?? RequireTimestamp(candidate.updatedAt);
  return { schemaVersion: 2, partWindowOrder, partWindows, coWriter, updatedAt };
}

function MigrateVersionOneLayout(
  candidate: Readonly<Record<string, unknown>>,
  updatedAtOverride: string | undefined,
): GongpilInstanceLayout {
  const partWindowOrder = NormalizeIdentifierOrder(
    candidate.panelOrder,
    GONGPIL_PART_WINDOW_IDS,
    RequirePartWindowId,
    "모든 작업 영역은 순서에 정확히 한 번씩 포함되어야 합니다.",
  );
  const panelsCandidate = RequireExactRecord(
    candidate.panels,
    GONGPIL_PART_WINDOW_IDS,
    "작업 영역 설정의 ID 구성이 올바르지 않습니다.",
  );
  const defaults = CreateDefaultInstanceLayout();
  const partWindows = Object.fromEntries(GONGPIL_PART_WINDOW_IDS.map((partWindowId) => {
    const panel = NormalizeVersionOnePanel(partWindowId, panelsCandidate[partWindowId]);
    return [partWindowId, { minimized: panel.collapsed, widthCssPx: panel.widthCssPx }];
  })) as unknown as GongpilInstanceLayout["partWindows"];
  return {
    schemaVersion: 2,
    partWindowOrder,
    partWindows,
    coWriter: defaults.coWriter,
    updatedAt: updatedAtOverride ?? RequireTimestamp(candidate.updatedAt),
  };
}

function NormalizeCoWriter(value: unknown): GongpilCoWriterLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout("공동 집필 Part Section 설정이 올바르지 않습니다.");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const partSectionOrder = NormalizeIdentifierOrder(
    candidate.partSectionOrder,
    GONGPIL_CO_WRITER_PART_SECTION_IDS,
    RequirePartSectionId,
    "모든 공동 집필 Part Section은 순서에 정확히 한 번씩 포함되어야 합니다.",
  );
  const partSectionsCandidate = RequireExactRecord(
    candidate.partSections,
    GONGPIL_CO_WRITER_PART_SECTION_IDS,
    "공동 집필 Part Section 설정의 ID 구성이 올바르지 않습니다.",
  );
  const partSections = Object.fromEntries(GONGPIL_CO_WRITER_PART_SECTION_IDS.map((partSectionId) => [
    partSectionId,
    NormalizePartSection(partSectionId, partSectionsCandidate[partSectionId]),
  ])) as unknown as GongpilCoWriterLayout["partSections"];
  return { partSectionOrder, partSections };
}

function NormalizePartWindow(partWindowId: GongpilPartWindowId, value: unknown): GongpilPartWindowLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate.minimized !== "boolean" || !Number.isSafeInteger(candidate.widthCssPx)) {
    throw InvalidLayout();
  }
  const widthCssPx = RequireSizeInRange(
    candidate.widthCssPx as number,
    PartWindowWidthRange(partWindowId),
    `${partWindowId} Part Window 너비`,
  );
  return { minimized: candidate.minimized, widthCssPx };
}

function NormalizePartSection(
  partSectionId: GongpilCoWriterPartSectionId,
  value: unknown,
): GongpilPartSectionLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate.collapsed !== "boolean" || !Number.isSafeInteger(candidate.heightCssPx)) {
    throw InvalidLayout();
  }
  const heightCssPx = RequireSizeInRange(
    candidate.heightCssPx as number,
    PartSectionHeightRange(partSectionId),
    `${partSectionId} Part Section 높이`,
  );
  return { collapsed: candidate.collapsed, heightCssPx };
}

function NormalizeVersionOnePanel(
  partWindowId: GongpilPartWindowId,
  value: unknown,
): { collapsed: boolean; widthCssPx: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate.collapsed !== "boolean" || !Number.isSafeInteger(candidate.widthCssPx)) {
    throw InvalidLayout();
  }
  const widthCssPx = RequireSizeInRange(
    candidate.widthCssPx as number,
    PartWindowWidthRange(partWindowId),
    `${partWindowId} 작업 영역 너비`,
  );
  return { collapsed: candidate.collapsed, widthCssPx };
}

function NormalizeIdentifierOrder<T extends string>(
  value: unknown,
  identifiers: readonly T[],
  requireIdentifier: (candidate: unknown) => T,
  message: string,
): T[] {
  if (!Array.isArray(value)) {
    throw InvalidLayout();
  }
  const order = value.map((identifier) => requireIdentifier(identifier));
  if (order.length !== identifiers.length || new Set(order).size !== order.length) {
    throw InvalidLayout(message);
  }
  for (const identifier of identifiers) {
    if (!order.includes(identifier)) {
      throw InvalidLayout(message);
    }
  }
  return order;
}

function RequireExactRecord<T extends string>(
  value: unknown,
  identifiers: readonly T[],
  message: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (Object.keys(candidate).sort().join("|") !== [...identifiers].sort().join("|")) {
    throw InvalidLayout(message);
  }
  return candidate;
}

function RequirePartWindowId(value: unknown): GongpilPartWindowId {
  if (typeof value !== "string" || !(GONGPIL_PART_WINDOW_IDS as readonly string[]).includes(value)) {
    throw InvalidLayout("알 수 없는 Part Window ID가 있습니다.");
  }
  return value as GongpilPartWindowId;
}

function RequirePartSectionId(value: unknown): GongpilCoWriterPartSectionId {
  if (typeof value !== "string" || !(GONGPIL_CO_WRITER_PART_SECTION_IDS as readonly string[]).includes(value)) {
    throw InvalidLayout("알 수 없는 공동 집필 Part Section ID가 있습니다.");
  }
  return value as GongpilCoWriterPartSectionId;
}

function RequireTimestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw InvalidLayout("Instance Part Window 설정 시각이 올바르지 않습니다.");
  }
  return value;
}

function RequireSizeInRange(value: number, range: readonly [number, number], label: string): number {
  if (value < range[0] || value > range[1]) {
    throw InvalidLayout(`${label}는 ${range[0]}~${range[1]} CSS px여야 합니다.`);
  }
  return value;
}

function PartWindowWidthRange(partWindowId: GongpilPartWindowId): readonly [number, number] {
  switch (partWindowId) {
    case "projects": return [160, 480];
    case "documents": return [180, 560];
    case "editor": return [360, 1600];
    case "co-writer": return [300, 1000];
  }
}

function PartSectionHeightRange(partSectionId: GongpilCoWriterPartSectionId): readonly [number, number] {
  switch (partSectionId) {
    case "context": return [160, 800];
    case "chat": return [240, 1200];
    case "request": return [140, 480];
  }
}

function InvalidLayout(message = "Instance Part Window 설정 형식이 올바르지 않습니다."): GongpilInstanceLayoutStoreError {
  return new GongpilInstanceLayoutStoreError("INSTANCE_LAYOUT_INVALID", message);
}

function RemoveByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
