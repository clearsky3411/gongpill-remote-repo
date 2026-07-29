import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, win32 as WindowsPath } from "node:path";

import type { GongpilClientBootstrapConfig } from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveClientStoragePaths } from "./bootstrap-paths.ts";

export const GONGPIL_CLIENT_APPEARANCE_DEFAULTS = Object.freeze({
  baselineDpi: 96,
  uiFontId: "bundled:nanum-gothic",
  monospaceFontId: "bundled:d2coding",
  baseFontSizePt: 9,
  uiScalePercent: 100,
  windowWidthDip: 760,
  windowHeightDip: 720,
});

export const GONGPIL_CLIENT_APPEARANCE_SEED_FILE = "client-settings-seed.json";

export interface GongpilClientAppearanceSettings {
  baselineDpi: 96;
  fontRoot: string;
  uiFontId: string;
  monospaceFontId: string;
  baseFontSizePt: number;
  uiScalePercent: number;
  windowWidthDip: number;
  windowHeightDip: number;
}

export interface GongpilClientSettings {
  schemaVersion: 2;
  dataRoot: string;
  showConnectorOnStartup: boolean;
  aiProvider: "codex" | "openai-api";
  codexExecutable?: string;
  codexModel: string;
  openAiEnvFile?: string;
  openAiModel: string;
  appearance: GongpilClientAppearanceSettings;
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
    const parsedSettings = JSON.parse(RemoveByteOrderMark(await readFile(settingsPath, "utf8")));
    const settings = NormalizeClientSettings(parsedSettings, context);
    if (ReadSchemaVersion(parsedSettings) === 1) {
      await SaveClientSettings(context, settings);
    }
    return { settings, settingsPath, isFirstRun: false };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const migrated = await TryMigrateLegacySettings(context, settingsPath);
      if (migrated !== undefined) {
        await RemoveInstallerAppearanceSeed(context);
        return migrated;
      }
      const seeded = await TryConsumeInstallerAppearanceSeed(context, settingsPath, defaultSettings);
      if (seeded !== undefined) {
        return seeded;
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
  settings: unknown,
): Promise<GongpilClientSettings> {
  const normalizedSettings = NormalizeClientSettings(settings, context);
  await EnsureClientDataRootWritable(
    normalizedSettings.dataRoot,
    context.appRoot,
    context.mode === "portable",
  );
  await EnsureClientFontRootWritable(
    normalizedSettings.appearance.fontRoot,
    context.appRoot,
    context.mode === "portable",
  );
  await WriteClientSettings(ResolveClientSettingsPath(context), normalizedSettings);
  return normalizedSettings;
}

export async function EnsureClientDataRootWritable(
  dataRoot: string,
  appRoot: string,
  allowInsideAppRoot = false,
): Promise<string> {
  const normalizedDataRoot = RequireSafeOwnedRoot(
    dataRoot,
    appRoot,
    allowInsideAppRoot,
    "dataRoot",
    "공필 데이터",
  );
  return await EnsureDirectoryWritable(normalizedDataRoot);
}

export async function EnsureClientFontRootWritable(
  fontRoot: string,
  appRoot: string,
  allowInsideAppRoot = false,
): Promise<string> {
  const normalizedFontRoot = RequireSafeOwnedRoot(
    fontRoot,
    appRoot,
    allowInsideAppRoot,
    "fontRoot",
    "클라이언트 글꼴",
  );
  return await EnsureDirectoryWritable(normalizedFontRoot);
}

export function ResolveClientSettingsPath(context: GongpilClientSettingsContext): string {
  return ResolveClientStoragePaths(context).settingsPath;
}

export function ResolveClientFontRoot(context: GongpilClientSettingsContext): string {
  return ResolveClientStoragePaths(context).userFontRoot;
}

export function ResolveClientAppearanceSeedPath(context: GongpilClientSettingsContext): string {
  return WindowsPath.join(
    WindowsPath.dirname(ResolveClientSettingsPath(context)),
    GONGPIL_CLIENT_APPEARANCE_SEED_FILE,
  );
}

function CreateDefaultClientSettings(context: GongpilClientSettingsContext): GongpilClientSettings {
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  const dataRoot = context.mode === "portable"
    ? WindowsPath.join(appRoot, "GongpilData")
    : WindowsPath.join(WindowsPath.dirname(appRoot), "GongpilData");
  return {
    schemaVersion: 2,
    dataRoot,
    showConnectorOnStartup: true,
    aiProvider: "codex",
    codexModel: "gpt-5.6-terra",
    openAiModel: "gpt-5.6-terra",
    appearance: CreateDefaultAppearanceSettings(context),
  };
}

function CreateDefaultAppearanceSettings(
  context: GongpilClientSettingsContext,
): GongpilClientAppearanceSettings {
  return {
    ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
    baselineDpi: 96,
    fontRoot: ResolveClientFontRoot(context),
  };
}

function NormalizeClientSettings(
  value: unknown,
  context: GongpilClientSettingsContext,
): GongpilClientSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("클라이언트 설정 형식이 올바르지 않습니다.");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const schemaVersion = ReadSchemaVersion(candidate);
  if ((schemaVersion !== 1 && schemaVersion !== 2) || typeof candidate.showConnectorOnStartup !== "boolean") {
    throw new Error("지원하지 않는 클라이언트 설정 형식입니다.");
  }
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  const dataRoot = context.mode === "portable"
    ? WindowsPath.join(appRoot, "GongpilData")
    : RequireSafeOwnedRoot(candidate.dataRoot ?? "", appRoot, false, "dataRoot", "공필 데이터");
  return {
    schemaVersion: 2,
    dataRoot,
    showConnectorOnStartup: candidate.showConnectorOnStartup,
    aiProvider: NormalizeAiProvider(candidate.aiProvider),
    codexExecutable: NormalizeOptionalAbsolutePath(candidate.codexExecutable, "codexExecutable"),
    codexModel: NormalizeModel(candidate.codexModel, "Codex"),
    openAiEnvFile: NormalizeOptionalAbsolutePath(candidate.openAiEnvFile, "openAiEnvFile"),
    openAiModel: NormalizeModel(candidate.openAiModel, "OpenAI"),
    appearance: schemaVersion === 1
      ? CreateDefaultAppearanceSettings(context)
      : NormalizeAppearanceSettings(candidate.appearance, context),
  };
}

