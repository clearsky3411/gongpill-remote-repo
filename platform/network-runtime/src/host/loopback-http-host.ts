import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, relative, resolve } from "node:path";

import {
  GONGPIL_NETWORK_PROTOCOL_VERSION,
  GONGPIL_NETWORK_ROUTES,
  type GongpilNetworkCommandRequest,
  type GongpilNetworkCommandResult,
  type GongpilNetworkConnectionProfile,
  type GongpilNetworkEvent,
  type GongpilNetworkPayload,
  type GongpilNetworkStatus,
} from "../contracts.ts";

export interface GongpilLoopbackCommandContext {
  requestId: string;
  signal: AbortSignal;
}

export type GongpilLoopbackCommandHandler = (
  payload: GongpilNetworkPayload,
  context: GongpilLoopbackCommandContext,
) => GongpilNetworkPayload | Promise<GongpilNetworkPayload>;

export class GongpilLoopbackCommandError extends Error {
  public constructor(code: string, userMessage: string, retryable = false) {
    super(userMessage);
    this.name = "GongpilLoopbackCommandError";
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = retryable;
  }

  public readonly code: string;
  public readonly userMessage: string;
  public readonly retryable: boolean;
}

export interface GongpilLoopbackHttpHostOptions {
  profileId: string;
  sessionToken: string;
  coreVersion?: string;
  coreApiVersion?: string;
  ready?: boolean;
  browserAssetsRoot?: string;
  browserNetworkRuntimePath?: string;
}

export class GongpilLoopbackHttpHost {
  public constructor(options: GongpilLoopbackHttpHostOptions) {
    if (options.sessionToken.length < 16) {
      throw new Error("loopback session token은 16자 이상이어야 합니다.");
    }

    this.profileId = options.profileId;
    this.sessionToken = options.sessionToken;
    this.coreVersion = options.coreVersion ?? "0.1.0";
    this.coreApiVersion = options.coreApiVersion ?? "1.0.0";
    this.ready = options.ready ?? true;
    this.browserAssetsRoot = options.browserAssetsRoot === undefined
      ? undefined
      : resolve(options.browserAssetsRoot);
    this.browserNetworkRuntimePath = options.browserNetworkRuntimePath === undefined
      ? undefined
      : resolve(options.browserNetworkRuntimePath);
  }

  public async Start(): Promise<GongpilNetworkConnectionProfile> {
    if (this.server !== undefined) {
      throw new Error("loopback host가 이미 시작됐습니다.");
    }

    const server = createServer((request, response) => {
      void this.HandleRequest(request, response);
    });
    this.server = server;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (address === null || typeof address === "string") {
      await this.Stop();
      throw new Error("loopback host의 동적 포트를 확인하지 못했습니다.");
    }

    this.origin = `http://127.0.0.1:${address.port}`;
    return {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      profileId: this.profileId,
      mode: "local",
      origin: this.origin,
      ...GONGPIL_NETWORK_ROUTES,
      authMode: "loopback-session",
    };
  }

  public async Stop(): Promise<void> {
    this.CloseEventStream();
    for (const controller of this.activeRequestControllers.values()) {
      controller.abort();
    }
    this.activeRequestControllers.clear();
    this.browserLaunchTokens.clear();

    const server = this.server;
    this.server = undefined;
    this.origin = undefined;
    if (server === undefined) {
      return;
    }

    const closePromise = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closePromise;
  }

