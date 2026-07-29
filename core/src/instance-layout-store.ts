import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const GONGPIL_INSTANCE_PANEL_IDS = ["projects", "documents", "editor", "co-writer"] as const;
export type GongpilInstancePanelId = typeof GONGPIL_INSTANCE_PANEL_IDS[number];

export interface GongpilInstancePanelLayout {
  collapsed: boolean;
  widthCssPx: number;
}

export interface GongpilInstanceLayout {
  schemaVersion: 1;
  panelOrder: GongpilInstancePanelId[];
  panels: Record<GongpilInstancePanelId, GongpilInstancePanelLayout>;
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
          "Instance 작업 영역 설정 파일이 손상되었습니다.",
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
    schemaVersion: 1,
    panelOrder: [...GONGPIL_INSTANCE_PANEL_IDS],
    panels: {
      projects: { collapsed: false, widthCssPx: 210 },
      documents: { collapsed: false, widthCssPx: 240 },
      editor: { collapsed: false, widthCssPx: 640 },
      "co-writer": { collapsed: false, widthCssPx: 420 },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function NormalizeLayout(value: unknown, updatedAtOverride: string | undefined): GongpilInstanceLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.panelOrder)) {
    throw InvalidLayout();
  }
  const panelOrder = candidate.panelOrder.map((panelId) => RequirePanelId(panelId));
  if (panelOrder.length !== GONGPIL_INSTANCE_PANEL_IDS.length || new Set(panelOrder).size !== panelOrder.length) {
    throw InvalidLayout("모든 작업 영역은 순서에 정확히 한 번씩 포함되어야 합니다.");
  }
  for (const panelId of GONGPIL_INSTANCE_PANEL_IDS) {
    if (!panelOrder.includes(panelId)) {
      throw InvalidLayout("모든 작업 영역은 순서에 정확히 한 번씩 포함되어야 합니다.");
    }
  }
  if (typeof candidate.panels !== "object" || candidate.panels === null || Array.isArray(candidate.panels)) {
    throw InvalidLayout();
  }
  const panelsCandidate = candidate.panels as Readonly<Record<string, unknown>>;
  if (Object.keys(panelsCandidate).sort().join("|") !== [...GONGPIL_INSTANCE_PANEL_IDS].sort().join("|")) {
    throw InvalidLayout("작업 영역 설정의 ID 구성이 올바르지 않습니다.");
  }
  const panels = Object.fromEntries(GONGPIL_INSTANCE_PANEL_IDS.map((panelId) => [
    panelId,
    NormalizePanel(panelId, panelsCandidate[panelId]),
  ])) as unknown as GongpilInstanceLayout["panels"];
  const updatedAt = updatedAtOverride ?? RequireTimestamp(candidate.updatedAt);
  return { schemaVersion: 1, panelOrder, panels, updatedAt };
}

function NormalizePanel(panelId: GongpilInstancePanelId, value: unknown): GongpilInstancePanelLayout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw InvalidLayout();
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate.collapsed !== "boolean" || !Number.isSafeInteger(candidate.widthCssPx)) {
    throw InvalidLayout();
  }
  const [minimum, maximum] = PanelWidthRange(panelId);
  const widthCssPx = candidate.widthCssPx as number;
  if (widthCssPx < minimum || widthCssPx > maximum) {
    throw InvalidLayout(`${panelId} 작업 영역 너비는 ${minimum}~${maximum} CSS px여야 합니다.`);
  }
  return { collapsed: candidate.collapsed, widthCssPx };
}

function RequirePanelId(value: unknown): GongpilInstancePanelId {
  if (typeof value !== "string" || !(GONGPIL_INSTANCE_PANEL_IDS as readonly string[]).includes(value)) {
    throw InvalidLayout("알 수 없는 작업 영역 ID가 있습니다.");
  }
  return value as GongpilInstancePanelId;
}

function RequireTimestamp(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw InvalidLayout("작업 영역 설정 시각이 올바르지 않습니다.");
  }
  return value;
}

function PanelWidthRange(panelId: GongpilInstancePanelId): readonly [number, number] {
  switch (panelId) {
    case "projects": return [160, 480];
    case "documents": return [180, 560];
    case "editor": return [360, 1600];
    case "co-writer": return [300, 1000];
  }
}

function InvalidLayout(message = "Instance 작업 영역 설정 형식이 올바르지 않습니다."): GongpilInstanceLayoutStoreError {
  return new GongpilInstanceLayoutStoreError("INSTANCE_LAYOUT_INVALID", message);
}

function RemoveByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