function NormalizeAppearanceSettings(
  value: unknown,
  context: GongpilClientSettingsContext,
): GongpilClientAppearanceSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("클라이언트 화면 설정 형식이 올바르지 않습니다.");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.baselineDpi !== 96) {
    throw new Error("클라이언트 화면 기준 DPI는 96이어야 합니다.");
  }
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  const fontRoot = RequireSafeOwnedRoot(
    candidate.fontRoot ?? "",
    appRoot,
    context.mode === "portable",
    "fontRoot",
    "클라이언트 글꼴",
  );
  return {
    baselineDpi: 96,
    fontRoot,
    uiFontId: NormalizeFontId(candidate.uiFontId, "UI"),
    monospaceFontId: NormalizeFontId(candidate.monospaceFontId, "고정폭"),
    baseFontSizePt: NormalizeNumber(candidate.baseFontSizePt, "기본 글자 크기", 8, 24, false),
    uiScalePercent: NormalizeNumber(candidate.uiScalePercent, "UI 배율", 80, 150, true),
    windowWidthDip: NormalizeNumber(candidate.windowWidthDip, "창 너비", 640, 2560, true),
    windowHeightDip: NormalizeNumber(candidate.windowHeightDip, "창 높이", 560, 1600, true),
  };
}

async function TryMigrateLegacySettings(
  context: GongpilClientSettingsContext,
  settingsPath: string,
): Promise<GongpilLoadedClientSettings | undefined> {
  const legacyPaths: string[] = [];
  const appRoot = RequireWindowsAbsolutePath(context.appRoot, "appRoot");
  if (context.mode === "portable") {
    legacyPaths.push(WindowsPath.join(appRoot, "GongpilData", "client-settings.json"));
  }
  else if (context.migrateLegacySettings === true) {
    const localAppData = context.localAppData ?? process.env.LOCALAPPDATA;
    if (localAppData !== undefined) {
      legacyPaths.push(WindowsPath.join(
        RequireWindowsAbsolutePath(localAppData, "LOCALAPPDATA"),
        "Gongpil",
        "client-settings.json",
      ));
    }
  }

  for (const legacyPath of legacyPaths) {
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
        continue;
      }
      throw error;
    }
  }
  return undefined;
}

