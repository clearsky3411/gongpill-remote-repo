import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as Wait } from "node:timers/promises";

import type {
  GongpilNetworkConnectionProfile,
  GongpilNetworkEvent,
  GongpilNetworkStatus,
} from "../src/contracts.ts";
import { GongpilLoopbackHttpHost } from "../src/host/loopback-http-host.ts";
import {
  GongpilNetworkRuntime,
  GongpilNetworkRuntimeError,
} from "../src/network-runtime.ts";
import { GongpilLoopbackHttpTransport } from "../src/transports/loopback-http-transport.ts";

const PRIMARY_SESSION_TOKEN = "test-primary-session-token-0001";
const CANDIDATE_SESSION_TOKEN = "test-candidate-session-token-0002";

async function WaitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Wait(10);
  }
  throw new Error(`${description} 대기 시간이 초과됐습니다.`);
}

function CreateTransport(sessionToken: string): GongpilLoopbackHttpTransport {
  return new GongpilLoopbackHttpTransport({
    sessionToken,
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
    reconnectInitialDelayMs: 10,
    reconnectMaxDelayMs: 20,
  });
}

test("실제 127.0.0.1 동적 포트에서 HTTP JSON 명령과 결과를 교환한다", async () => {
  const host = new GongpilLoopbackHttpHost({
    profileId: "primary-local",
    sessionToken: PRIMARY_SESSION_TOKEN,
  });
  host.RegisterCommand("demo.echo", (payload) => ({ received: payload }));

  let runtime: GongpilNetworkRuntime | undefined;
  try {
    const profile = await host.Start();
    assert.match(profile.origin, /^http:\/\/127\.0\.0\.1:[1-9]\d*$/);

    runtime = new GongpilNetworkRuntime(() => CreateTransport(PRIMARY_SESSION_TOKEN));
    const status = await runtime.ReplaceConnection(profile);
    const result = await runtime.Send("demo.echo", { text: "실제 loopback" });

    assert.equal(status.state, "ready");
    assert.equal(status.activeProfileId, "primary-local");
    assert.equal(result.state, "succeeded");
    assert.deepEqual(result.payload, { received: { text: "실제 loopback" } });
    assert.equal(host.GetActiveSseConnectionCount(), 1);
  }
  finally {
    await runtime?.Disconnect();
    await host.Stop();
  }
});

test("인증되지 않은 consumer는 loopback session에 접속하지 못한다", async () => {
  const host = new GongpilLoopbackHttpHost({
    profileId: "secured-local",
    sessionToken: PRIMARY_SESSION_TOKEN,
  });

  let runtime: GongpilNetworkRuntime | undefined;
  try {
    const profile = await host.Start();
    runtime = new GongpilNetworkRuntime(() => CreateTransport(CANDIDATE_SESSION_TOKEN));

    await assert.rejects(
      () => runtime?.ReplaceConnection(profile),
      (error: unknown) => {
        assert.ok(error instanceof GongpilNetworkRuntimeError);
        assert.equal(error.code, "CONNECTION_REPLACEMENT_FAILED");
        return true;
      },
    );
    assert.equal(runtime.GetStatus().state, "failed");
    assert.equal(host.GetActiveSseConnectionCount(), 0);
  }
  finally {
    await runtime?.Disconnect();
    await host.Stop();
  }
});

