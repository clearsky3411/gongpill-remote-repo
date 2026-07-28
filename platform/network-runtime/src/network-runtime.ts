import { randomUUID } from "node:crypto";

import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  GONGPIL_NETWORK_ROUTES,
  type GongpilNetworkCommandResult,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkEvent,
  type GongpilNetworkPayload,
  type GongpilNetworkStatus,
  type GongpilNetworkTransport,
  type GongpilNetworkTransportFactory,
  type GongpilTransportStatusSignal,
  type GongpilUnsubscribe,
} from "./contracts.ts";
import {
  CreateInitialNetworkStatus,
  ReduceNetworkStatus,
  type GongpilNetworkStatusEvent,
} from "./network-status-machine.ts";

export class GongpilNetworkRuntimeError extends Error {
  public constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GongpilNetworkRuntimeError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilNetworkRuntime {
  public constructor(transportFactory: GongpilNetworkTransportFactory) {
    this.transportFactory = transportFactory;
  }

  public async ReplaceConnection(
    profile: GongpilNetworkConnectionProfile,
  ): Promise<GongpilNetworkStatus> {
    this.ValidateProfile(profile);

    const previousTransport = this.activeTransport;
    const previousTransportUnsubscribe = this.activeTransportUnsubscribe;
    const previousStatus = this.GetStatus();
    const candidateTransport = this.transportFactory(profile);
    let candidateUnsubscribe: GongpilUnsubscribe | undefined;

    this.ApplyStatus({
      type: "CONNECT_REQUESTED",
      profileId: profile.profileId,
      mode: profile.mode,
    });

    try {
      await candidateTransport.Connect(profile);
      const eventUnsubscribe = candidateTransport.Subscribe((event) => this.DispatchEvent(event));
      const statusUnsubscribe = candidateTransport.SubscribeStatus((signal) => {
        this.HandleTransportStatus(candidateTransport, profile, signal);
      });
      candidateUnsubscribe = () => {
        eventUnsubscribe();
        statusUnsubscribe();
      };

      this.activeTransport = candidateTransport;
      this.activeTransportUnsubscribe = candidateUnsubscribe;
      this.ApplyStatus({
        type: "CONNECTION_READY",
        activeProfileId: profile.profileId,
        mode: profile.mode,
        roundTripMs: candidateTransport.GetRoundTripMs(),
      });

      if (previousTransportUnsubscribe !== undefined) {
        previousTransportUnsubscribe();
      }
      if (previousTransport !== undefined) {
        try {
          await previousTransport.Disconnect();
        }
        catch (error) {
          this.ApplyStatus({
            type: "CONNECTION_DEGRADED",
            errorCode: "PREVIOUS_CONNECTION_DISCONNECT_FAILED",
          });
        }
      }

      return this.GetStatus();
    }
    catch (error) {
      if (candidateUnsubscribe !== undefined) {
        candidateUnsubscribe();
      }
      try {
        await candidateTransport.Disconnect();
      }
      catch {
        // 후보 정리 실패가 기존 접속 보존 결과를 덮어쓰지 않는다.
      }

      const runtimeError = this.NormalizeError(
        error,
        "CONNECTION_REPLACEMENT_FAILED",
        "새 접속을 활성화하지 못했습니다.",
      );

      if (previousTransport !== undefined) {
        this.status = {
          ...previousStatus,
          lastErrorCode: runtimeError.code,
        };
        this.NotifyStatus();
      }
      else {
        this.ApplyStatus({ type: "CONNECTION_FAILED", errorCode: runtimeError.code });
      }

      throw runtimeError;
    }
  }

  public async Send(
    commandName: string,
    payload: GongpilNetworkPayload,
  ): Promise<GongpilNetworkCommandResult> {
    const requestId = randomUUID();

    this.ApplyStatus({ type: "REQUEST_STARTED" });
    try {
      return await this.RequireActiveTransport().Send({
        protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
        requestId,
        commandName,
        payload,
      });
    }
    catch (error) {
      const runtimeError = this.NormalizeError(
        error,
        "COMMAND_SEND_FAILED",
        "명령을 보내지 못했습니다.",
      );
      return {
        protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
        requestId,
        state: "failed",
        error: {
          code: runtimeError.code,
          userMessage: runtimeError.message,
          retryable: true,
        },
      };
    }
    finally {
      this.ApplyStatus({ type: "REQUEST_FINISHED" });
    }
  }

  public Subscribe(listener: (event: GongpilNetworkEvent) => void): GongpilUnsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public async Cancel(requestId: string): Promise<GongpilNetworkCommandResult> {
    this.ApplyStatus({ type: "REQUEST_STARTED" });
    try {
      return await this.RequireActiveTransport().Cancel(requestId);
    }
    catch (error) {
      const runtimeError = this.NormalizeError(
        error,
        "CANCEL_REQUEST_FAILED",
        "요청을 취소하지 못했습니다.",
      );
      return {
        protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
        requestId,
        state: "failed",
        error: {
          code: runtimeError.code,
          userMessage: runtimeError.message,
          retryable: true,
        },
      };
    }
    finally {
      this.ApplyStatus({ type: "REQUEST_FINISHED" });
    }
  }

  public GetStatus(): GongpilNetworkStatus {
    return {
      ...this.status,
      protocolVersion: { ...this.status.protocolVersion },
    };
  }

  public SubscribeStatus(
    listener: (status: GongpilNetworkStatus) => void,
  ): GongpilUnsubscribe {
    this.statusListeners.add(listener);
    listener(this.GetStatus());
    return () => this.statusListeners.delete(listener);
  }

  public async Disconnect(): Promise<void> {
    const transport = this.activeTransport;
    const transportUnsubscribe = this.activeTransportUnsubscribe;

    this.activeTransport = undefined;
    this.activeTransportUnsubscribe = undefined;
    if (transportUnsubscribe !== undefined) {
      transportUnsubscribe();
    }
    if (transport !== undefined) {
      await transport.Disconnect();
    }

    this.status = {
      ...this.status,
      state: "offline",
      activeProfileId: undefined,
      pendingProfileId: undefined,
      pendingMode: undefined,
      roundTripMs: undefined,
      lastHeartbeatAt: undefined,
      activeStreams: 0,
      activeRequests: 0,
      reconnectAttempt: 0,
      lastErrorCode: undefined,
    };
    this.NotifyStatus();
  }

  private ApplyStatus(event: GongpilNetworkStatusEvent): void {
    this.status = ReduceNetworkStatus(this.status, event);
    this.NotifyStatus();
  }

  private DispatchEvent(event: GongpilNetworkEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private HandleTransportStatus(
    transport: GongpilNetworkTransport,
    profile: GongpilNetworkConnectionProfile,
    signal: GongpilTransportStatusSignal,
  ): void {
    if (transport !== this.activeTransport) {
      return;
    }

    switch (signal.state) {
      case "ready":
        this.ApplyStatus({
          type: "CONNECTION_READY",
          activeProfileId: profile.profileId,
          mode: profile.mode,
          roundTripMs: transport.GetRoundTripMs(),
        });
        break;
      case "degraded":
        this.ApplyStatus({
          type: "CONNECTION_DEGRADED",
          errorCode: signal.errorCode,
        });
        break;
      case "lost":
        this.ApplyStatus({
          type: "CONNECTION_LOST",
          errorCode: signal.errorCode,
        });
        break;
      case "offline":
        this.ApplyStatus({
          type: "CONNECTION_OFFLINE",
          errorCode: signal.errorCode,
        });
        break;
    }
  }

  private NormalizeError(
    error: unknown,
    fallbackCode: string,
    fallbackMessage: string,
  ): GongpilNetworkRuntimeError {
    if (error instanceof GongpilNetworkRuntimeError) {
      return error;
    }
    return new GongpilNetworkRuntimeError(fallbackCode, fallbackMessage, error);
  }

  private NotifyStatus(): void {
    const status = this.GetStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private RequireActiveTransport(): GongpilNetworkTransport {
    if (this.activeTransport === undefined) {
      throw new GongpilNetworkRuntimeError(
        "NETWORK_NOT_CONNECTED",
        "활성 네트워크 접속이 없습니다.",
      );
    }
    return this.activeTransport;
  }

  private ValidateProfile(profile: GongpilNetworkConnectionProfile): void {
    if (profile.protocolVersion.major !== GONGPIL_NETWORK_PROTOCOL_VERSION.major) {
      throw new GongpilNetworkRuntimeError(
        "NETWORK_PROTOCOL_INCOMPATIBLE",
        "지원하지 않는 네트워크 프로토콜입니다.",
      );
    }
    if (
      profile.commandBasePath !== GONGPIL_NETWORK_ROUTES.commandBasePath
      || profile.eventPath !== GONGPIL_NETWORK_ROUTES.eventPath
      || profile.statusPath !== GONGPIL_NETWORK_ROUTES.statusPath
    ) {
      throw new GongpilNetworkRuntimeError(
        "NETWORK_ROUTE_INVALID",
        "고정된 공필 네트워크 route와 일치하지 않습니다.",
      );
    }

    let origin: URL;
    try {
      origin = new URL(profile.origin);
    }
    catch {
      throw new GongpilNetworkRuntimeError(
        "NETWORK_PROFILE_INVALID",
        "접속 주소가 올바른 URL이 아닙니다.",
      );
    }

    const hasOnlyOrigin = origin.origin === profile.origin
      && origin.username.length === 0
      && origin.password.length === 0;
    const localPort = Number(origin.port);
    const isLocalProfileValid = profile.mode === "local"
      && hasOnlyOrigin
      && origin.protocol === "http:"
      && origin.hostname === "127.0.0.1"
      && Number.isInteger(localPort)
      && localPort >= 1
      && localPort <= 65535
      && profile.authMode === "loopback-session";
    const isCloudProfileValid = profile.mode === "cloud"
      && hasOnlyOrigin
      && origin.protocol === "https:"
      && profile.authMode === "secure-cookie";

    if (!isLocalProfileValid && !isCloudProfileValid) {
      throw new GongpilNetworkRuntimeError(
        "NETWORK_PROFILE_INVALID",
        "접속 모드와 주소 또는 인증 방식이 일치하지 않습니다.",
      );
    }
  }

  private readonly transportFactory: GongpilNetworkTransportFactory;
  private readonly eventListeners = new Set<(event: GongpilNetworkEvent) => void>();
  private readonly statusListeners = new Set<(status: GongpilNetworkStatus) => void>();
  private status: GongpilNetworkStatus = CreateInitialNetworkStatus();
  private activeTransport: GongpilNetworkTransport | undefined;
  private activeTransportUnsubscribe: GongpilUnsubscribe | undefined;
}
