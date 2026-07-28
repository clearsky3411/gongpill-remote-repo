import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_CONTEXT_TOKEN_BUDGET = 32_000;

export interface GongpilPersonaVersion {
  versionId: string;
  version: number;
  name: string;
  systemInstructions: string;
  workStyle: string;
  styleGuide: string;
  forbiddenExpressions: string[];
  referencePriorities: string[];
  createdAt: string;
}

export interface GongpilPersona {
  personaId: string;
  name: string;
  versions: GongpilPersonaVersion[];
}

export interface GongpilWorkProfile {
  profileId: string;
  name: string;
  instructions: string;
  contextTokenBudget: number;
  createdAt: string;
  updatedAt: string;
}

export interface GongpilPersonaSelection {
  personaId: string;
  versionId: string;
  profileId: string;
}

export interface GongpilPersonaWorkspace {
  schemaVersion: 1;
  projectId: string;
  personas: GongpilPersona[];
  profiles: GongpilWorkProfile[];
  selection: GongpilPersonaSelection;
  updatedAt: string;
}

export interface GongpilActivePersonaContext {
  persona: GongpilPersona;
  version: GongpilPersonaVersion;
  profile: GongpilWorkProfile;
}

export class GongpilPersonaStoreError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilPersonaStoreError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilPersonaStore {
  public constructor(dataRoot: string) {
    this.personaRoot = join(dataRoot, "personas");
  }

  public async ReadWorkspace(projectId: string): Promise<GongpilPersonaWorkspace> {
    return await this.RunMutation(projectId, async () => {
      const existing = await this.ReadWorkspaceUnsafe(projectId);
      if (existing !== undefined) {
        return existing;
      }
      const workspace = CreateDefaultWorkspace(projectId);
      await this.WriteWorkspace(workspace);
      return workspace;
    });
  }

  public async GetActiveContext(projectId: string): Promise<GongpilActivePersonaContext> {
    const workspace = await this.ReadWorkspace(projectId);
    return ResolveActiveContext(workspace);
  }

  public async CreateVersion(
    projectId: string,
    value: {
      personaId?: string;
      name: string;
      systemInstructions: string;
      workStyle?: string;
      styleGuide?: string;
      forbiddenExpressions?: string[];
      referencePriorities?: string[];
    },
  ): Promise<GongpilPersonaWorkspace> {
    return await this.RunMutation(projectId, async () => {
      const workspace = await this.ReadWorkspaceUnsafe(projectId) ?? CreateDefaultWorkspace(projectId);
      const name = RequireText(value.name, "페르소나 이름", 100);
      const systemInstructions = RequireText(value.systemInstructions, "시스템 지시", 20_000);
      let persona = value.personaId === undefined
        ? undefined
        : workspace.personas.find((candidate) => candidate.personaId === value.personaId);
      if (value.personaId !== undefined && persona === undefined) {
        throw new GongpilPersonaStoreError("PERSONA_NOT_FOUND", "페르소나를 찾지 못했습니다.");
      }
      if (persona === undefined) {
        persona = { personaId: `persona-${randomUUID()}`, name, versions: [] };
        workspace.personas.push(persona);
      }
      const now = new Date().toISOString();
      const version: GongpilPersonaVersion = {
        versionId: `persona-version-${randomUUID()}`,
        version: (persona.versions.at(-1)?.version ?? 0) + 1,
        name,
        systemInstructions,
        workStyle: OptionalText(value.workStyle, 10_000),
        styleGuide: OptionalText(value.styleGuide, 10_000),
        forbiddenExpressions: NormalizeTextList(value.forbiddenExpressions, 100, 200),
        referencePriorities: NormalizeTextList(value.referencePriorities, 100, 200),
        createdAt: now,
      };
      persona.name = name;
      persona.versions.push(version);
      workspace.selection = {
        ...workspace.selection,
        personaId: persona.personaId,
        versionId: version.versionId,
      };
      workspace.updatedAt = now;
      await this.WriteWorkspace(workspace);
      return workspace;
    });
  }