  public RegisterCommand(commandName: string, handler: GongpilLoopbackCommandHandler): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(commandName)) {
      throw new Error(`올바르지 않은 command 이름: ${commandName}`);
    }
    this.commandHandlers.set(commandName, handler);
  }

  public CreateBrowserLaunchPath(): string {
    const launchToken = randomBytes(32).toString("base64url");
    this.browserLaunchTokens.add(launchToken);
    while (this.browserLaunchTokens.size > 16) {
      const oldestToken = this.browserLaunchTokens.values().next().value;
      if (oldestToken === undefined) {
        break;
      }
      this.browserLaunchTokens.delete(oldestToken);
    }
    return `/launch/${launchToken}`;
  }

  public Publish(
    eventName: string,
    payload: GongpilNetworkPayload,
    requestId?: string,
  ): GongpilNetworkEvent {
    const event: GongpilNetworkEvent = {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      eventId: randomUUID(),
      eventName,
      occurredAt: new Date().toISOString(),
      requestId,
      payload,
    };

    if (this.eventStreamResponse !== undefined && !this.eventStreamResponse.destroyed) {
      this.eventStreamResponse.write(this.FormatEvent(event));
    }
    return event;
  }

  public DropEventStream(): void {
    this.CloseEventStream();
  }

  public SetReady(ready: boolean): void {
    this.ready = ready;
  }

  public GetNetworkStatus(): GongpilNetworkStatus {
    return {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      mode: "local",
      state: this.ready ? "ready" : "degraded",
      commandChannel: "http-json",
      eventChannel: "sse",
      security: "loopback-session",
      activeProfileId: this.profileId,
      coreVersion: this.coreVersion,
      coreApiVersion: this.coreApiVersion,
      lastHeartbeatAt: new Date().toISOString(),
      activeRequests: this.activeRequestControllers.size,
      activeStreams: this.GetActiveSseConnectionCount(),
      reconnectAttempt: 0,
    };
  }

  public GetActiveSseConnectionCount(): number {
    return this.eventStreamResponse === undefined ? 0 : 1;
  }

  public GetMaxSseConnectionCount(): number {
    return this.maxSseConnectionCount;
  }

  public GetSseConnectionOpenCount(): number {
    return this.sseConnectionOpenCount;
  }

  private async HandleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && this.TryHandleBrowserLaunch(requestUrl, response)) {
        return;
      }

      if (!this.IsAuthorized(request)) {
        this.WriteJson(response, 401, {
          error: {
            code: "SESSION_AUTH_FAILED",
            userMessage: "loopback session 인증에 실패했습니다.",
            retryable: false,
          },
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/v1/health/live") {
        this.WriteJson(response, 200, { status: "alive" });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/health/ready") {
        this.WriteJson(response, this.ready ? 200 : 503, {
          protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
          status: this.ready ? "ready" : "degraded",
          coreVersion: this.coreVersion,
          coreApiVersion: this.coreApiVersion,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === GONGPIL_NETWORK_ROUTES.statusPath) {
        this.WriteJson(response, 200, this.GetNetworkStatus());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === GONGPIL_NETWORK_ROUTES.eventPath) {
        this.OpenEventStream(request, response);
        return;
      }

      const commandPrefix = `${GONGPIL_NETWORK_ROUTES.commandBasePath}/`;
      if (request.method === "POST" && requestUrl.pathname.startsWith(commandPrefix)) {
        const commandName = decodeURIComponent(requestUrl.pathname.slice(commandPrefix.length));
        await this.HandleCommand(commandName, request, response);
        return;
      }

      const cancelMatch = /^\/api\/v1\/requests\/([^/]+)\/cancel$/.exec(requestUrl.pathname);
      if (request.method === "POST" && cancelMatch !== null) {
        this.HandleCancel(decodeURIComponent(cancelMatch[1]), response);
        return;
      }

      if (
        request.method === "GET"
        && this.browserAssetsRoot !== undefined
        && !requestUrl.pathname.startsWith("/api/")
      ) {
        await this.ServeBrowserAsset(requestUrl.pathname, response);
        return;
      }

      this.WriteJson(response, 404, {
        error: {
          code: "NETWORK_ROUTE_NOT_FOUND",
          userMessage: "요청한 네트워크 route가 없습니다.",
          retryable: false,
        },
      });
    }
    catch (error) {
      this.WriteJson(response, 500, {
        error: {
          code: "NETWORK_HOST_ERROR",
          userMessage: "loopback host가 요청을 처리하지 못했습니다.",
          retryable: true,
        },
      });
    }
  }

  private async HandleCommand(
    commandName: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const commandRequest = await this.ReadJsonBody(request) as GongpilNetworkCommandRequest;
    const handler = this.commandHandlers.get(commandName);
    if (handler === undefined || commandRequest.commandName !== commandName) {
      this.WriteJson(response, 404, this.CreateFailedResult(
        commandRequest.requestId ?? randomUUID(),
        "COMMAND_NOT_FOUND",
        "등록되지 않은 명령입니다.",
        false,
      ));
      return;
    }

    const controller = new AbortController();
    this.activeRequestControllers.set(commandRequest.requestId, controller);
    try {
      const payload = await handler(commandRequest.payload, {
        requestId: commandRequest.requestId,
        signal: controller.signal,
      });
      const result: GongpilNetworkCommandResult = {
        protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
        requestId: commandRequest.requestId,
        state: controller.signal.aborted ? "cancelled" : "succeeded",
        payload: controller.signal.aborted ? undefined : payload,
      };
      this.WriteJson(response, 200, result);
    }
    catch (error) {
      const result = controller.signal.aborted
        ? {
            protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
            requestId: commandRequest.requestId,
            state: "cancelled",
          }
        : error instanceof GongpilLoopbackCommandError
          ? this.CreateFailedResult(
              commandRequest.requestId,
              error.code,
              error.userMessage,
              error.retryable,
            )
          : this.CreateFailedResult(
              commandRequest.requestId,
              "COMMAND_HANDLER_FAILED",
              "명령 처리에 실패했습니다.",
              false,
            );
      this.WriteJson(response, 200, result);
    }
    finally {
      this.activeRequestControllers.delete(commandRequest.requestId);
    }
  }

  private HandleCancel(requestId: string, response: ServerResponse): void {
    const controller = this.activeRequestControllers.get(requestId);
    if (controller === undefined) {
      this.WriteJson(response, 200, this.CreateFailedResult(
        requestId,
        "REQUEST_NOT_ACTIVE",
        "진행 중인 요청이 없습니다.",
        false,
      ));
      return;
    }

    controller.abort();
    const result: GongpilNetworkCommandResult = {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      requestId,
      state: "cancelled",
    };
    this.WriteJson(response, 200, result);
  }

  private OpenEventStream(request: IncomingMessage, response: ServerResponse): void {
    this.CloseEventStream();

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write(": gongpil-stream-ready\n\n");

    this.eventStreamResponse = response;
    this.sseConnectionOpenCount += 1;
    this.maxSseConnectionCount = Math.max(this.maxSseConnectionCount, 1);
    this.WriteBrowserHeartbeat(response);
    this.heartbeatTimer = setInterval(() => {
      if (!response.destroyed) {
        this.WriteBrowserHeartbeat(response);
      }
    }, 10_000);
    this.heartbeatTimer.unref();

    request.once("close", () => {
      if (this.eventStreamResponse === response) {
        this.ClearEventStreamReference();
      }
    });
  }

  private CloseEventStream(): void {
    const response = this.eventStreamResponse;
    this.ClearEventStreamReference();
    if (response !== undefined && !response.destroyed) {
      response.end();
    }
  }

  private ClearEventStreamReference(): void {
    this.eventStreamResponse = undefined;
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private CreateFailedResult(
    requestId: string,
    code: string,
    userMessage: string,
    retryable: boolean,
  ): GongpilNetworkCommandResult {
    return {
      protocolVersion: GONGPIL_NETWORK_PROTOCOL_VERSION,
      requestId,
      state: "failed",
      error: { code, userMessage, retryable },
    };
  }

  private FormatEvent(event: GongpilNetworkEvent): string {
    return `id: ${event.eventId}\nevent: gongpil\ndata: ${JSON.stringify(event)}\n\n`;
  }

  private WriteBrowserHeartbeat(response: ServerResponse): void {
    response.write(`event: gongpil-heartbeat\ndata: ${JSON.stringify({
      heartbeatId: randomUUID(),
      sentAt: new Date().toISOString(),
    })}\n\n`);
  }

  private IsAuthorized(request: IncomingMessage): boolean {
    const actual = Buffer.from(request.headers.authorization ?? "", "utf8");
    const expected = Buffer.from(`Bearer ${this.sessionToken}`, "utf8");
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return true;
    }

    const expectedCookie = `gongpil_session=${encodeURIComponent(this.sessionToken)}`;
    return (request.headers.cookie ?? "")
      .split(";")
      .some((cookie) => cookie.trim() === expectedCookie);
  }

  private async ServeBrowserAsset(pathname: string, response: ServerResponse): Promise<void> {
    const assetsRoot = this.browserAssetsRoot;
    if (assetsRoot === undefined) {
      this.WriteJson(response, 404, { error: { code: "UI_NOT_AVAILABLE" } });
      return;
    }

    const logicalPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    const assetPath = logicalPath === "network-runtime.js" && this.browserNetworkRuntimePath !== undefined
      ? this.browserNetworkRuntimePath
      : resolve(assetsRoot, logicalPath);
    const relativePath = relative(assetsRoot, assetPath);
    const isNetworkRuntime = assetPath === this.browserNetworkRuntimePath;
    if (
      !isNetworkRuntime
      && (relativePath.startsWith("..") || relativePath.length === 0 && logicalPath !== "index.html")
    ) {
      this.WriteJson(response, 404, { error: { code: "UI_ASSET_NOT_FOUND" } });
      return;
    }

    try {
      const content = await readFile(assetPath);
      response.writeHead(200, {
        "Content-Type": this.GetAssetContentType(assetPath),
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      });
      response.end(content);
    }
    catch {
      this.WriteJson(response, 404, { error: { code: "UI_ASSET_NOT_FOUND" } });
    }
  }

  private TryHandleBrowserLaunch(requestUrl: URL, response: ServerResponse): boolean {
    const launchMatch = /^\/launch\/([A-Za-z0-9_-]{20,128})$/.exec(requestUrl.pathname);
    if (launchMatch === null) {
      return false;
    }

    const launchToken = launchMatch[1];
    if (!this.browserLaunchTokens.delete(launchToken)) {
      this.WriteJson(response, 401, {
        error: {
          code: "BROWSER_LAUNCH_EXPIRED",
          userMessage: "Browser 시작 링크가 만료됐습니다.",
          retryable: false,
        },
      });
      return true;
    }

    response.writeHead(303, {
      "Location": "/",
      "Set-Cookie": `gongpil_session=${encodeURIComponent(this.sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    response.end();
    return true;
  }

  private GetAssetContentType(assetPath: string): string {
    switch (extname(assetPath).toLowerCase()) {
      case ".html": return "text/html; charset=utf-8";
      case ".css": return "text/css; charset=utf-8";
      case ".js": return "text/javascript; charset=utf-8";
      case ".json": return "application/json; charset=utf-8";
      case ".svg": return "image/svg+xml";
      case ".png": return "image/png";
      default: return "application/octet-stream";
    }
  }

  private async ReadJsonBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > 1_048_576) {
        throw new Error("NETWORK_BODY_TOO_LARGE");
      }
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  private WriteJson(response: ServerResponse, statusCode: number, body: unknown): void {
    if (response.headersSent || response.destroyed) {
      return;
    }
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  }

  private readonly profileId: string;
  private readonly sessionToken: string;
  private readonly coreVersion: string;
  private readonly coreApiVersion: string;
  private readonly browserAssetsRoot: string | undefined;
  private readonly browserNetworkRuntimePath: string | undefined;
  private readonly commandHandlers = new Map<string, GongpilLoopbackCommandHandler>();
  private readonly activeRequestControllers = new Map<string, AbortController>();
  private readonly browserLaunchTokens = new Set<string>();
  private server: Server | undefined;
  private origin: string | undefined;
  private eventStreamResponse: ServerResponse | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private ready: boolean;
  private maxSseConnectionCount = 0;
  private sseConnectionOpenCount = 0;
}
