import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveBootstrapPaths } from "../../client/src/bootstrap-paths.ts";
import {
  GongpilClientBootstrap,
  GongpilClientBootstrapError,
} from "../../client/src/client-bootstrap.ts";
import { GongpilCoreProcessManager } from "../../client/src/core-process-manager.ts";

const CORE_ENTRY_PATH = fileURLToPath(
  new URL("../../core/src/core-process.ts", import.meta.url),
);

interface GongpilTestContext {
  tempRoot: string;
  appRoot: string;
  manager: GongpilCoreProcessManager;
  bootstrap: GongpilClientBootstrap;
}

async function CreateTestContext(): Promise<GongpilTestContext> {
  const tempRoot = await mkdtemp(join(tmpdir(), "gongpil-bootstrap-"));
  const appRoot = join(tempRoot, "app");
  await mkdir(appRoot, { recursive: true });
  const manager = new GongpilCoreProcessManager({
    coreEntryPath: CORE_ENTRY_PATH,
    startTimeoutMs: 4_000,
    stopTimeoutMs: 2_000,
  });
  return {
    tempRoot,
    appRoot,
    manager,
    bootstrap: new GongpilClientBootstrap(manager),
  };
}

function CreateConfig(
  context: GongpilTestContext,
  options: {
    launchId: string;
    sessionId: string;
    selectedCoreVersion: string;
    supportedProtocolMajor?: number;
    reason?: "startup" | "update" | "rollback";
    previousCoreVersion?: string;
    bundledRuntimePath?: string;
  },
): GongpilClientBootstrapConfig {
  const paths = ResolveBootstrapPaths({
    mode: "installed",
    sessionId: options.sessionId,
    appRoot: context.appRoot,
    installedDataRoot: join(context.tempRoot, "data"),
    bundledRuntimePath: options.bundledRuntimePath ?? process.execPath,
  });
  return {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: options.launchId,
    sessionId: options.sessionId,
    mode: "installed",
    clientVersion: "0.1.0",
    selectedCoreVersion: options.selectedCoreVersion,
    supportedCoreProtocol: {
      major: options.supportedProtocolMajor ?? 1,
      minMinor: 0,
      maxMinor: 0,
    },
    paths,
    activation: {
      reason: options.reason ?? "startup",
      requireHealthCheck: true,
      ...(options.previousCoreVersion === undefined
        ? {}
        : { previousCoreVersion: options.previousCoreVersion }),
    },
  };
}

test("설치형과 포터블 경로를 Browser 경계 밖에서 결정한다", () => {
  const installed = ResolveBootstrapPaths({
    mode: "installed",
    sessionId: "session-installed",
    appRoot: "G:\\Apps\\Gongpil",
    installedDataRoot: "G:\\Users\\Data\\Gongpil",
    bundledRuntimePath: "G:\\Apps\\Gongpil\\runtime\\node.exe",
  });
  const portable = ResolveBootstrapPaths({
    mode: "portable",
    sessionId: "session-portable",
    appRoot: "G:\\Portable\\Gongpil",
  });

  assert.equal(installed.dataRoot, "G:\\Users\\Data\\Gongpil");
  assert.equal(installed.sessionTemp, "G:\\Users\\Data\\Gongpil\\sessions\\session-installed");
  assert.equal(portable.dataRoot, "G:\\Portable\\Gongpil\\GongpilData");
  assert.equal(portable.versionRoot, "G:\\Portable\\Gongpil\\versions");
});

test("Client가 실제 Core 자식 프로세스를 시작하고 HTTP/SSE 접속을 활성화한다", async () => {
  const context = await CreateTestContext();
  const inheritedToken = process.env.GONGPIL_LOOPBACK_SESSION_TOKEN;
  const inheritedPath = process.env.PATH;
  const inheritedCodexHome = process.env.CODEX_HOME;
  try {
    const result = await context.bootstrap.ActivateCore(CreateConfig(context, {
      launchId: "launch-primary",
      sessionId: "session-primary",
      selectedCoreVersion: "1.0.0",
    }));
    const health = await context.bootstrap.GetNetworkRuntime().Send("system.health.read", {});
    const browserJson = JSON.stringify(result.browserSession);

    assert.equal(result.activationResult.accepted, true);
    assert.equal(result.browserSession.coreStatus, "ready");
    assert.equal(health.state, "succeeded");
    assert.equal(health.payload?.coreVersion, "1.0.0");
    assert.equal(context.manager.GetRunningProcessIds().length, 1);
    assert.equal(process.env.GONGPIL_LOOPBACK_SESSION_TOKEN, inheritedToken);
    assert.equal(process.env.PATH, inheritedPath);
    assert.equal(process.env.CODEX_HOME, inheritedCodexHome);
    assert.doesNotMatch(
      browserJson,
      /appRoot|dataRoot|versionRoot|sessionTemp|bundledRuntimePath|origin|port|token|secret/i,
    );
  }
  finally {
    await context.bootstrap.Stop();
    assert.deepEqual(context.manager.GetRunningProcessIds(), []);
    await rm(context.tempRoot, { recursive: true, force: true });
  }
});

