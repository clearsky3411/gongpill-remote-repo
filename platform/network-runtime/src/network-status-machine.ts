import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  type GongpilNetworkMode,
  type GongpilNetworkStatus,
} from "./contracts.ts";

export type GongpilNetworkStatusEvent =
  | { type: "CONNECT_REQUESTED"; profileId: string; mode: GongpilNetworkMode }
  | {
      type: "CONNECTION_READY";
      activeProfileId: string;
      mode: GongpilNetworkMode;
      roundTripMs?: number;
    }
  | { type: "CONNECTION_DEGRADED"; errorCode: string }
  | { type: "CONNECTION_LOST"; errorCode: string }
  | { type: "CONNECTION_OFFLINE"; errorCode?: string }
  | { type: "CONNECTION_FAILED"; errorCode: string }
  | { type: "REQUEST_STARTED" }
  | { type: "REQUEST_FINISHED" }
  | { type: "STREAM_OPENED" }
  | { type: "STREAM_CLOSED" };

export function CreateInitialNetworkStatus(
  mode: GongpilNetworkMode = "local",
): GongpilNetworkStatus {
  return {
    protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
    mode,
    state: "starting",
    commandChannel: "http-json",
    eventChannel: "sse",
    security: mode === "local" ? "loopback-session" : "tls-session",
    activeRequests: 0,
    activeStreams: 0,
    reconnectAttempt: 0,
  };
}

export function ReduceNetworkStatus(
  current: GongpilNetworkStatus,
  event: GongpilNetworkStatusEvent,
): GongpilNetworkStatus {
  switch (event.type) {
    case "CONNECT_REQUESTED":
      return {
        ...current,
        mode: current.activeProfileId === undefined ? event.mode : current.mode,
        state: "connecting",
        security: current.activeProfileId === undefined
          ? event.mode === "local" ? "loopback-session" : "tls-session"
          : current.security,
        pendingProfileId: event.profileId,
        pendingMode: event.mode,
        lastErrorCode: undefined,
      };
    case "CONNECTION_READY":
      return {
        ...current,
        mode: event.mode,
        state: "ready",
        security: event.mode === "local" ? "loopback-session" : "tls-session",
        activeProfileId: event.activeProfileId,
        pendingProfileId: undefined,
        pendingMode: undefined,
        lastHeartbeatAt: new Date().toISOString(),
        roundTripMs: event.roundTripMs,
        activeStreams: 1,
        reconnectAttempt: 0,
        lastErrorCode: undefined,
      };
    case "CONNECTION_DEGRADED":
      return { ...current, state: "degraded", lastErrorCode: event.errorCode };
    case "CONNECTION_LOST":
      return {
        ...current,
        state: "reconnecting",
        activeStreams: 0,
        reconnectAttempt: current.reconnectAttempt + 1,
        lastErrorCode: event.errorCode,
      };
    case "CONNECTION_OFFLINE":
      return {
        ...current,
        state: "offline",
        activeStreams: 0,
        lastErrorCode: event.errorCode,
      };
    case "CONNECTION_FAILED":
      return {
        ...current,
        state: "failed",
        activeProfileId: undefined,
        pendingProfileId: undefined,
        pendingMode: undefined,
        activeStreams: 0,
        lastErrorCode: event.errorCode,
      };
    case "REQUEST_STARTED":
      return { ...current, activeRequests: current.activeRequests + 1 };
    case "REQUEST_FINISHED":
      return { ...current, activeRequests: Math.max(0, current.activeRequests - 1) };
    case "STREAM_OPENED":
      return { ...current, activeStreams: 1 };
    case "STREAM_CLOSED":
      return { ...current, activeStreams: 0 };
  }
}
