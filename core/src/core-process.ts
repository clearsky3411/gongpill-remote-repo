import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  ParseClientBootstrapConfig,
  type GongpilClientBootstrapConfig,
  type GongpilCoreReadyInfo,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { GongpilLoopbackHttpHost } from "../../platform/network-runtime/src/host/loopback-http-host.ts";

const LOOPBACK_SESSION_TOKEN_ENV = "GONGPIL_LOOPBACK_SESSION_TOKEN";
const CORE_API_VERSION = "1.0.0";

async function RunCoreProcess(): Promise<void> {
  const config = await ReadBootstrapConfig();
  const sessionToken = ReadSessionToken();
  await PrepareSessionDirectories(config);

  const host = new GongpilLoopbackHttpHost({
    profileId: `core.${config.launchId}`,
    sessionToken,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
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

  const networkProfile = await host.Start();
  const readyInfo: GongpilCoreReadyInfo = {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: config.launchId,
    sessionId: config.sessionId,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
    health: "ready",
    networkProfile,
    capabilities: ["system.health.read", "system.readiness.verify"],
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
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await host.Stop();
    }
    finally {
      process.exit(0);
    }
  };

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
