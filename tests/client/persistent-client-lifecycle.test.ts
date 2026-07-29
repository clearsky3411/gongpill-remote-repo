import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { ResolveBootstrapPaths } from "../../client/src/bootstrap-paths.ts";
import { GongpilClientBootstrap } from "../../client/src/client-bootstrap.ts";
import { GongpilClientRuntime } from "../../client/src/client-runtime.ts";
import { GongpilCoreProcessManager } from "../../client/src/core-process-manager.ts";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CORE_ENTRY_PATH = join(APP_ROOT, "core", "src", "core-process.ts");

test("Client Runtime이 Instance Runtime 정상·비정상 종료 뒤 다시 시작된다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-client-runtime-"));
  const manager = new GongpilCoreProcessManager({ coreEntryPath: CORE_ENTRY_PATH });
  const runtime = new GongpilClientRuntime(new GongpilClientBootstrap(manager));

  try {
    const firstConfig = CreateConfig(dataRoot);
    const firstResult = await runtime.StartInstance(firstConfig);
    assert.equal(runtime.GetState(), "running");
    assert.equal(firstResult.browserSession.sessionId, firstConfig.sessionId);

    const firstShutdown = await runtime.GetNetworkRuntime().Send("instance.shutdown.request", {});
    assert.equal(firstShutdown.state, "succeeded");
    assert.equal((await runtime.WaitForInstanceExit()).reason, "stopped");
    assert.equal(runtime.GetState(), "idle");
    assert.deepEqual(manager.GetRunningProcessIds(), []);

    const secondConfig = CreateConfig(dataRoot);
    assert.notEqual(secondConfig.sessionId, firstConfig.sessionId);
    const secondResult = await runtime.StartInstance(secondConfig);
    assert.equal(runtime.GetState(), "running");
    assert.equal(secondResult.browserSession.sessionId, secondConfig.sessionId);

    const legacyShutdown = await runtime.GetNetworkRuntime().Send("system.shutdown.request", {});
    assert.equal(legacyShutdown.state, "succeeded");
    assert.equal((await runtime.WaitForInstanceExit()).reason, "stopped");
    assert.equal(runtime.GetState(), "idle");

    const crashedConfig = CreateConfig(dataRoot);
    await runtime.StartInstance(crashedConfig);
    const crashedProcessId = runtime.GetActiveProcessId();
    assert.notEqual(crashedProcessId, undefined);
    process.kill(crashedProcessId as number, "SIGKILL");
    assert.equal((await runtime.WaitForInstanceExit()).reason, "crashed");
    assert.equal(runtime.GetState(), "idle");
    assert.deepEqual(manager.GetRunningProcessIds(), []);

    const recoveredConfig = CreateConfig(dataRoot);
    await runtime.StartInstance(recoveredConfig);
    const recoveredShutdown = await runtime.GetNetworkRuntime().Send("instance.shutdown.request", {});
    assert.equal(recoveredShutdown.state, "succeeded");
    assert.equal((await runtime.WaitForInstanceExit()).reason, "stopped");

    await runtime.Shutdown();
    assert.equal(runtime.GetState(), "stopped");
    assert.deepEqual(manager.GetRunningProcessIds(), []);
  }
  finally {
    await runtime.Shutdown();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("Browser 생존 임대가 만료되면 Instance만 종료하고 Client는 idle로 돌아간다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-browser-presence-"));
  const manager = new GongpilCoreProcessManager({
    coreEntryPath: CORE_ENTRY_PATH,
    coreEnvironment: {
      GONGPIL_BROWSER_PRESENCE_TIMEOUT_MS: "150",
      GONGPIL_BROWSER_STARTUP_GRACE_MS: "500",
      GONGPIL_BROWSER_RESUME_TOLERANCE_MS: "50",
    },
  });
  const runtime = new GongpilClientRuntime(new GongpilClientBootstrap(manager));

  try {
    await runtime.StartInstance(CreateConfig(dataRoot));
    const browserSession = await runtime.GetNetworkRuntime().Send("browser.session.create", {});
    assert.equal(browserSession.state, "succeeded");

    const heartbeat = await runtime.GetNetworkRuntime().Send("browser.presence.ack", {
      heartbeatId: "test-heartbeat",
    });
    assert.equal(heartbeat.state, "succeeded");
    assert.equal((await runtime.WaitForInstanceExit()).reason, "stopped");
    assert.equal(runtime.GetState(), "idle");
    assert.deepEqual(manager.GetRunningProcessIds(), []);
  }
  finally {
    await runtime.Shutdown();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

function CreateConfig(dataRoot: string): GongpilClientBootstrapConfig {
  const launchId = `launch-${crypto.randomUUID()}`;
  const sessionId = `session-${crypto.randomUUID()}`;
  return {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId,
    sessionId,
    mode: "installed",
    clientVersion: "0.1.0",
    selectedCoreVersion: "0.1.0",
    supportedCoreProtocol: { major: 1, minMinor: 0, maxMinor: 0 },
    paths: ResolveBootstrapPaths({
      mode: "installed",
      sessionId,
      appRoot: APP_ROOT,
      installedDataRoot: dataRoot,
      bundledRuntimePath: process.execPath,
    }),
    activation: { reason: "startup", requireHealthCheck: true },
  };
}
