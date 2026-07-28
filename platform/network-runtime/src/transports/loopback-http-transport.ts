import { setTimeout as Wait } from "node:timers/promises";

import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  type GongpilNetworkCommandRequest,
  type GongpilNetworkCommandResult,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkEvent,
  type GongpilNetworkStatus,
  type GongpilNetworkTransport,
  type GongpilTransportStatusSignal,
  type GongpilUnsubscribe,
} from "../contracts.ts";

export interface GongpilLoopbackHttpTransportOptions {
  sessionToken: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export class GongpilLoopbackHttpTransport implements GongpilNetworkTransport {
  public constructor(options: GongpilLoopbackHttpTransportOptions) {
    if (options.sessionToken.length < 16) {
      throw new Error("loopback session token은 16자 이상이어야 합니다.");
    }

    this.sessionToken = options.sessionToken;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 100;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 2_000;
  }

  public async Connect(profile: GongpilNetworkConnectionProfile): Promise<void> {
    if (this.running) {
      throw new Error("loopback transport가 이미 연결 중입니다.");
    }
    if (profile.mode !== "local") {
      throw new Error("loopback transport는 local profile만 지원합니다.");
    }

    const startedAt = performance.now();
    const readyBody = await this.FetchJson(
      `${profile.origin}/api/v1/health/ready`,
      { method: "GET" },
      this.connectTimeoutMs,
    ) as {
      protocolVersion?: { major?: number; minor?: number };
      status?: string;
    };
    if (
      readyBody.status !== "ready"
      || readyBody.protocolVersion?.major !== GONGPIL_NETWORK_PROTOCOL_VERSION.major
    ) {
      throw new Error("LOOPBACK_CORE_NOT_READY");
    }

    this.roundTripMs = Math.max(0, Math.round(performance.now() - startedAt));
    this.profile = profile;
    this.running = true;

    let resolveFirstOpen: () => void;
    let rejectFirstOpen: (error: unknown) => void;
    const firstOpen = new Promise<void>((resolve, reject) => {
      resolveFirstOpen = resolve;
      rejectFirstOpen = reject;
    });
    this.eventLoopPromise = this.RunEventLoop(resolveFirstOpen!, rejectFirstOpen!);

    try {
      await firstOpen;
    }
    catch (error) {
      this.running = false;
      this.eventAbortController?.abort();
      await this.eventLoopPromise;
      this.eventLoopPromise = undefined;
      this.profile = undefined;
      throw error;
    }
  }

  public async Disconnect(): Promise<void> {
    this.running = false;
    this.eventAbortController?.abort();
    if (this.eventLoopPromise !== undefined) {
      await this.eventLoopPromise;
    }
    this.eventLoopPromise = undefined;
    this.eventAbortController = undefined;
    this.profile = undefined;
    this.roundTripMs = undefined;
  }

  public async Send(
    request: GongpilNetworkCommandRequest,
  ): Promise<GongpilNetworkCommandResult> {
    const profile = this.RequireProfile();
    return await this.FetchJson(
      `${profile.origin}${profile.commandBasePath}/${encodeURIComponent(request.commandName)}`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      this.requestTimeoutMs,
    ) as GongpilNetworkCommandResult;
  }

  public async Cancel(requestId: string): Promise<GongpilNetworkCommandResult> {
    const profile = this.RequireProfile();
    return await this.FetchJson(
      `${profile.origin}/api/v1/requests/${encodeURIComponent(requestId)}/cancel`,
      { method: "POST", body: "{}" },
      this.requestTimeoutMs,
    ) as GongpilNetworkCommandResult;
  }

  public Subscribe(listener: (event: GongpilNetworkEvent) => void): GongpilUnsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public SubscribeStatus(
    listener: (signal: GongpilTransportStatusSignal) => void,
  ): GongpilUnsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public GetRoundTripMs(): number | undefined {
    return this.roundTripMs;
  }

  public async ReadHostStatus(): Promise<GongpilNetworkStatus> {
    const profile = this.RequireProfile();
    return await this.FetchJson(
      `${profile.origin}${profile.statusPath}`,
      { method: "GET" },
      this.requestTimeoutMs,
    ) as GongpilNetworkStatus;
  }

  private DispatchEvent(event: GongpilNetworkEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private async FetchJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${this.sessionToken}`,
          "Content-Type": "application/json; charset=utf-8",
          ...init.headers,
        },
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`LOOPBACK_HTTP_${response.status}`);
      }
      return body;
    }
    finally {
      clearTimeout(timeout);
    }
  }

  private async ReadEventStream(onOpen: () => void): Promise<void> {
    const profile = this.RequireProfile();
    const controller = new AbortController();
    this.eventAbortController = controller;
    const connectTimeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${profile.origin}${profile.eventPath}`, {
        method: "GET",
        headers: {
          "Accept": "text/event-stream",
          "Authorization": `Bearer ${this.sessionToken}`,
          ...(this.lastEventId === undefined ? {} : { "Last-Event-ID": this.lastEventId }),
        },
        signal: controller.signal,
      });
    }
    finally {
      clearTimeout(connectTimeout);
    }

