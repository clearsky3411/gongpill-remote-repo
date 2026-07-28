import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  ParseClientBootstrapConfig,
  type GongpilClientBootstrapConfig,
  type GongpilCoreReadyInfo,
} from "../../packages/contracts/bootstrap/contracts.ts";
import {
  GongpilLoopbackCommandError,
  GongpilLoopbackHttpHost,
} from "../../platform/network-runtime/src/host/loopback-http-host.ts";
import {
  GongpilDocumentStore,
  GongpilDocumentStoreError,
} from "./document-store.ts";
import {
  GongpilProjectStore,
  GongpilProjectStoreError,
} from "./project-store.ts";

const LOOPBACK_SESSION_TOKEN_ENV = "GONGPIL_LOOPBACK_SESSION_TOKEN";
const CORE_API_VERSION = "1.0.0";

async function RunCoreProcess(): Promise<void> {
  const config = await ReadBootstrapConfig();
  const sessionToken = ReadSessionToken();
  await PrepareSessionDirectories(config);
  const projectStore = new GongpilProjectStore(config.paths.dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  await projectStore.Initialize();

  const host = new GongpilLoopbackHttpHost({
    profileId: `core.${config.launchId}`,
    sessionToken,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
    browserAssetsRoot: join(config.paths.appRoot, "browser", "src"),
    browserNetworkRuntimePath: join(
      config.paths.appRoot,
      "platform",
      "network-runtime",
      "browser",
      "network-runtime.js",
    ),
  });
  host.RegisterCommand("system.health.read", () => ({
    status: "ready",
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
  }));
  host.RegisterCommand("system.readiness.verify", () => ({
    ready: true,
    launchId: config.launchId,
    sessionId: config.sessionId,
  }));
  host.RegisterCommand("browser.session.create", () => ({
    launchPath: host.CreateBrowserLaunchPath(),
  }));
  host.RegisterCommand("project.list", async () => ({
    projects: await projectStore.ListProjects(),
  }));
  host.RegisterCommand("project.create", async (payload) => {
    try {
      const project = await projectStore.CreateProject(RequireString(payload, "name"));
      host.Publish("project.changed", { projectId: project.projectId, change: "created" });
      return { project };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("project.open", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const [project, documents] = await Promise.all([
        projectStore.GetProject(projectId),
        documentStore.ListDocuments(projectId),
      ]);
      return { project, documents };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.list", async (payload) => {
    try {
      return {
        documents: await documentStore.ListDocuments(RequireString(payload, "projectId")),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.read", async (payload) => {
    try {
      return {
        document: await documentStore.ReadDocument(
          RequireString(payload, "projectId"),
          RequireString(payload, "path"),
        ),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.create", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const document = await documentStore.CreateDocument(
        projectId,
        RequireString(payload, "path"),
        OptionalString(payload, "content") ?? "",
      );
      host.Publish("document.changed", {
        projectId,
        path: document.path,
        revision: document.revision,
        change: "created",
      });
      return { document };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.save", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const document = await documentStore.SaveDocument(
        projectId,
        RequireString(payload, "path"),
        RequireString(payload, "expectedRevision"),
        RequireString(payload, "content", true),
      );
      host.Publish("document.changed", {
        projectId,
        path: document.path,
        revision: document.revision,
        change: "saved",
      });
      return { document };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("system.shutdown.request", () => {
    const shutdownTimer = setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
    shutdownTimer.unref();
    return { accepted: true };
  });

  const networkProfile = await host.Start();
  const readyInfo: GongpilCoreReadyInfo = {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: config.launchId,
    sessionId: config.sessionId,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
    health: "ready",
    networkProfile,
    capabilities: [
      "system.health.read",
      "system.readiness.verify",
      "browser.session.create",
      "project.list",
      "project.create",
      "project.open",
      "document.list",
      "document.read",
      "document.create",
      "document.save",
      "system.shutdown.request",
    ],
  };

  await WriteReadyInfo(readyInfo);
  InstallShutdownHandlers(host);
}

async function ReadBootstrapConfig(): Promise<GongpilClientBootstrapConfig> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      if (line.trim().length === 0) {
        continue;
      }
      const config = ParseClientBootstrapConfig(JSON.parse(line));
      if (config.protocolVersion.major !== GONGPIL_BOOTSTRAP_PROTOCOL_VERSION.major) {
        throw new Error("BOOTSTRAP_PROTOCOL_INCOMPATIBLE");
      }
      return config;
    }
  }
  finally {
    input.close();
  }
  throw new Error("BOOTSTRAP_CONFIG_MISSING");
}

function ReadSessionToken(): string {
  const sessionToken = process.env[LOOPBACK_SESSION_TOKEN_ENV];
  if (sessionToken === undefined || sessionToken.length < 16) {
    throw new Error("LOOPBACK_SESSION_TOKEN_MISSING");
  }
  return sessionToken;
}

function RequireString(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
  allowEmpty = false,
): string {
  const value = payload[fieldName];
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new GongpilLoopbackCommandError(
      "INVALID_COMMAND_PAYLOAD",
      `${fieldName} 값이 올바르지 않습니다.`,
    );
  }
  return value;
}

function OptionalString(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
): string | undefined {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new GongpilLoopbackCommandError(
      "INVALID_COMMAND_PAYLOAD",
      `${fieldName} 값이 올바르지 않습니다.`,
    );
  }
  return value;
}

function NormalizeDomainError(error: unknown): GongpilLoopbackCommandError {
  if (error instanceof GongpilLoopbackCommandError) {
    return error;
  }
  if (error instanceof GongpilDocumentStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message, error.retryable);
  }
  if (error instanceof GongpilProjectStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  return new GongpilLoopbackCommandError(
    "CORE_OPERATION_FAILED",
    "Core가 요청을 처리하지 못했습니다.",
    true,
  );
}

async function PrepareSessionDirectories(config: GongpilClientBootstrapConfig): Promise<void> {
  await Promise.all([
    mkdir(config.paths.dataRoot, { recursive: true }),
    mkdir(config.paths.versionRoot, { recursive: true }),
    mkdir(config.paths.sessionTemp, { recursive: true }),
  ]);
}

function WriteReadyInfo(readyInfo: GongpilCoreReadyInfo): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(readyInfo)}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      }
      else {
        reject(error);
      }
    });
  });
}

function InstallShutdownHandlers(host: GongpilLoopbackHttpHost): void {
  let stopping = false;
  const parentProcessId = process.ppid;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(parentMonitor);
    try {
      await host.Stop();
    }
    finally {
      process.exit(0);
    }
  };

  const parentMonitor = setInterval(() => {
    try {
      process.kill(parentProcessId, 0);
    }
    catch {
      void stop();
    }
  }, 2_000);
  parentMonitor.unref();

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

RunCoreProcess().catch(() => {
  process.stderr.write(`${JSON.stringify({
    code: "CORE_START_FAILED",
    userMessage: "Core 시작 경계를 검증하지 못했습니다.",
    retryable: false,
  })}\n`);
  process.exitCode = 1;
});
