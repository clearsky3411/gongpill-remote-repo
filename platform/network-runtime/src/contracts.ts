export const GONGPIL_NETWORK_PROTOCOL_VERSION = Object.freeze({
  major: 1,
  minor: 0,
});

export const GONGPIL_NETWORK_ROUTES = Object.freeze({
  commandBasePath: "/api/v1/commands",
  eventPath: "/api/v1/events",
  statusPath: "/api/v1/network/status",
});

export type GongpilNetworkMode = "local" | "cloud";

export type GongpilNetworkState =
  | "starting"
  | "connecting"
  | "ready"
  | "degraded"
  | "reconnecting"
  | "offline"
  | "failed";

export type GongpilNetworkPayload = Readonly<Record<string, unknown>>;

export type GongpilUnsubscribe = () => void;

export interface GongpilProtocolVersion {
  major: number;
  minor: number;
}

export interface GongpilNetworkConnectionProfile {
  protocolVersion: GongpilProtocolVersion;
  profileId: string;
  mode: GongpilNetworkMode;
  origin: string;
  commandBasePath: "/api/v1/commands";
  eventPath: "/api/v1/events";
  statusPath: "/api/v1/network/status";
  authMode: "loopback-session" | "secure-cookie";
}

export interface GongpilNetworkCommandRequest {
  protocolVersion: GongpilProtocolVersion;
  requestId: string;
  commandName: string;
  traceId?: string;
  idempotencyKey?: string;
  payload: GongpilNetworkPayload;
}

export interface GongpilNetworkError {
  code: string;
  userMessage: string;
  retryable: boolean;
  traceId?: string;
}

export interface GongpilNetworkCommandResult {
  protocolVersion: GongpilProtocolVersion;
  requestId: string;
  state: "succeeded" | "failed" | "cancelled";
  payload?: GongpilNetworkPayload;
  error?: GongpilNetworkError;
}

export interface GongpilNetworkEvent {
  protocolVersion: GongpilProtocolVersion;
  eventId: string;
  eventName: string;
  occurredAt: string;
  requestId?: string;
  traceId?: string;
  payload: GongpilNetworkPayload;
}

export interface GongpilNetworkStatus {
  protocolVersion: GongpilProtocolVersion;
  mode: GongpilNetworkMode;
  state: GongpilNetworkState;
  commandChannel: "http-json";
  eventChannel: "sse";
  security: "loopback-session" | "tls-session";
  activeProfileId?: string;
  pendingProfileId?: string;
  pendingMode?: GongpilNetworkMode;
  coreVersion?: string;
  coreApiVersion?: string;
  lastHeartbeatAt?: string;
  roundTripMs?: number;
  activeRequests: number;
  activeStreams: number;
  reconnectAttempt: number;
  lastErrorCode?: string;
  lastTraceId?: string;
}

export interface GongpilNetworkTransport {
  Connect(profile: GongpilNetworkConnectionProfile): Promise<void>;
  Disconnect(): Promise<void>;
  Send(request: GongpilNetworkCommandRequest): Promise<GongpilNetworkCommandResult>;
  Cancel(requestId: string): Promise<GongpilNetworkCommandResult>;
  Subscribe(listener: (event: GongpilNetworkEvent) => void): GongpilUnsubscribe;
  SubscribeStatus(listener: (signal: GongpilTransportStatusSignal) => void): GongpilUnsubscribe;
  GetRoundTripMs(): number | undefined;
}

export type GongpilTransportStatusSignal =
  | { state: "ready" }
  | { state: "degraded"; errorCode: string }
  | { state: "lost"; errorCode: string }
  | { state: "offline"; errorCode?: string };

export type GongpilNetworkTransportFactory = (
  profile: GongpilNetworkConnectionProfile,
) => GongpilNetworkTransport;