test("호환되지 않는 후보 Core를 종료하고 기존 Core와 NetworkRuntime을 유지한다", async () => {
  const context = await CreateTestContext();
  try {
    await context.bootstrap.ActivateCore(CreateConfig(context, {
      launchId: "launch-stable",
      sessionId: "session-stable",
      selectedCoreVersion: "1.0.0",
    }));
    const stableProcessId = context.bootstrap.GetActiveProcessId();

    const rollback = await context.bootstrap.ActivateCore(CreateConfig(context, {
      launchId: "launch-candidate",
      sessionId: "session-candidate",
      selectedCoreVersion: "2.0.0",
      supportedProtocolMajor: 99,
      reason: "update",
      previousCoreVersion: "1.0.0",
    }));
    const health = await context.bootstrap.GetNetworkRuntime().Send("system.health.read", {});

    assert.equal(rollback.activationResult.accepted, false);
    assert.equal(rollback.activationResult.rollbackRequired, true);
    assert.equal(rollback.activationResult.activeCoreVersion, "1.0.0");
    assert.equal(rollback.browserSession.coreStatus, "rolled-back");
    assert.equal(context.bootstrap.GetActiveProcessId(), stableProcessId);
    assert.deepEqual(context.manager.GetRunningProcessIds(), [stableProcessId]);
    assert.equal(health.state, "succeeded");
    assert.equal(health.payload?.coreVersion, "1.0.0");
  }
  finally {
    await context.bootstrap.Stop();
    await rm(context.tempRoot, { recursive: true, force: true });
  }
});

test("호환되는 후보 Core를 활성화하고 이전 Core 프로세스를 종료한다", async () => {
  const context = await CreateTestContext();
  try {
    await context.bootstrap.ActivateCore(CreateConfig(context, {
      launchId: "launch-before-update",
      sessionId: "session-before-update",
      selectedCoreVersion: "1.0.0",
    }));
    const previousProcessId = context.bootstrap.GetActiveProcessId();

    const updated = await context.bootstrap.ActivateCore(CreateConfig(context, {
      launchId: "launch-after-update",
      sessionId: "session-after-update",
      selectedCoreVersion: "2.0.0",
      reason: "update",
      previousCoreVersion: "1.0.0",
    }));
    const activeProcessId = context.bootstrap.GetActiveProcessId();
    const health = await context.bootstrap.GetNetworkRuntime().Send("system.health.read", {});

    assert.equal(updated.activationResult.accepted, true);
    assert.equal(updated.activationResult.activeCoreVersion, "2.0.0");
    assert.notEqual(activeProcessId, previousProcessId);
    assert.deepEqual(context.manager.GetRunningProcessIds(), [activeProcessId]);
    assert.equal(health.state, "succeeded");
    assert.equal(health.payload?.coreVersion, "2.0.0");
  }
  finally {
    await context.bootstrap.Stop();
    await rm(context.tempRoot, { recursive: true, force: true });
  }
});

test("Core 실행 파일 시작 실패를 정규화하고 잔류 프로세스를 남기지 않는다", async () => {
  const context = await CreateTestContext();
  try {
    const invalidRuntime = join(context.tempRoot, "missing-runtime.exe");
    await assert.rejects(
      () => context.bootstrap.ActivateCore(CreateConfig(context, {
        launchId: "launch-failed",
        sessionId: "session-failed",
        selectedCoreVersion: "1.0.0",
        bundledRuntimePath: invalidRuntime,
      })),
      (error: unknown) => {
        assert.ok(error instanceof GongpilClientBootstrapError);
        assert.equal(error.bootstrapError.code, "CORE_START_FAILED");
        return true;
      },
    );
    assert.deepEqual(context.manager.GetRunningProcessIds(), []);
  }
  finally {
    await context.bootstrap.Stop();
    await rm(context.tempRoot, { recursive: true, force: true });
  }
});
