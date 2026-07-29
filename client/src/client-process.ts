import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveBootstrapPaths } from "./bootstrap-paths.ts";
import { GongpilClientBootstrap } from "./client-bootstrap.ts";
import { ShowClientConnector } from "./client-connector.ts";
import { GongpilClientRuntime } from "./client-runtime.ts";
import {
  EnsureClientDataRootWritable,
  LoadClientSettings,
  SaveClientSettings,
  type GongpilClientSettings,
} from "./client-settings-store.ts";
import { GongpilCoreProcessManager } from "./core-process-manager.ts";

const CLIENT_VERSION = "0.1.1";
const CORE_VERSION = "0.1.1";

async function RunClientProcess(): Promise<void> {
  const appRoot = fileURLToPath(new URL("../..", import.meta.url));
  const mode = await ResolveMode(appRoot);
  const settingsContext = {
    mode,
    appRoot,
    localAppData: process.env.LOCALAPPDATA,
    settingsRoot: process.env.GONGPIL_CLIENT_SETTINGS_ROOT,
    migrateLegacySettings: await FileExists(join(appRoot, "installed.marker")),
  };
  const loadedSettings = await LoadClientSettings(settingsContext);
  let settings: GongpilClientSettings = loadedSettings.settings;
  let isFirstRun = loadedSettings.isFirstRun;
  const dataRootOverride = process.env.GONGPIL_DATA_ROOT;
  const headless = process.argv.includes("--no-open");
  const oneShot = headless || dataRootOverride !== undefined;
  let showConnector = !headless
    && dataRootOverride === undefined
    && (
      process.argv.includes("--settings")
      || loadedSettings.isFirstRun
      || settings.showConnectorOnStartup
    );
  const manager = new GongpilCoreProcessManager({
    coreEntryPath: join(appRoot, "core", "src", "core-process.ts"),
  });
  const bootstrap = new GongpilClientBootstrap(manager);
  const clientRuntime = new GongpilClientRuntime(bootstrap);
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    if (!stopping) {
      stopping = true;
    }
    stopPromise ??= clientRuntime.Shutdown();
    await stopPromise;
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  try {
    let lifecycleReason: "startup" | "instance-stopped" | "instance-crashed" = "startup";
    while (!stopping) {
      if (showConnector) {
        const connectorResult = await ShowClientConnector({
          mode,
          settings,
          isFirstRun,
          lifecycleReason,
          appRoot,
          settingsPath: loadedSettings.settingsPath,
        });
        if (connectorResult.action === "cancel") {
          process.stdout.write("공필 Client Runtime을 종료합니다.\n");
          break;
        }
        settings = await SaveClientSettings(settingsContext, connectorResult.settings);
        isFirstRun = false;
      }

      let exitReason: "stopped" | "crashed";
      try {
        const selectedDataRoot = dataRootOverride === undefined
          ? settings.dataRoot
          : await EnsureClientDataRootWritable(dataRootOverride, appRoot);
        manager.SetCoreEnvironment({
          GONGPIL_AI_PROVIDER: settings.aiProvider,
          GONGPIL_CODEX_EXECUTABLE: settings.codexExecutable ?? await ResolveCodexExecutable(),
          GONGPIL_CODEX_MODEL: settings.codexModel,
          GONGPIL_OPENAI_ENV_FILE: settings.openAiEnvFile,
          GONGPIL_OPENAI_MODEL: settings.openAiModel,
        });
        const config = CreateBootstrapConfig(mode, appRoot, selectedDataRoot);
        const result = await clientRuntime.StartInstance(config);
        const launchResult = await clientRuntime.GetNetworkRuntime().Send("browser.session.create", {});
        if (launchResult.state !== "succeeded" || typeof launchResult.payload?.launchPath !== "string") {
          throw new Error(launchResult.error?.userMessage ?? "Browser 세션을 만들지 못했습니다.");
        }
        const launchUrl = bootstrap.CreateBrowserLaunchUrl(launchResult.payload.launchPath);
        await clientRuntime.GetNetworkRuntime().Disconnect();

        process.stdout.write(
          `공필 ${CLIENT_VERSION} · ${result.browserSession.mode} · Core ${result.activationResult.activeCoreVersion}\n`,
        );
        if (headless) {
          process.stdout.write(`인스턴스 시작 주소: ${launchUrl}\n`);
        }
        else {
          OpenDefaultBrowser(launchUrl);
          process.stdout.write("기본 브라우저에서 공필 Instance Runtime을 열었습니다. 화면의 '인스턴스 종료' 후 Client Runtime에서 다시 시작할 수 있습니다.\n");
        }

        exitReason = (await clientRuntime.WaitForInstanceExit()).reason;
      }
      catch (error) {
        await clientRuntime.StopInstance();
        if (stopping) {
          break;
        }
        if (oneShot) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        process.stderr.write(`Instance Runtime 실행에 실패했습니다: ${message}\n`);
        lifecycleReason = "instance-crashed";
        showConnector = true;
        isFirstRun = false;
        continue;
      }

      if (stopping || oneShot) {
        break;
      }
      lifecycleReason = exitReason === "crashed" ? "instance-crashed" : "instance-stopped";
      showConnector = true;
      isFirstRun = false;
    }
  }
  finally {
    await stop();
  }
}

function CreateBootstrapConfig(
  mode: "installed" | "portable",
  appRoot: string,
  selectedDataRoot: string,
): GongpilClientBootstrapConfig {
  const launchId = `launch-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const paths = ResolveBootstrapPaths({
    mode,
    sessionId,
    appRoot,
    installedDataRoot: mode === "installed" ? selectedDataRoot : undefined,
    bundledRuntimePath: process.execPath,
  });
  return {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId,
    sessionId,
    mode,
    clientVersion: CLIENT_VERSION,
    selectedCoreVersion: CORE_VERSION,
    supportedCoreProtocol: { major: 1, minMinor: 0, maxMinor: 0 },
    paths,
    activation: { reason: "startup", requireHealthCheck: true },
  };
}

async function ResolveMode(appRoot: string): Promise<"installed" | "portable"> {
  if (process.argv.includes("--portable")) {
    return "portable";
  }
  try {
    await access(join(appRoot, "portable.marker"));
    return "portable";
  }
  catch {
    return "installed";
  }
}

async function FileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  }
  catch {
    return false;
  }
}

async function ResolveCodexExecutable(): Promise<string | undefined> {
  const appData = process.env.APPDATA;
  if (appData === undefined) {
    return undefined;
  }
  const candidates = [
    join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    ),
    join(appData, "npm", "codex.exe"),
  ];
  for (const candidate of candidates) {
    if (await FileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function OpenDefaultBrowser(launchUrl: string): void {
  const browserProcess = spawn(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", launchUrl],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  browserProcess.unref();
}

RunClientProcess().catch((error) => {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  process.stderr.write(`공필을 시작하지 못했습니다: ${message}\n`);
  process.exitCode = 1;
});
