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
import {
  EnsureClientDataRootWritable,
  LoadClientSettings,
  SaveClientSettings,
  type GongpilClientSettings,
} from "./client-settings-store.ts";
import { GongpilCoreProcessManager } from "./core-process-manager.ts";

const CLIENT_VERSION = "0.1.0";
const CORE_VERSION = "0.1.0";

async function RunClientProcess(): Promise<void> {
  const appRoot = fileURLToPath(new URL("../..", import.meta.url));
  const mode = await ResolveMode(appRoot);
  const settingsContext = {
    mode,
    appRoot,
    localAppData: process.env.LOCALAPPDATA,
    settingsRoot: process.env.GONGPIL_CLIENT_SETTINGS_ROOT,
  };
  const loadedSettings = await LoadClientSettings(settingsContext);
  let settings: GongpilClientSettings = loadedSettings.settings;
  const dataRootOverride = process.env.GONGPIL_DATA_ROOT;
  const headless = process.argv.includes("--no-open");
  const showConnector = !headless
    && dataRootOverride === undefined
    && (
      process.argv.includes("--settings")
      || loadedSettings.isFirstRun
      || settings.showConnectorOnStartup
    );
  if (showConnector) {
    const connectorResult = await ShowClientConnector({
      mode,
      settings,
      isFirstRun: loadedSettings.isFirstRun,
      appRoot,
      settingsPath: loadedSettings.settingsPath,
    });
    if (connectorResult.action === "cancel") {
      process.stdout.write("공필 클라이언트에서 시작을 취소했습니다.\n");
      return;
    }
    settings = await SaveClientSettings(settingsContext, connectorResult.settings);
  }
  const selectedDataRoot = dataRootOverride === undefined
    ? settings.dataRoot
    : await EnsureClientDataRootWritable(dataRootOverride, appRoot);
  const launchId = `launch-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const paths = ResolveBootstrapPaths({
    mode,
    sessionId,
    appRoot,
    installedDataRoot: mode === "installed" ? selectedDataRoot : undefined,
    bundledRuntimePath: process.execPath,
  });
  const config: GongpilClientBootstrapConfig = {
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

  const manager = new GongpilCoreProcessManager({
    coreEntryPath: join(appRoot, "core", "src", "core-process.ts"),
  });
  const bootstrap = new GongpilClientBootstrap(manager);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    await bootstrap.Stop();
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  try {
    const result = await bootstrap.ActivateCore(config);
    const launchResult = await bootstrap.GetNetworkRuntime().Send("browser.session.create", {});
    if (launchResult.state !== "succeeded" || typeof launchResult.payload?.launchPath !== "string") {
      throw new Error(launchResult.error?.userMessage ?? "Browser 세션을 만들지 못했습니다.");
    }
    const launchUrl = bootstrap.CreateBrowserLaunchUrl(launchResult.payload.launchPath);
    await bootstrap.GetNetworkRuntime().Disconnect();

    process.stdout.write(
      `공필 ${CLIENT_VERSION} · ${result.browserSession.mode} · Core ${result.activationResult.activeCoreVersion}\n`,
    );
    if (process.argv.includes("--no-open")) {
      process.stdout.write(`인스턴스 시작 주소: ${launchUrl}\n`);
    }
    else {
      OpenDefaultBrowser(launchUrl);
      process.stdout.write("기본 브라우저에서 공필 인스턴스를 열었습니다. 종료는 화면의 '공필 종료'를 누르세요.\n");
    }

    await bootstrap.WaitForActiveCoreExit();
  }
  finally {
    await stop();
  }
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
