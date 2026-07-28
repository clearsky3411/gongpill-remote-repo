import { randomUUID } from "node:crypto";
import { setTimeout as Wait } from "node:timers/promises";

import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  type GongpilNetworkCommandRequest,
  type GongpilNetworkCommandResult,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkEvent,
  type GongpilNetworkPayload,
  type GongpilNetworkTransport,
  type GongpilTransportStatusSignal,
  type GongpilUnsubscribe,
} from "../contracts.ts";

export interface GongpilInMemoryTransportOptions {
  latencyMs?: number;
  failConnect?: boolean;
  failCommands?: readonly string[];
}

export class GongpilInMemoryTransport implements GongpilNetworkTransport {
  public constructor(options: GongpilInMemoryTransportOptions = {}) {
    this.latencyMs = options.latencyMs ?? 5;
    this.failConnect = options.failConnect ?? false;
    this.failCommands = new Set(options.failCommands ?? []);
  }

  public async Connect(profile: GongpilNetworkConnectionProfile): Promise<void> {
    await Wait(this.latencyMs);
    if (this.failConnect) {
      throw new Error("IN_MEMORY_CONNECT_FAILED");
    }
    this.activeProfileId = profile.profileId;
    this.connected = true;
  }

  public async Disconnect(): Promise<void> {
    this.connected = false;
    this.activeProfileId = undefined;
  }

  public async Send(
    request: GongpilNetworkCommandRequest,
  ): Promise<GongpilNetworkCommandResult> {
    this.RequireConnected();
    await Wait(this.latencyMs);

    if (this.failCommands.has(request.commandName)) {
      throw new Error("IN_MEMORY_COMMAND_FAILED");
    }

    return {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      requestId: request.requestId,
      state: "succeeded",
      payload: {
        commandName: request.commandName,
        received: request.payload,
        activeProfileId: this.activeProfileId,
      },
    };
  }

  public async Cancel(requestId: string): Promise<GongpilNetworkCommandResult> {
    this.RequireConnected();
    return {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      requestId,
      state: "cancelled",
    };
  }

  public Subscribe(listener: (event: GongpilNetworkEvent) => void): GongpilUnsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public SubscribeStatus(
    listener: (signal: GongpilTransportStatusSignal) => void,
  ): GongpilUnsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public GetRoundTripMs(): number | undefined {
    return this.connected ? this.latencyMs * 2 : undefined;
  }

  public Publish(
    eventName: string,
    payload: GongpilNetworkPayload,
    requestId?: string,
  ): void {
    this.RequireConnected();
    const event: GongpilNetworkEvent = {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      eventId: randomUUID(),
      eventName,
      occurredAt: new Date().toISOString(),
      requestId,
      payload,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public PublishStatus(signal: GongpilTransportStatusSignal): void {
    this.RequireConnected();
    for (const listener of this.statusListeners) {
      listener(signal);
    }
  }

  public IsConnected(): boolean {
    return this.connected;
  }

  private RequireConnected(): void {
    if (!this.connected) {
      throw new Error("IN_MEMORY_NOT_CONNECTED");
    }
  }

  private readonly latencyMs: number;
  private readonly failConnect: boolean;
  private readonly failCommands: ReadonlySet<string>;
  private readonly listeners = new Set<(event: GongpilNetworkEvent) => void>();
  private readonly statusListeners = new Set<(signal: GongpilTransportStatusSignal) => void>();
  private connected = false;
  private activeProfileId: string | undefined;
}