async function TryConsumeInstallerAppearanceSeed(
  context: GongpilClientSettingsContext,
  settingsPath: string,
  defaultSettings: GongpilClientSettings,
): Promise<GongpilLoadedClientSettings | undefined> {
  if (context.mode !== "installed") {
    return undefined;
  }
  const seedPath = ResolveClientAppearanceSeedPath(context);
  let parsedSeed: unknown;
  try {
    parsedSeed = JSON.parse(RemoveByteOrderMark(await readFile(seedPath, "utf8")));
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`인스톨러 화면 설정 시드가 손상되었습니다: ${seedPath}`);
    }
    throw error;
  }

  if (typeof parsedSeed !== "object" || parsedSeed === null || Array.isArray(parsedSeed)) {
    throw new Error(`인스톨러 화면 설정 시드 형식이 올바르지 않습니다: ${seedPath}`);
  }
  const seed = parsedSeed as Readonly<Record<string, unknown>>;
  if (seed.schemaVersion !== 1) {
    throw new Error(`지원하지 않는 인스톨러 화면 설정 시드입니다: ${seedPath}`);
  }
  const settings = await SaveClientSettings(context, {
    ...defaultSettings,
    appearance: NormalizeAppearanceSettings(seed.appearance, context),
  });
  const verified = NormalizeClientSettings(
    JSON.parse(RemoveByteOrderMark(await readFile(settingsPath, "utf8"))),
    context,
  );
  await rm(seedPath, { force: true });
  return { settings: verified, settingsPath, isFirstRun: true };
}

async function RemoveInstallerAppearanceSeed(context: GongpilClientSettingsContext): Promise<void> {
  if (context.mode === "installed") {
    await rm(ResolveClientAppearanceSeedPath(context), { force: true });
  }
}

async function WriteClientSettings(
  settingsPath: string,
  settings: GongpilClientSettings,
): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
}

async function EnsureDirectoryWritable(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  const probePath = WindowsPath.join(path, `.gongpil-write-probe-${randomUUID()}`);
  const probe = await open(probePath, "wx", 0o600);
  try {
    await probe.writeFile("gongpil", "utf8");
    await probe.sync();
  }
  finally {
    await probe.close();
    await rm(probePath, { force: true });
  }
  return path;
}

function ReadSchemaVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const schemaVersion = (value as Readonly<Record<string, unknown>>).schemaVersion;
  return typeof schemaVersion === "number" ? schemaVersion : undefined;
}

function NormalizeOptionalAbsolutePath(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} 경로가 올바르지 않습니다.`);
  }
  return RequireWindowsAbsolutePath(value, name);
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

function NormalizeFontId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:bundled|user):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} 글꼴 ID가 올바르지 않습니다.`);
  }
  return value;
}

function NormalizeNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  integer: boolean,
): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${label} 설정이 올바르지 않습니다.`);
  }
  return value;
}

function RequireSafeOwnedRoot(
  value: unknown,
  appRoot: string,
  allowInsideAppRoot: boolean,
  name: string,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${name}는 Windows 절대 경로여야 합니다.`);
  }
  const ownedRoot = RequireWindowsAbsolutePath(value, name);
  const pathRoot = WindowsPath.parse(ownedRoot).root;
  if (TrimPath(ownedRoot) === TrimPath(pathRoot)) {
    throw new Error(`드라이브 루트는 ${label} 폴더로 사용할 수 없습니다.`);
  }
  const normalizedAppRoot = `${TrimPath(appRoot)}\\`;
  const normalizedOwnedRoot = TrimPath(ownedRoot);
  if (!allowInsideAppRoot && (
    normalizedOwnedRoot === TrimPath(appRoot)
    || normalizedOwnedRoot.startsWith(normalizedAppRoot)
  )) {
    throw new Error(`설치 폴더 내부는 ${label} 폴더로 사용할 수 없습니다.`);
  }
  return WindowsPath.normalize(ownedRoot);
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
