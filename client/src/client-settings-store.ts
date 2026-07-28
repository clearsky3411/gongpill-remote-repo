import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, win32 as WindowsPath } from "node:path";

import type { GongpilClientBootstrapConfig } from "../../packages/contracts/bootstrap/contracts.ts";

export interface GongpilClientSettings {
  schemaVersion: 1;
  dataRoot: string;
  showConnectorOnStartup: boolean;
  aiProvider: "codex" | "openai-api";
  codexExecutable?: string;
  codexModel: string;
  openAiEnvFile?: string;
  openAiModel: string;
}

export interface GongpilClientSettingsContext {
  mode: GongpilClientBootstrapConfig["mode"];
  appRoot: string;
  localAppData?: string;
  settingsRoot?: string;
  migrateLegacySettings?: boolean;
}

export interface GongpilLoadedClientSettings {
  settings: GongpilClientSettings;
  settingsPath: string;
  isFirstRun: boolean;
}

export async function LoadClientSettings(
  context: GongpilClientSettingsContext,
): Promise<GongpilLoadedClientSettings> {
  const settingsPath = ResolveClientSettingsPath(context);
  const defaultSettings = CreateDefaultClientSettings(context);
  try {
    const rawSettings = await readFile(settingsPath, "utf8");
    return {
      settings: NormalizeClientSettings(JSON.parse(RemoveByteOrderMark(rawSettings)), context),
      settingsPath,
      isFirstRun: false,
    };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const migrated = await TryMigrateLegacySettings(context, settingsPath);
      if (migrated !== undefined) {
        return migrated;
      }
      return { settings: defaultSettings, settingsPath, isFirstRun: true };
    }
    if (error instanceof SyntaxError) {
      throw new Error(`클라이언트 설정 파일이 손상되었습니다: ${settingsPath}`);
    }
    throw error;
  }
}

