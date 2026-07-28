import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveBootstrapPaths } from "../src/bootstrap-paths.ts";
import { GongpilClientBootstrap } from "../src/client-bootstrap.ts";
import { GongpilCoreProcessManager } from "../src/core-process-manager.ts";

const CORE_ENTRY_PATH = fileURLToPath(
  new URL("../../core/src/core-process.ts", import.meta.url),
);

function CreateConfig(
  appRoot: string,
  dataRoot: string,
  options: {
    launchId: string;
    sessionId: string;
    coreVersion: string;
    supportedMajor: number;
    reason: "startup" | "update";
    previousCoreVersion?: string;
  },
): GongpilClientBootstrapConfig {
  return {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: options.launchId,
    sessionId: options.sessionId,
    mode: "installed",
    clientVersion: "0.1.0",
    selectedCoreVersion: options.coreVersion,
    supportedCoreProtocol: {
      major: options.supportedMajor,
      minMinor: 0,
      maxMinor: 0,
    },
    paths: ResolveBootstrapPaths({
      mode: "installed",
      sessionId: options.sessionId,
      appRoot,
      installedDataRoot: dataRoot,
      bundledRuntimePath: process.execPath,
    }),
    activation: {
      reason: options.reason,
      requireHealthCheck: true,
      ...(options.previousCoreVersion === undefined
        ? {}
        : { previousCoreVersion: options.previousCoreVersion }),
    },
  };
}

async function RunDemo(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "gongpil-bootstrap-demo-"));
  const appRoot = join(tempRoot, "app");
  const dataRoot = join(tempRoot, "data");
  await mkdir(appRoot, { recursive: true });

  const manager = new GongpilCoreProcessManager({ coreEntryPath: CORE_ENTRY_PATH });
  const bootstrap = new GongpilClientBootstrap(manager);
  try {
    console.log("1. Client가 설치형 경로를 결정하고 실제 Core 자식 프로세스를 시작합니다.");
    const primary = await bootstrap.ActivateCore(CreateConfig(appRoot, dataRoot, {
      launchId: "demo-primary",
      sessionId: "demo-session-primary",
      coreVersion: "1.0.0",
      supportedMajor: 1,
      reason: "startup",
    }));
    console.log(`[활성화] accepted=${primary.activationResult.accepted} · core=${primary.activationResult.activeCoreVersion}`);

    console.log("\n2. Client의 단일 NetworkRuntime으로 Core health 명령을 보냅니다.");
    const health = await bootstrap.GetNetworkRuntime().Send("system.health.read", {});
    console.log(`[HTTP 결과] ${health.state} · core=${String(health.payload?.coreVersion)}`);

    console.log("\n3. Browser에는 논리 세션 요약만 공개합니다.");
    console.log(`[Browser 요약] ${JSON.stringify(primary.browserSession)}`);

    console.log("\n4. 호환되지 않는 후보를 거부하고 기존 Core로 롤백합니다.");
    const rollback = await bootstrap.ActivateCore(CreateConfig(appRoot, dataRoot, {
      launchId: "demo-candidate",
      sessionId: "demo-session-candidate",
      coreVersion: "2.0.0",
      supportedMajor: 99,
      reason: "update",
      previousCoreVersion: "1.0.0",
    }));
    const afterRollback = await bootstrap.GetNetworkRuntime().Send("system.health.read", {});
    console.log(
      `[롤백] required=${rollback.activationResult.rollbackRequired} · active=${rollback.activationResult.activeCoreVersion} · 명령=${afterRollback.state}`,
    );

    console.log("\n5. Client 종료 시 Core 자식 프로세스도 함께 정리합니다.");
  }
  finally {
    await bootstrap.Stop();
    console.log(`[잔류 Core] ${manager.GetRunningProcessIds().length}`);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

RunDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
