export interface GongpilBrowserPresenceMonitorOptions {
  onExpired: () => void;
  leaseTimeoutMs?: number;
  startupGraceMs?: number;
  resumeDelayToleranceMs?: number;
}

export class GongpilBrowserPresenceMonitor {
  public constructor(options: GongpilBrowserPresenceMonitorOptions) {
    this.onExpired = options.onExpired;
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 30_000;
    this.startupGraceMs = options.startupGraceMs ?? 60_000;
    this.resumeDelayToleranceMs = options.resumeDelayToleranceMs ?? 5_000;
    if (this.leaseTimeoutMs < 1 || this.startupGraceMs < 1 || this.resumeDelayToleranceMs < 0) {
      throw new Error("Browser presence 시간 설정이 올바르지 않습니다.");
    }
  }

  public Start(): void {
    if (this.state === "stopped") {
      return;
    }
    this.state = "waiting";
    this.lastHeartbeatId = undefined;
    this.ScheduleExpiry(this.startupGraceMs);
  }

  public Acknowledge(heartbeatId: string): { accepted: true } {
    if (this.state === "stopped") {
      return { accepted: true };
    }
    this.state = "active";
    this.lastHeartbeatId = heartbeatId;
    this.ScheduleExpiry(this.leaseTimeoutMs);
    return { accepted: true };
  }

  public Stop(): void {
    this.state = "stopped";
    this.ClearTimer();
  }

  public GetState(): "idle" | "waiting" | "active" | "expired" | "stopped" {
    return this.state;
  }

  public GetLastHeartbeatId(): string | undefined {
    return this.lastHeartbeatId;
  }

  private ScheduleExpiry(delayMs: number): void {
    this.ClearTimer();
    const expectedAt = Date.now() + delayMs;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      if (this.state === "idle" || this.state === "stopped" || this.state === "expired") {
        return;
      }
      if (Date.now() - expectedAt > this.resumeDelayToleranceMs) {
        this.ScheduleExpiry(this.leaseTimeoutMs);
        return;
      }
      this.state = "expired";
      this.onExpired();
    }, delayMs);
    this.expiryTimer.unref();
  }

  private ClearTimer(): void {
    if (this.expiryTimer !== undefined) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  private readonly onExpired: () => void;
  private readonly leaseTimeoutMs: number;
  private readonly startupGraceMs: number;
  private readonly resumeDelayToleranceMs: number;
  private expiryTimer: NodeJS.Timeout | undefined;
  private lastHeartbeatId: string | undefined;
  private state: "idle" | "waiting" | "active" | "expired" | "stopped" = "idle";
}