export async function SaveClientSettings(
  context: GongpilClientSettingsContext,
  settings: GongpilClientSettings,
): Promise<GongpilClientSettings> {
  const normalizedSettings = NormalizeClientSettings(settings, context);
  await EnsureClientDataRootWritable(
    normalizedSettings.dataRoot,
    context.appRoot,
    context.mode === "portable",
  );
  const settingsPath = ResolveClientSettingsPath(context);
  await mkdir(dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(normalizedSettings, null, 2)}\n`, "utf8");
    await handle.sync();
  }
  finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, settingsPath);
  }
  catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return normalizedSettings;
}

export async function EnsureClientDataRootWritable(
  dataRoot: string,
  appRoot: string,
  allowInsideAppRoot = false,
): Promise<string> {
  const normalizedDataRoot = RequireSafeDataRoot(dataRoot, appRoot, allowInsideAppRoot);
  await mkdir(normalizedDataRoot, { recursive: true });
  const probePath = WindowsPath.join(normalizedDataRoot, `.gongpil-write-probe-${randomUUID()}`);
  const probe = await open(probePath, "wx", 0o600);
  try {
    await probe.writeFile("gongpil", "utf8");
    await probe.sync();
  }
  finally {
    await probe.close();
    await rm(probePath, { force: true });
  }
  return normalizedDataRoot;
}

export function ResolveClientSettingsPath(context: GongpilClientSettingsContext): string {
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  if (context.settingsRoot !== undefined) {
    return WindowsPath.join(
      RequireWindowsAbsolutePath(context.settingsRoot, "settingsRoot"),
      "client-settings.json",
    );
  }
  if (context.mode === "portable") {
    return WindowsPath.join(appRoot, "GongpilData", "client-settings.json");
  }
  return WindowsPath.join(WindowsPath.dirname(appRoot), "GongpilConfig", "client-settings.json");
}

function CreateDefaultClientSettings(context: GongpilClientSettingsContext): GongpilClientSettings {
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  const dataRoot = context.mode === "portable"
    ? WindowsPath.join(appRoot, "GongpilData")
    : WindowsPath.join(WindowsPath.dirname(appRoot), "GongpilData");
  return {
    schemaVersion: 1,
    dataRoot,
    showConnectorOnStartup: true,
    aiProvider: "codex",
    codexModel: "gpt-5.6-terra",
    openAiModel: "gpt-5.6-terra",
  };
}

function NormalizeClientSettings(
  value: unknown,
  context: GongpilClientSettingsContext,
): GongpilClientSettings {
  if (typeof value !== "object" || value === null) {
    throw new Error("클라이언트 설정 형식이 올바르지 않습니다.");
  }
  const candidate = value as Partial<GongpilClientSettings>;
  if (candidate.schemaVersion !== 1 || typeof candidate.showConnectorOnStartup !== "boolean") {
    throw new Error("지원하지 않는 클라이언트 설정 형식입니다.");
  }
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  const dataRoot = context.mode === "portable"
    ? WindowsPath.join(appRoot, "GongpilData")
    : RequireSafeDataRoot(candidate.dataRoot ?? "", appRoot);
  return {
    schemaVersion: 1,
    dataRoot,
    showConnectorOnStartup: candidate.showConnectorOnStartup,
    aiProvider: NormalizeAiProvider(candidate.aiProvider),
    codexExecutable: NormalizeOptionalAbsolutePath(candidate.codexExecutable),
    codexModel: NormalizeModel(candidate.codexModel, "Codex"),
    openAiEnvFile: NormalizeOptionalAbsolutePath(candidate.openAiEnvFile),
    openAiModel: NormalizeModel(candidate.openAiModel, "OpenAI"),
  };
}

async function TryMigrateLegacySettings(
  context: GongpilClientSettingsContext,
  settingsPath: string,
): Promise<GongpilLoadedClientSettings | undefined> {
  if (context.mode !== "installed" || context.migrateLegacySettings !== true) {
    return undefined;
  }
  const localAppData = context.localAppData ?? process.env.LOCALAPPDATA;
  if (localAppData === undefined) {
    return undefined;
  }
  const legacyPath = WindowsPath.join(
    RequireWindowsAbsolutePath(localAppData, "LOCALAPPDATA"),
    "Gongpil",
    "client-settings.json",
  );
  try {
    const settings = NormalizeClientSettings(
      JSON.parse(RemoveByteOrderMark(await readFile(legacyPath, "utf8"))),
      context,
    );
    await SaveClientSettings(context, settings);
    const verified = NormalizeClientSettings(
      JSON.parse(RemoveByteOrderMark(await readFile(settingsPath, "utf8"))),
      context,
    );
    await rm(legacyPath, { force: true });
    return { settings: verified, settingsPath, isFirstRun: false };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function NormalizeOptionalAbsolutePath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("OpenAI API 환경파일 경로가 올바르지 않습니다.");
  }
  return RequireWindowsAbsolutePath(value, "openAiEnvFile");
}

function NormalizeAiProvider(value: unknown): GongpilClientSettings["aiProvider"] {
  if (value === undefined) {
    return "codex";
  }
  if (value !== "codex" && value !== "openai-api") {
    throw new Error("AI 제공자 설정이 올바르지 않습니다.");
  }
  return value;
}

function NormalizeModel(value: unknown, label: string): string {
  const model = value === undefined ? "gpt-5.6-terra" : value;
  if (typeof model !== "string" || !/^gpt-[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error(`${label} 모델 이름이 올바르지 않습니다.`);
  }
  return model;
}

function RequireSafeDataRoot(value: string, appRoot: string, allowInsideAppRoot = false): string {
  const dataRoot = RequireWindowsAbsolutePath(value, "dataRoot");
  const pathRoot = WindowsPath.parse(dataRoot).root;
  if (TrimPath(dataRoot) === TrimPath(pathRoot)) {
    throw new Error("드라이브 루트는 공필 데이터 폴더로 사용할 수 없습니다.");
  }
  const normalizedAppRoot = `${TrimPath(appRoot)}\\`;
  const normalizedDataRoot = TrimPath(dataRoot);
  if (!allowInsideAppRoot && (
    normalizedDataRoot === TrimPath(appRoot)
    || normalizedDataRoot.startsWith(normalizedAppRoot)
  )) {
    throw new Error("설치 폴더 내부는 공필 데이터 폴더로 사용할 수 없습니다.");
  }
  return WindowsPath.normalize(dataRoot);
}

function RequireWindowsAbsolutePath(value: string, name: string): string {
  if (!WindowsPath.isAbsolute(value)) {
    throw new Error(`${name}는 Windows 절대 경로여야 합니다.`);
  }
  return WindowsPath.normalize(value);
}

function TrimPath(value: string): string {
  return WindowsPath.normalize(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function RemoveByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
