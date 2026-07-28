import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GongpilClientBootstrapConfig } from "../../packages/contracts/bootstrap/contracts.ts";
import type { GongpilClientSettings } from "./client-settings-store.ts";

export interface GongpilClientConnectorInput {
  mode: GongpilClientBootstrapConfig["mode"];
  settings: GongpilClientSettings;
  isFirstRun: boolean;
  appRoot: string;
  settingsPath: string;
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
  await writeFile(inputPath, JSON.stringify(input), "utf8");
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
        openAiEnvFile?: unknown;
        openAiModel?: unknown;
      };
      if (output.action === "cancel") {
        return { action: "cancel", settings: input.settings };
      }
      if (
        output.action !== "start"
        || typeof output.dataRoot !== "string"
        || typeof output.showConnectorOnStartup !== "boolean"
        || (output.openAiEnvFile !== undefined && typeof output.openAiEnvFile !== "string")
        || typeof output.openAiModel !== "string"
      ) {
        throw new Error("클라이언트 접속기의 응답 형식이 올바르지 않습니다.");
      }
      return {
        action: "start",
        settings: {
          schemaVersion: 1,
          dataRoot: output.dataRoot,
          showConnectorOnStartup: output.showConnectorOnStartup,
          openAiEnvFile: output.openAiEnvFile === "" ? undefined : output.openAiEnvFile,
          openAiModel: output.openAiModel,
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
