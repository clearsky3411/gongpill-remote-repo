import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GongpilClientBootstrapConfig } from "../../packages/contracts/bootstrap/contracts.ts";
import { ListClientUserFontFiles, LoadClientFontCatalog } from "./client-font-catalog.ts";
import type { GongpilClientSettings } from "./client-settings-store.ts";

export interface GongpilClientConnectorInput {
  mode: GongpilClientBootstrapConfig["mode"];
  settings: GongpilClientSettings;
  isFirstRun: boolean;
  lifecycleReason: "startup" | "instance-stopped" | "instance-crashed";
  appRoot: string;
  settingsPath: string;
}

export interface GongpilClientReleaseNotes {
  schemaVersion: 1;
  productVersion: string;
  releasedAt: string;
  title: string;
  summary: string;
  capabilities: string[];
  changes: string[];
}

export interface GongpilClientConnectorResult {
  action: "start" | "cancel";
  settings: GongpilClientSettings;
}

export async function ShowClientConnector(
  input: GongpilClientConnectorInput,
): Promise<GongpilClientConnectorResult> {
  const exchangeRoot = await mkdtemp(join(tmpdir(), "gongpil-connector-"));
  const inputPath = join(exchangeRoot, "input.json");
  const outputPath = join(exchangeRoot, "output.json");
  const scriptPath = join(input.appRoot, "client", "windows", "GongpilConnector.ps1");
  const releaseNotes = await LoadClientReleaseNotes(input.appRoot);
  const fontCatalog = await LoadClientFontCatalog(input.appRoot);
  const userFontFiles = await ListClientUserFontFiles(input.settings.appearance.fontRoot);
  await writeFile(inputPath, JSON.stringify({ ...input, releaseNotes, fontCatalog, userFontFiles }), "utf8");
  try {
    const exitCode = await RunPowerShell(scriptPath, inputPath, outputPath);
    if (exitCode !== 0) {
      throw new Error(`클라이언트 접속기 실행에 실패했습니다. (exit=${exitCode})`);
    }
    try {
      const output = JSON.parse(RemoveByteOrderMark(await readFile(outputPath, "utf8"))) as {
        action?: unknown;
        dataRoot?: unknown;
        showConnectorOnStartup?: unknown;
        aiProvider?: unknown;
        codexExecutable?: unknown;
        codexModel?: unknown;
        openAiEnvFile?: unknown;
        openAiModel?: unknown;
        appearance?: unknown;
      };
      if (output.action === "cancel") {
        return { action: "cancel", settings: input.settings };
      }
      if (
        output.action !== "start"
        || typeof output.dataRoot !== "string"
        || typeof output.showConnectorOnStartup !== "boolean"
        || (output.aiProvider !== "codex" && output.aiProvider !== "openai-api")
        || (output.codexExecutable !== undefined && typeof output.codexExecutable !== "string")
        || typeof output.codexModel !== "string"
        || (output.openAiEnvFile !== undefined && typeof output.openAiEnvFile !== "string")
        || typeof output.openAiModel !== "string"
        || !IsAppearanceResponse(output.appearance)
      ) {
        throw new Error("클라이언트 접속기의 응답 형식이 올바르지 않습니다.");
      }
      return {
        action: "start",
        settings: {
          schemaVersion: 2,
          dataRoot: output.dataRoot,
          showConnectorOnStartup: output.showConnectorOnStartup,
          aiProvider: output.aiProvider,
          codexExecutable: output.codexExecutable === "" ? undefined : output.codexExecutable,
          codexModel: output.codexModel,
          openAiEnvFile: output.openAiEnvFile === "" ? undefined : output.openAiEnvFile,
          openAiModel: output.openAiModel,
          appearance: output.appearance,
        },
      };
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { action: "cancel", settings: input.settings };
      }
      throw error;
    }
  }
  finally {
    await rm(exchangeRoot, { recursive: true, force: true });
  }
}

function IsAppearanceResponse(value: unknown): value is GongpilClientSettings["appearance"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const appearance = value as Readonly<Record<string, unknown>>;
  return appearance.baselineDpi === 96
    && typeof appearance.fontRoot === "string"
    && typeof appearance.uiFontId === "string"
    && typeof appearance.monospaceFontId === "string"
    && typeof appearance.baseFontSizePt === "number"
    && typeof appearance.uiScalePercent === "number"
    && typeof appearance.windowWidthDip === "number"
    && typeof appearance.windowHeightDip === "number";
}

export async function LoadClientReleaseNotes(appRoot: string): Promise<GongpilClientReleaseNotes> {
  const notesPath = join(appRoot, "client", "src", "client-release-notes.json");
  let value: unknown;
  try {
    value = JSON.parse(RemoveByteOrderMark(await readFile(notesPath, "utf8")));
  }
  catch (error) {
    throw new Error("클라이언트 릴리스 정보를 읽지 못했습니다.", { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("클라이언트 릴리스 정보 형식이 올바르지 않습니다.");
  }
  const notes = value as Readonly<Record<string, unknown>>;
  if (
    notes.schemaVersion !== 1
    || !IsDisplayText(notes.productVersion, 64)
    || !IsDisplayText(notes.releasedAt, 32)
    || !IsDisplayText(notes.title, 200)
    || !IsDisplayText(notes.summary, 500)
    || !IsDisplayTextArray(notes.capabilities, 20, 300)
    || !IsDisplayTextArray(notes.changes, 20, 300)
  ) {
    throw new Error("클라이언트 릴리스 정보 형식이 올바르지 않습니다.");
  }
  return {
    schemaVersion: 1,
    productVersion: notes.productVersion,
    releasedAt: notes.releasedAt,
    title: notes.title,
    summary: notes.summary,
    capabilities: [...notes.capabilities],
    changes: [...notes.changes],
  };
}

function RunPowerShell(scriptPath: string, inputPath: string, outputPath: string): Promise<number | null> {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const executable = systemRoot === undefined
    ? "powershell.exe"
    : join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const childProcess = spawn(executable, [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    scriptPath,
    "-InputPath",
    inputPath,
    "-OutputPath",
    outputPath,
  ], { stdio: "ignore", windowsHide: false });
  return new Promise((resolve, reject) => {
    childProcess.once("error", reject);
    childProcess.once("exit", resolve);
  });
}

function RemoveByteOrderMark(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function IsDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function IsDisplayTextArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= maxItems
    && value.every((item) => IsDisplayText(item, maxLength));
}
