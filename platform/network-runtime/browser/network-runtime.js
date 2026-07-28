const GONGPIL_NETWORK_PROTOCOL_VERSION = Object.freeze({ major: 1, minor: 0 });

export class GongpilBrowserNetworkRuntime {
  constructor() {
    this.eventListeners = new Set();
    this.statusListeners = new Set();
  }

  async Send(commandName, payload) {
    const requestId = crypto.randomUUID();
    this.NotifyStatus("connecting");
    try {
      const response = await fetch(
        `/api/v1/commands/${encodeURIComponent(commandName)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
            requestId,
            commandName,
            payload,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error?.userMessage ?? `HTTP ${response.status}`);
      }
      this.NotifyStatus(result.state === "failed" ? "degraded" : "ready");
      return result;
    }
    catch (error) {
      this.NotifyStatus("offline");
      return {
        protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
        requestId,
        state: "failed",
        error: {
          code: "BROWSER_NETWORK_FAILED",
          userMessage: error instanceof Error ? error.message : "Core에 연결하지 못했습니다.",
          retryable: true,
        },
      };
    }
  }

  Subscribe(listener) {
    this.eventListeners.add(listener);
    this.EnsureEventSource();
    return () => this.eventListeners.delete(listener);
  }

  SubscribeStatus(listener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  Disconnect() {
    this.eventSource?.close();
    this.eventSource = undefined;
    this.NotifyStatus("offline");
  }

  EnsureEventSource() {
    if (this.eventSource !== undefined) {
      return;
    }
    const eventSource = new EventSource("/api/v1/events", { withCredentials: true });
    this.eventSource = eventSource;
    eventSource.addEventListener("open", () => this.NotifyStatus("ready"));
    eventSource.addEventListener("error", () => this.NotifyStatus("reconnecting"));
    eventSource.addEventListener("gongpil", (message) => {
      try {
        const event = JSON.parse(message.data);
        for (const listener of this.eventListeners) {
          listener(event);
        }
      }
      catch {
        this.NotifyStatus("degraded");
      }
    });
  }

  NotifyStatus(state) {
    this.status = state;
    for (const listener of this.statusListeners) {
      listener(state);
    }
  }

  eventSource = undefined;
  eventListeners;
  statusListeners;
  status = "starting";
}
