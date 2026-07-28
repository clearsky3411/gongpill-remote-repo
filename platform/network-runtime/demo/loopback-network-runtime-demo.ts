import { randomBytes } from "node:crypto";
import { setTimeout as Wait } from "node:timers/promises";

import type {
  GongpilNetworkConnectionProfile,
  GongpilNetworkStatus,
} from "../src/contracts.ts";
import { GongpilLoopbackHttpHost } from "../src/host/loopback-http-host.ts";
import {
  GongpilNetworkRuntime,
  GongpilNetworkRuntimeError,
} from "../src/network-runtime.ts";
import { GongpilLoopbackHttpTransport } from "../src/transports/loopback-http-transport.ts";

function CreateSessionToken(): string {
  return randomBytes(24).toString("hex");
}

function FormatStatus(status: GongpilNetworkStatus): string {
  const profile = status.activeProfileId ?? "없음";
  const pending = status.pendingProfileId === undefined
    ? ""
    : ` · 후보=${status.pendingProfileId}`;
  const error = status.lastErrorCode === undefined ? "" : ` · 오류=${status.lastErrorCode}`;
  return `[NetworkRuntime] ${status.state} · 활성=${profile}${pending} · stream=${status.activeStreams}${error}`;
}

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

async function RunDemo(): Promise<void> {
  const primarySessionToken = CreateSessionToken();
  const candidateSessionToken = CreateSessionToken();
  const primaryHost = new GongpilLoopbackHttpHost({
    profileId: "local-core-primary",
    sessionToken: primarySessionToken,
  });
  const candidateHost = new GongpilLoopbackHttpHost({
    profileId: "local-core-broken-candidate",
    sessionToken: candidateSessionToken,
    ready: false,
  });
  primaryHost.RegisterCommand("demo.echo", (payload) => ({
    host: "local-core-primary",
    received: payload,
  }));
  let receivedEventCount = 0;

  let runtime: GongpilNetworkRuntime | undefined;
  try {
    const primaryProfile = await primaryHost.Start();
    const candidateProfile = await candidateHost.Start();
    const sessionTokens = new Map<string, string>([
      [primaryProfile.profileId, primarySessionToken],
      [candidateProfile.profileId, candidateSessionToken],
    ]);

    runtime = new GongpilNetworkRuntime((profile: GongpilNetworkConnectionProfile) => {
      const sessionToken = sessionTokens.get(profile.profileId);
      if (sessionToken === undefined) {
        throw new Error(`session token이 없는 profile입니다: ${profile.profileId}`);
      }
      return new GongpilLoopbackHttpTransport({
        sessionToken,
        reconnectInitialDelayMs: 25,
        reconnectMaxDelayMs: 50,
      });
    });
    runtime.SubscribeStatus((status) => console.log(FormatStatus(status)));
    runtime.Subscribe((event) => {
      receivedEventCount += 1;
      console.log(`[SSE 이벤트] ${event.eventName} · ${JSON.stringify(event.payload)}`);
    });

    console.log("\n1. OS가 선택한 실제 loopback 동적 포트에 연결합니다.");
    console.log(`[Host] ${primaryProfile.origin}`);
    await runtime.ReplaceConnection(primaryProfile);

    console.log("\n2. NetworkRuntime 한 객체로 HTTP JSON 명령과 결과를 교환합니다.");
    const result = await runtime.Send("demo.echo", { text: "공필 loopback 확인" });
    console.log(`[HTTP 결과] ${result.state} · ${JSON.stringify(result.payload)}`);

    console.log("\n3. 세션의 단일 SSE stream으로 이벤트를 받습니다.");
    primaryHost.Publish("demo.progress", { percent: 50 });
    await WaitForCondition(() => receivedEventCount >= 1, "첫 SSE 이벤트 수신");
    console.log(
      `[SSE 개수] 활성=${primaryHost.GetActiveSseConnectionCount()} · 최대동시=${primaryHost.GetMaxSseConnectionCount()}`,
    );

    console.log("\n4. SSE를 강제로 끊고 NetworkRuntime의 자동 재접속을 확인합니다.");
    primaryHost.DropEventStream();
    await WaitForCondition(
      () => primaryHost.GetSseConnectionOpenCount() >= 2 && runtime?.GetStatus().state === "ready",
      "SSE 재접속",
    );
    primaryHost.Publish("demo.progress", { percent: 100 });
    await WaitForCondition(() => receivedEventCount >= 2, "재접속 후 SSE 이벤트 수신");
    console.log(
      `[SSE 재접속] 누적연결=${primaryHost.GetSseConnectionOpenCount()} · 최대동시=${primaryHost.GetMaxSseConnectionCount()}`,
    );

    console.log("\n5. 고장 난 후보를 검증하는 동안 현재 접속을 유지하고 실패 시 롤백합니다.");
    try {
      await runtime.ReplaceConnection(candidateProfile);
    }
    catch (error) {
      const code = error instanceof GongpilNetworkRuntimeError ? error.code : "UNKNOWN";
      console.log(`[후보 거부] ${code}`);
    }
    const rollbackResult = await runtime.Send("demo.echo", { afterRollback: true });
    console.log(
      `[롤백 확인] 활성=${runtime.GetStatus().activeProfileId} · 결과=${rollbackResult.state}`,
    );
  }
  finally {
    await runtime?.Disconnect();
    await primaryHost.Stop();
    await candidateHost.Stop();
  }
}

RunDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
