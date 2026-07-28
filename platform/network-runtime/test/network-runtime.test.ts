import assert from "node:assert/strict";
import test from "node:test";

import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  GONGPIL_NETWORK_ROUTES,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkMode,
} from "../src/contracts.ts";
import {
  GongpilNetworkRuntime,
  GongpilNetworkRuntimeError,
} from "../src/network-runtime.ts";
import {
  CreateInitialNetworkStatus,
  ReduceNetworkStatus,
} from "../src/network-status-machine.ts";
import { GongpilInMemoryTransport } from "../src/transports/in-memory-transport.ts";

function CreateProfile(
  profileId: string,
  mode: GongpilNetworkMode = "local",
): GongpilNetworkConnectionProfile {
  return {
    protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
    profileId,
    mode,
    origin: mode === "local" ? "http://127.0.0.1:43110" : "https://cloud.gongpil.example",
    ...GONGPIL_NETWORK_ROUTES,
    authMode: mode === "local" ? "loopback-session" : "secure-cookie",
  };
}

test("상태 머신이 연결과 요청 수를 한곳에서 계산한다", () => {
  const connecting = ReduceNetworkStatus(CreateInitialNetworkStatus(), {
    type: "CONNECT_REQUESTED",
    profileId: "local-core",
    mode: "local",
  });
  const ready = ReduceNetworkStatus(connecting, {
    type: "CONNECTION_READY",
    activeProfileId: "local-core",
    mode: "local",
    roundTripMs: 10,
  });
  const requesting = ReduceNetworkStatus(ready, { type: "REQUEST_STARTED" });
  const finished = ReduceNetworkStatus(requesting, { type: "REQUEST_FINISHED" });

  assert.equal(ready.state, "ready");
  assert.equal(ready.activeProfileId, "local-core");
  assert.equal(ready.activeStreams, 1);
  assert.equal(requesting.activeRequests, 1);
  assert.equal(finished.activeRequests, 0);
});

test("transport 상태 신호를 중앙의 재접속 상태로 변환한다", async () => {
  let transport: GongpilInMemoryTransport | undefined;
  const runtime = new GongpilNetworkRuntime(() => {
    transport = new GongpilInMemoryTransport({ latencyMs: 1 });
    return transport;
  });

  await runtime.ReplaceConnection(CreateProfile("local-core"));
  transport?.PublishStatus({ state: "lost", errorCode: "TEST_CONNECTION_LOST" });
  assert.equal(runtime.GetStatus().state, "reconnecting");
  assert.equal(runtime.GetStatus().reconnectAttempt, 1);

  transport?.PublishStatus({ state: "ready" });
  assert.equal(runtime.GetStatus().state, "ready");
  assert.equal(runtime.GetStatus().reconnectAttempt, 0);
  await runtime.Disconnect();
});

test("ReplaceConnection과 Send가 단일 facade에서 동작한다", async () => {
  const runtime = new GongpilNetworkRuntime(() => new GongpilInMemoryTransport({ latencyMs: 1 }));

  const status = await runtime.ReplaceConnection(CreateProfile("local-core"));
  const result = await runtime.Send("demo.echo", { value: 7 });

  assert.equal(status.activeProfileId, "local-core");
  assert.equal(result.state, "succeeded");
  assert.deepEqual(result.payload?.received, { value: 7 });
  assert.equal(runtime.GetStatus().activeRequests, 0);
  await runtime.Disconnect();
});

test("Subscribe가 transport 이벤트를 한곳으로 전달한다", async () => {
  let transport: GongpilInMemoryTransport | undefined;
  const runtime = new GongpilNetworkRuntime(() => {
    transport = new GongpilInMemoryTransport({ latencyMs: 1 });
    return transport;
  });
  const eventNames: string[] = [];

  runtime.Subscribe((event) => eventNames.push(event.eventName));
  await runtime.ReplaceConnection(CreateProfile("local-core"));
  transport?.Publish("demo.progress", { percent: 25 });

  assert.deepEqual(eventNames, ["demo.progress"]);
  await runtime.Disconnect();
});

test("후보 접속 실패 시 기존 transport와 profile을 유지한다", async () => {
  const transports = new Map<string, GongpilInMemoryTransport>();
  const runtime = new GongpilNetworkRuntime((profile) => {
    const transport = new GongpilInMemoryTransport({
      latencyMs: 1,
      failConnect: profile.profileId === "broken-cloud",
    });
    transports.set(profile.profileId, transport);
    return transport;
  });

  await runtime.ReplaceConnection(CreateProfile("local-core"));
  await assert.rejects(
    () => runtime.ReplaceConnection(CreateProfile("broken-cloud", "cloud")),
    (error: unknown) => {
      assert.ok(error instanceof GongpilNetworkRuntimeError);
      assert.equal(error.code, "CONNECTION_REPLACEMENT_FAILED");
      return true;
    },
  );

  const status = runtime.GetStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.activeProfileId, "local-core");
  assert.equal(status.pendingProfileId, undefined);
  assert.equal(status.lastErrorCode, "CONNECTION_REPLACEMENT_FAILED");
  assert.equal(transports.get("local-core")?.IsConnected(), true);
  assert.equal(transports.get("broken-cloud")?.IsConnected(), false);
  await runtime.Disconnect();
});

test("로컬 profile은 loopback 주소만 허용한다", async () => {
  const runtime = new GongpilNetworkRuntime(() => new GongpilInMemoryTransport());
  const invalidProfile = {
    ...CreateProfile("invalid-local"),
    origin: "http://192.168.0.2:43110",
  };

  await assert.rejects(
    () => runtime.ReplaceConnection(invalidProfile),
    (error: unknown) => {
      assert.ok(error instanceof GongpilNetworkRuntimeError);
      assert.equal(error.code, "NETWORK_PROFILE_INVALID");
      return true;
    },
  );
});

test("접속이 없어도 Send는 예외 대신 정규화된 결과를 반환한다", async () => {
  const runtime = new GongpilNetworkRuntime(() => new GongpilInMemoryTransport());

  const result = await runtime.Send("demo.echo", { value: 1 });

  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "NETWORK_NOT_CONNECTED");
  assert.equal(runtime.GetStatus().activeRequests, 0);
});
