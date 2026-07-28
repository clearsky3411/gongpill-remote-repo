import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  GONGPIL_NETWORK_ROUTES,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkMode,
  type GongpilNetworkStatus,
} from "../src/contracts.ts";
import {
  GongpilNetworkRuntime,
  GongpilNetworkRuntimeError,
} from "../src/network-runtime.ts";
import { GongpilInMemoryTransport } from "../src/transports/in-memory-transport.ts";

function CreateProfile(
  profileId: string,
  mode: GongpilNetworkMode,
  origin: string,
): GongpilNetworkConnectionProfile {
  return {
    protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
    profileId,
    mode,
    origin,
    ...GONGPIL_NETWORK_ROUTES,
    authMode: mode === "local" ? "loopback-session" : "secure-cookie",
  };
}

function FormatStatus(status: GongpilNetworkStatus): string {
  const profile = status.activeProfileId ?? "없음";
  const pending = status.pendingProfileId === undefined
    ? ""
    : ` · 후보=${status.pendingProfileId}(${status.pendingMode})`;
  const latency = status.roundTripMs === undefined ? "-" : `${status.roundTripMs}ms`;
  const error = status.lastErrorCode === undefined ? "" : ` · 오류=${status.lastErrorCode}`;
  return `[상태] ${status.mode} · ${status.state} · 활성=${profile}${pending} · ${latency}${error}`;
}

async function RunDemo(): Promise<void> {
  const transports = new Map<string, GongpilInMemoryTransport>();
  const runtime = new GongpilNetworkRuntime((profile) => {
    const transport = new GongpilInMemoryTransport({
      latencyMs: profile.mode === "local" ? 6 : 18,
      failConnect: profile.profileId === "broken-cloud",
    });
    transports.set(profile.profileId, transport);
    return transport;
  });

  runtime.SubscribeStatus((status) => console.log(FormatStatus(status)));
  runtime.Subscribe((event) => {
    console.log(`[이벤트 수신] ${event.eventName} · ${JSON.stringify(event.payload)}`);
  });

  console.log("\n1. 로컬 Core 후보 연결");
  await runtime.ReplaceConnection(
    CreateProfile("local-core-0.1.0", "local", "http://127.0.0.1:43110"),
  );

  console.log("\n2. 단일 NetworkRuntime으로 명령 송신과 결과 수신");
  const result = await runtime.Send("demo.echo", { text: "공필 네트워크 확인" });
  console.log(`[최종 결과] ${result.state} · ${JSON.stringify(result.payload)}`);

  console.log("\n3. 같은 NetworkRuntime으로 이벤트 수신");
  transports.get("local-core-0.1.0")?.Publish("demo.progress", { percent: 50 });

  console.log("\n4. 클라우드 프로필로 원자 교체");
  await runtime.ReplaceConnection(
    CreateProfile("cloud-primary", "cloud", "https://cloud.gongpil.example"),
  );

  console.log("\n5. 연결 손실과 중앙 상태 복구");
  transports.get("cloud-primary")?.PublishStatus({
    state: "lost",
    errorCode: "DEMO_CONNECTION_LOST",
  });
  transports.get("cloud-primary")?.PublishStatus({ state: "ready" });

  console.log("\n6. 고장 난 후보로 교체 시도 후 기존 접속 유지");
  try {
    await runtime.ReplaceConnection(
      CreateProfile("broken-cloud", "cloud", "https://broken.gongpil.example"),
    );
  }
  catch (error) {
    const code = error instanceof GongpilNetworkRuntimeError ? error.code : "UNKNOWN";
    console.log(`[교체 거부] ${code}`);
  }

  const finalStatus = runtime.GetStatus();
  console.log(
    `[최종 활성 접속] ${finalStatus.activeProfileId} · ${finalStatus.state} · 기존 접속 유지`,
  );
  await runtime.Disconnect();
}

RunDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