test("세션당 SSE stream 하나로 이벤트를 받고 끊기면 같은 stream을 재접속한다", async () => {
  const host = new GongpilLoopbackHttpHost({
    profileId: "stream-local",
    sessionToken: PRIMARY_SESSION_TOKEN,
  });
  const events: GongpilNetworkEvent[] = [];
  const statuses: GongpilNetworkStatus[] = [];

  let runtime: GongpilNetworkRuntime | undefined;
  try {
    const profile = await host.Start();
    runtime = new GongpilNetworkRuntime(() => CreateTransport(PRIMARY_SESSION_TOKEN));
    runtime.Subscribe((event) => events.push(event));
    runtime.SubscribeStatus((status) => statuses.push(status));
    await runtime.ReplaceConnection(profile);

    host.Publish("demo.progress", { percent: 25 });
    await WaitForCondition(() => events.length === 1, "첫 SSE 이벤트 수신");
    assert.equal(events[0].eventName, "demo.progress");
    assert.deepEqual(events[0].payload, { percent: 25 });
    assert.equal(host.GetActiveSseConnectionCount(), 1);
    assert.equal(host.GetMaxSseConnectionCount(), 1);

    host.DropEventStream();
    await WaitForCondition(
      () => statuses.some((status) => status.state === "reconnecting"),
      "재접속 상태 관측",
    );
    await WaitForCondition(
      () => host.GetSseConnectionOpenCount() >= 2 && runtime?.GetStatus().state === "ready",
      "SSE 재접속 완료",
    );

    host.Publish("demo.progress", { percent: 100 });
    await WaitForCondition(() => events.length === 2, "재접속 후 SSE 이벤트 수신");
    assert.equal(events[1].payload.percent, 100);
    assert.equal(host.GetActiveSseConnectionCount(), 1);
    assert.equal(host.GetMaxSseConnectionCount(), 1);
  }
  finally {
    await runtime?.Disconnect();
    await host.Stop();
  }
});

test("활성 접속을 유지하며 후보를 검증하고 실패하면 기존 접속으로 롤백한다", async () => {
  const primaryHost = new GongpilLoopbackHttpHost({
    profileId: "primary-local",
    sessionToken: PRIMARY_SESSION_TOKEN,
  });
  const candidateHost = new GongpilLoopbackHttpHost({
    profileId: "candidate-local",
    sessionToken: CANDIDATE_SESSION_TOKEN,
    ready: false,
  });
  primaryHost.RegisterCommand("demo.echo", (payload) => ({ host: "primary", received: payload }));
  const statuses: GongpilNetworkStatus[] = [];

  let runtime: GongpilNetworkRuntime | undefined;
  try {
    const primaryProfile = await primaryHost.Start();
    const candidateProfile = await candidateHost.Start();
    const tokens = new Map<string, string>([
      [primaryProfile.profileId, PRIMARY_SESSION_TOKEN],
      [candidateProfile.profileId, CANDIDATE_SESSION_TOKEN],
    ]);
    runtime = new GongpilNetworkRuntime((profile: GongpilNetworkConnectionProfile) => {
      const sessionToken = tokens.get(profile.profileId);
      assert.notEqual(sessionToken, undefined);
      return CreateTransport(sessionToken!);
    });
    runtime.SubscribeStatus((status) => statuses.push(status));

    await runtime.ReplaceConnection(primaryProfile);
    assert.equal(primaryHost.GetActiveSseConnectionCount(), 1);

    await assert.rejects(
      () => runtime?.ReplaceConnection(candidateProfile),
      (error: unknown) => {
        assert.ok(error instanceof GongpilNetworkRuntimeError);
        assert.equal(error.code, "CONNECTION_REPLACEMENT_FAILED");
        return true;
      },
    );

    const status = runtime.GetStatus();
    const validatingStatus = statuses.find((item) => (
      item.state === "connecting"
      && item.activeProfileId === primaryProfile.profileId
      && item.pendingProfileId === candidateProfile.profileId
    ));
    assert.notEqual(validatingStatus, undefined);
    assert.equal(validatingStatus?.activeStreams, 1);
    assert.equal(status.state, "ready");
    assert.equal(status.activeProfileId, primaryProfile.profileId);
    assert.equal(status.pendingProfileId, undefined);
    assert.equal(status.lastErrorCode, "CONNECTION_REPLACEMENT_FAILED");
    assert.equal(primaryHost.GetActiveSseConnectionCount(), 1);
    assert.equal(candidateHost.GetActiveSseConnectionCount(), 0);

    const result = await runtime.Send("demo.echo", { afterRollback: true });
    assert.equal(result.state, "succeeded");
    assert.deepEqual(result.payload, {
      host: "primary",
      received: { afterRollback: true },
    });
  }
  finally {
    await runtime?.Disconnect();
    await primaryHost.Stop();
    await candidateHost.Stop();
  }
});