    if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new Error(`LOOPBACK_SSE_${response.status}`);
    }
    if (response.body === null) {
      throw new Error("LOOPBACK_SSE_BODY_MISSING");
    }

    onOpen();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (this.running) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let frameEnd = buffer.indexOf("\n\n");
        while (frameEnd >= 0) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          this.ParseEventFrame(frame);
          frameEnd = buffer.indexOf("\n\n");
        }
      }
    }
    finally {
      reader.releaseLock();
    }
  }

  private async RunEventLoop(
    resolveFirstOpen: () => void,
    rejectFirstOpen: (error: unknown) => void,
  ): Promise<void> {
    let hasOpened = false;
    let reconnectDelayMs = this.reconnectInitialDelayMs;

    while (this.running) {
      let openedThisAttempt = false;
      try {
        await this.ReadEventStream(() => {
          openedThisAttempt = true;
          this.streamOpen = true;
          reconnectDelayMs = this.reconnectInitialDelayMs;
          if (!hasOpened) {
            hasOpened = true;
            resolveFirstOpen();
          }
          else {
            this.NotifyStatus({ state: "ready" });
          }
        });
        if (!this.running) {
          break;
        }
        this.streamOpen = false;
        this.NotifyStatus({ state: "lost", errorCode: "SSE_STREAM_CLOSED" });
      }
      catch (error) {
        this.streamOpen = false;
        if (!this.running) {
          break;
        }
        if (!hasOpened && !openedThisAttempt) {
          this.running = false;
          rejectFirstOpen(error);
          return;
        }
        this.NotifyStatus({ state: "lost", errorCode: "SSE_RECONNECT_REQUIRED" });
      }

      if (this.running) {
        await Wait(reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, this.reconnectMaxDelayMs);
      }
    }

    this.streamOpen = false;
    if (!hasOpened) {
      rejectFirstOpen(new Error("LOOPBACK_SSE_STOPPED_BEFORE_OPEN"));
    }
  }

  private ParseEventFrame(frame: string): void {
    if (frame.length === 0 || frame.startsWith(":")) {
      return;
    }

    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("id:")) {
        this.lastEventId = line.slice(3).trimStart();
      }
      else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      return;
    }

    const event = JSON.parse(dataLines.join("\n")) as GongpilNetworkEvent;
    if (
      event.protocolVersion?.major !== GONGPIL_NETWORK_PROTOCOL_VERSION.major
      || typeof event.eventId !== "string"
      || typeof event.eventName !== "string"
      || event.payload === null
      || typeof event.payload !== "object"
    ) {
      throw new Error("LOOPBACK_SSE_EVENT_INVALID");
    }
    this.DispatchEvent(event);
  }

  private NotifyStatus(signal: GongpilTransportStatusSignal): void {
    for (const listener of this.statusListeners) {
      listener(signal);
    }
  }

  private RequireProfile(): GongpilNetworkConnectionProfile {
    if (!this.running || this.profile === undefined) {
      throw new Error("LOOPBACK_NOT_CONNECTED");
    }
    return this.profile;
  }

  private readonly sessionToken: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly eventListeners = new Set<(event: GongpilNetworkEvent) => void>();
  private readonly statusListeners = new Set<(signal: GongpilTransportStatusSignal) => void>();
  private profile: GongpilNetworkConnectionProfile | undefined;
  private eventLoopPromise: Promise<void> | undefined;
  private eventAbortController: AbortController | undefined;
  private running = false;
  private streamOpen = false;
  private roundTripMs: number | undefined;
  private lastEventId: string | undefined;
}