  public async SaveProfile(
    projectId: string,
    value: { profileId?: string; name: string; instructions?: string; contextTokenBudget: number },
  ): Promise<GongpilPersonaWorkspace> {
    return await this.RunMutation(projectId, async () => {
      const workspace = await this.ReadWorkspaceUnsafe(projectId) ?? CreateDefaultWorkspace(projectId);
      const name = RequireText(value.name, "프로필 이름", 100);
      if (!Number.isSafeInteger(value.contextTokenBudget)
        || value.contextTokenBudget < 1_000
        || value.contextTokenBudget > 200_000) {
        throw new GongpilPersonaStoreError(
          "PROFILE_TOKEN_BUDGET_INVALID",
          "컨텍스트 토큰 예산은 1,000~200,000 사이의 정수여야 합니다.",
        );
      }
      const now = new Date().toISOString();
      let profile = value.profileId === undefined
        ? undefined
        : workspace.profiles.find((candidate) => candidate.profileId === value.profileId);
      if (value.profileId !== undefined && profile === undefined) {
        throw new GongpilPersonaStoreError("PROFILE_NOT_FOUND", "작업 프로필을 찾지 못했습니다.");
      }
      if (profile === undefined) {
        profile = {
          profileId: `profile-${randomUUID()}`,
          name,
          instructions: OptionalText(value.instructions, 10_000),
          contextTokenBudget: value.contextTokenBudget,
          createdAt: now,
          updatedAt: now,
        };
        workspace.profiles.push(profile);
      }
      else {
        profile.name = name;
        profile.instructions = OptionalText(value.instructions, 10_000);
        profile.contextTokenBudget = value.contextTokenBudget;
        profile.updatedAt = now;
      }
      workspace.selection.profileId = profile.profileId;
      workspace.updatedAt = now;
      await this.WriteWorkspace(workspace);
      return workspace;
    });
  }

  public async UpdateSelection(
    projectId: string,
    value: Partial<GongpilPersonaSelection>,
  ): Promise<GongpilPersonaWorkspace> {
    return await this.RunMutation(projectId, async () => {
      const workspace = await this.ReadWorkspaceUnsafe(projectId) ?? CreateDefaultWorkspace(projectId);
      const personaId = value.personaId ?? workspace.selection.personaId;
      const persona = workspace.personas.find((candidate) => candidate.personaId === personaId);
      if (persona === undefined) {
        throw new GongpilPersonaStoreError("PERSONA_NOT_FOUND", "페르소나를 찾지 못했습니다.");
      }
      const versionId = value.versionId
        ?? (personaId === workspace.selection.personaId
          ? workspace.selection.versionId
          : persona.versions.at(-1)?.versionId);
      if (versionId === undefined || !persona.versions.some((version) => version.versionId === versionId)) {
        throw new GongpilPersonaStoreError("PERSONA_VERSION_NOT_FOUND", "페르소나 버전을 찾지 못했습니다.");
      }
      const profileId = value.profileId ?? workspace.selection.profileId;
      if (!workspace.profiles.some((profile) => profile.profileId === profileId)) {
        throw new GongpilPersonaStoreError("PROFILE_NOT_FOUND", "작업 프로필을 찾지 못했습니다.");
      }
      workspace.selection = { personaId, versionId, profileId };
      workspace.updatedAt = new Date().toISOString();
      await this.WriteWorkspace(workspace);
      return workspace;
    });
  }

  private async ReadWorkspaceUnsafe(projectId: string): Promise<GongpilPersonaWorkspace | undefined> {
    const workspacePath = this.GetWorkspacePath(projectId);
    try {
      const value = JSON.parse(await readFile(workspacePath, "utf8")) as unknown;
      if (!IsPersonaWorkspace(value, projectId)) {
        throw new Error("invalid");
      }
      ResolveActiveContext(value);
      return value;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw new GongpilPersonaStoreError("PERSONA_STORE_CORRUPT", "페르소나 저장 파일이 손상되었습니다.");
    }
  }

  private async WriteWorkspace(workspace: GongpilPersonaWorkspace): Promise<void> {
    const workspacePath = this.GetWorkspacePath(workspace.projectId);
    await mkdir(dirname(workspacePath), { recursive: true });
    const temporaryPath = `${workspacePath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(workspace, null, 2)}\n`, "utf8");
      await handle.sync();
    }
    finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, workspacePath);
    }
    catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private GetWorkspacePath(projectId: string): string {
    if (!/^project-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId)) {
      throw new GongpilPersonaStoreError("PROJECT_ID_INVALID", "프로젝트 ID가 올바르지 않습니다.");
    }
    return join(this.personaRoot, `${projectId}.json`);
  }

  private RunMutation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.mutations.set(projectId, current.then(() => undefined, () => undefined));
    return current;
  }

  private readonly personaRoot: string;
  private readonly mutations = new Map<string, Promise<void>>();
}

function CreateDefaultWorkspace(projectId: string): GongpilPersonaWorkspace {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId,
    personas: [{
      personaId: "persona-default",
      name: "기본 공동 집필자",
      versions: [{
        versionId: "persona-version-default-v1",
        version: 1,
        name: "기본 공동 집필자",
        systemInstructions: "사용자의 의도와 원문 설정을 존중하며 근거가 없는 내용을 사실처럼 단정하지 않는다.",
        workStyle: "먼저 요청과 선택된 출처를 확인하고, 필요한 변경은 검토 가능한 제안으로 만든다.",
        styleGuide: "자연스럽고 명확한 한국어를 사용한다.",
        forbiddenExpressions: [],
        referencePriorities: ["명시 선택 청크", "현재 문서", "사용자 요청"],
        createdAt: now,
      }],
    }],
    profiles: [{
      profileId: "profile-default",
      name: "균형 집필",
      instructions: "정확성과 문체를 함께 고려하고, 출처와 충돌하는 추측은 표시한다.",
      contextTokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET,
      createdAt: now,
      updatedAt: now,
    }],
    selection: {
      personaId: "persona-default",
      versionId: "persona-version-default-v1",
      profileId: "profile-default",
    },
    updatedAt: now,
  };
}

function ResolveActiveContext(workspace: GongpilPersonaWorkspace): GongpilActivePersonaContext {
  const persona = workspace.personas.find((candidate) => candidate.personaId === workspace.selection.personaId);
  const version = persona?.versions.find((candidate) => candidate.versionId === workspace.selection.versionId);
  const profile = workspace.profiles.find((candidate) => candidate.profileId === workspace.selection.profileId);
  if (persona === undefined || version === undefined || profile === undefined) {
    throw new GongpilPersonaStoreError("PERSONA_SELECTION_INVALID", "선택된 페르소나 또는 작업 프로필이 없습니다.");
  }
  return { persona, version, profile };
}

function IsPersonaWorkspace(value: unknown, projectId: string): value is GongpilPersonaWorkspace {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const workspace = value as Partial<GongpilPersonaWorkspace>;
  return workspace.schemaVersion === 1
    && workspace.projectId === projectId
    && Array.isArray(workspace.personas)
    && workspace.personas.every(IsPersona)
    && Array.isArray(workspace.profiles)
    && workspace.profiles.every(IsProfile)
    && typeof workspace.selection === "object"
    && workspace.selection !== null
    && typeof workspace.selection.personaId === "string"
    && typeof workspace.selection.versionId === "string"
    && typeof workspace.selection.profileId === "string"
    && typeof workspace.updatedAt === "string";
}

function IsPersona(value: unknown): value is GongpilPersona {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const persona = value as Partial<GongpilPersona>;
  return typeof persona.personaId === "string"
    && typeof persona.name === "string"
    && Array.isArray(persona.versions)
    && persona.versions.length > 0
    && persona.versions.every(IsPersonaVersion);
}

function IsPersonaVersion(value: unknown): value is GongpilPersonaVersion {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const version = value as Partial<GongpilPersonaVersion>;
  return typeof version.versionId === "string"
    && Number.isSafeInteger(version.version)
    && (version.version ?? 0) > 0
    && typeof version.name === "string"
    && typeof version.systemInstructions === "string"
    && typeof version.workStyle === "string"
    && typeof version.styleGuide === "string"
    && Array.isArray(version.forbiddenExpressions)
    && version.forbiddenExpressions.every((item) => typeof item === "string")
    && Array.isArray(version.referencePriorities)
    && version.referencePriorities.every((item) => typeof item === "string")
    && typeof version.createdAt === "string";
}

function IsProfile(value: unknown): value is GongpilWorkProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const profile = value as Partial<GongpilWorkProfile>;
  return typeof profile.profileId === "string"
    && typeof profile.name === "string"
    && typeof profile.instructions === "string"
    && Number.isSafeInteger(profile.contextTokenBudget)
    && (profile.contextTokenBudget ?? 0) >= 1_000
    && (profile.contextTokenBudget ?? 0) <= 200_000
    && typeof profile.createdAt === "string"
    && typeof profile.updatedAt === "string";
}

function RequireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new GongpilPersonaStoreError("PERSONA_FIELD_INVALID", `${label} 값이 올바르지 않습니다.`);
  }
  return value.trim();
}

function OptionalText(value: unknown, maxLength: number): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new GongpilPersonaStoreError("PERSONA_FIELD_INVALID", "페르소나 입력값이 올바르지 않습니다.");
  }
  return value.trim();
}

function NormalizeTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => (
    typeof item !== "string" || item.length > maxLength
  ))) {
    throw new GongpilPersonaStoreError("PERSONA_FIELD_INVALID", "페르소나 목록 입력값이 올바르지 않습니다.");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
