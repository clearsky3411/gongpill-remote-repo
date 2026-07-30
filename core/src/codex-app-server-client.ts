import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface GongpilCodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface GongpilCodexStatus {
  provider: "codex";
  configured: boolean;
  authMode?: string;
  planType?: string;
  model: string;
  rateLimits?: Record<string, unknown>;
  accountUsage?: Record<string, unknown>;
  message?: string;
}

export interface GongpilCodexProposal {
  action: "create" | "replace";
  path: string;
  content: string;
  summary: string;
}

export interface GongpilCodexGenerationResponse {
  text: string;
  proposal?: GongpilCodexProposal;
  usage?: GongpilCodexUsage;
  threadId: string;
  turnId?: string;
  dynamicToolsEnabled: boolean;
}

export interface GongpilCodexDynamicToolSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface GongpilCodexDynamicToolCall {
  callId: string;
  threadId: string;
  turnId: string;
  tool: string;
  namespace?: string;
  arguments: unknown;
}

export interface GongpilCodexDynamicToolResult {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

export interface GongpilCodexAppServerOptions {
  executablePath: string;
  executableArgs?: string[];
  codexHome: string;
  workspaceRoot: string;
  model: string;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class GongpilCodexAppServerError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilCodexAppServerError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilCodexAppServerClient {
  public constructor(options: GongpilCodexAppServerOptions) {
    this.options = options;
  }

  public async GetStatus(): Promise<GongpilCodexStatus> {
    try {
      await this.EnsureStarted();
      const [accountResult, rateLimitResult, usageResult] = await Promise.all([
        this.Request("account/read", { refreshToken: false }),
        this.RequestOptional("account/rateLimits/read", {}),
        this.RequestOptional("account/usage/read", {}),
      ]);
      const account = AsRecord(accountResult.account);
      const accountType = typeof account?.type === "string" ? account.type : undefined;
      return {
        provider: "codex",
        configured: accountType !== undefined && accountType !== "unknown",
        authMode: accountType,
        planType: ReadString(account, "planType"),
        model: this.options.model,
        rateLimits: AsRecord(rateLimitResult?.rateLimits),
        accountUsage: usageResult,
        message: accountType === undefined ? "Codex 로그인이 필요합니다." : undefined,
      };
    }
    catch (error) {
      return {
        provider: "codex",
        configured: false,
        model: this.options.model,
        message: error instanceof Error ? error.message : "Codex 상태를 확인하지 못했습니다.",
      };
    }
  }

  public async StartLogin(): Promise<{ loginId?: string; authUrl?: string }> {
    await this.EnsureStarted();
    const result = await this.Request("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    });
    return {
      loginId: ReadString(result, "loginId"),
      authUrl: ReadString(result, "authUrl") ?? ReadString(result, "url"),
    };
  }

  public async Generate(request: {
    instructions: string;
    input: string;
    signal?: AbortSignal;
    dynamicTools?: readonly GongpilCodexDynamicToolSpec[];
    onDynamicToolCall?: (call: GongpilCodexDynamicToolCall) => Promise<GongpilCodexDynamicToolResult>;
  }): Promise<GongpilCodexGenerationResponse> {
    await this.EnsureStarted();
    const threadParams: Record<string, unknown> = {
      model: this.options.model,
      cwd: this.options.workspaceRoot,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "gongpil",
      ephemeral: true,
    };
    if ((request.dynamicTools?.length ?? 0) > 0) {
      threadParams.dynamicTools = request.dynamicTools;
    }
    let dynamicToolsEnabled = (request.dynamicTools?.length ?? 0) > 0;
    let threadResult: Record<string, unknown>;
    try {
      threadResult = await this.Request("thread/start", threadParams);
    }
    catch (error) {
      if (!dynamicToolsEnabled || !IsDynamicToolsUnsupported(error)) {
        throw error;
      }
      delete threadParams.dynamicTools;
      dynamicToolsEnabled = false;
      threadResult = await this.Request("thread/start", threadParams);
    }
    const threadId = ReadString(AsRecord(threadResult.thread), "id");
    if (threadId === undefined) {
      throw new GongpilCodexAppServerError("CODEX_PROTOCOL_INVALID", "Codex thread를 시작하지 못했습니다.");
    }
    if (dynamicToolsEnabled && request.onDynamicToolCall !== undefined) {
      this.dynamicToolHandlers.set(threadId, request.onDynamicToolCall);
    }
    let turnId: string | undefined;
    let completed: { text: string; usage?: GongpilCodexUsage };
    try {
      const turnResult = await this.Request("turn/start", {
        threadId,
        input: [{ type: "text", text: `${request.instructions}\n\n${request.input}` }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
        model: this.options.model,
        effort: "low",
        outputSchema: CreateOutputSchema(),
      });
      turnId = ReadString(AsRecord(turnResult.turn), "id");
      completed = await this.WaitForTurn(threadId, turnId, request.signal);
    }
    finally {
      this.dynamicToolHandlers.delete(threadId);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(completed.text) as Record<string, unknown>;
    }
    catch {
      throw new GongpilCodexAppServerError("CODEX_OUTPUT_INVALID", "Codex 공동 집필 응답 형식이 올바르지 않습니다.");
    }
    return {
      text: ReadString(parsed, "answer") ?? "응답을 만들지 못했습니다.",
      proposal: ParseProposal(parsed.proposal),
      usage: completed.usage,
      threadId,
      turnId,
      dynamicToolsEnabled,
    };
  }

  public async Stop(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.started = undefined;
    this.dynamicToolHandlers.clear();
    if (process === undefined || process.exitCode !== null) {
      return;
    }
    process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        process.kill("SIGKILL");
        resolve();
      }, 2_000);
      timer.unref();
      process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async EnsureStarted(): Promise<void> {
    if (this.started !== undefined) {
      return await this.started;
    }
    this.started = this.Start();
    return await this.started;
  }

  private async Start(): Promise<void> {
    await Promise.all([
      mkdir(this.options.codexHome, { recursive: true }),
      mkdir(this.options.workspaceRoot, { recursive: true }),
    ]);
    const childProcess = spawn(
      this.options.executablePath,
      [...(this.options.executableArgs ?? []), "app-server", "--listen", "stdio://"],
      {
        cwd: this.options.workspaceRoot,
        env: { ...process.env, CODEX_HOME: this.options.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.process = childProcess;
    childProcess.once("error", (error) => this.FailAll(new GongpilCodexAppServerError(
      "CODEX_START_FAILED",
      `Codex App Server를 시작하지 못했습니다: ${error.message}`,
    )));
    childProcess.once("exit", (code) => this.FailAll(new GongpilCodexAppServerError(
      "CODEX_EXITED",
      `Codex App Server가 종료되었습니다. (exit=${code ?? "signal"})`,
    )));
    createInterface({ input: childProcess.stdout, crlfDelay: Infinity }).on("line", (line) => {
      this.HandleLine(line);
    });
    await this.Request("initialize", {
      clientInfo: { name: "gongpil", title: "Gongpil", version: "0.1.1" },
    });
    this.Notify("initialized", {});
  }

  private Request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.Write({ method, id, params });
    });
  }

  private async RequestOptional(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.Request(method, params);
    }
    catch {
      return undefined;
    }
  }

  private Notify(method: string, params: Record<string, unknown>): void {
    this.Write({ method, params });
  }

  private Write(message: Record<string, unknown>): void {
    if (this.process === undefined || !this.process.stdin.writable) {
      throw new GongpilCodexAppServerError("CODEX_NOT_RUNNING", "Codex App Server가 실행 중이 아닙니다.");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private HandleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    }
    catch {
      return;
    }
    const method = ReadString(message, "method");
    const params = AsRecord(message.params) ?? {};
    if (method !== undefined && message.id !== undefined) {
      void this.HandleServerRequest(message.id, method, params).catch(() => undefined);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(message.id);
      const error = AsRecord(message.error);
      if (error !== undefined) {
        pending.reject(new GongpilCodexAppServerError(
          "CODEX_REQUEST_FAILED",
          ReadString(error, "message") ?? "Codex 요청이 실패했습니다.",
        ));
      }
      else {
        pending.resolve(AsRecord(message.result) ?? {});
      }
      return;
    }
    for (const listener of this.notificationListeners) {
      listener(method ?? "", params);
    }
  }

  private async HandleServerRequest(
    id: unknown,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (method !== "item/tool/call") {
      this.Write({ id, error: { code: -32601, message: `지원하지 않는 Codex 서버 요청입니다: ${method}` } });
      return;
    }
    const threadId = ReadString(params, "threadId");
    const turnId = ReadString(params, "turnId");
    const callId = ReadString(params, "callId");
    const tool = ReadString(params, "tool");
    const handler = threadId === undefined ? undefined : this.dynamicToolHandlers.get(threadId);
    if (threadId === undefined || turnId === undefined || callId === undefined || tool === undefined || handler === undefined) {
      this.Write({
        id,
        result: CreateFailedDynamicToolResult("Codex 도구 요청을 현재 공필 작업과 연결하지 못했습니다."),
      });
      return;
    }
    try {
      const result = await handler({
        threadId,
        turnId,
        callId,
        tool,
        namespace: ReadString(params, "namespace"),
        arguments: params.arguments,
      });
      this.Write({ id, result });
    }
    catch (error) {
      this.Write({
        id,
        result: CreateFailedDynamicToolResult(
          error instanceof Error ? error.message : "페어 작가 컨텍스트 도구가 실패했습니다.",
        ),
      });
    }
  }

  private WaitForTurn(
    threadId: string,
    turnId: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; usage?: GongpilCodexUsage }> {
    return new Promise((resolve, reject) => {
      let text = "";
      let usage: GongpilCodexUsage | undefined;
      const listener = (method: string, params: Record<string, unknown>): void => {
        if (ReadString(params, "threadId") !== threadId) {
          return;
        }
        if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
          text += params.delta;
        }
        if (method === "thread/tokenUsage/updated") {
          usage = ParseUsage(params);
        }
        if (method === "turn/completed") {
          const turn = AsRecord(params.turn);
          if (turnId !== undefined && ReadString(turn, "id") !== turnId) {
            return;
          }
          cleanup();
          const status = ReadString(turn, "status");
          if (status !== "completed") {
            reject(new GongpilCodexAppServerError(
              "CODEX_TURN_FAILED",
              ReadString(AsRecord(turn?.error), "message") ?? "Codex 생성이 완료되지 않았습니다.",
            ));
            return;
          }
          resolve({ text, usage });
        }
      };
      const abort = (): void => {
        cleanup();
        void this.Request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
        reject(new GongpilCodexAppServerError("CODEX_REQUEST_CANCELLED", "Codex 요청이 취소되었습니다."));
      };
      const cleanup = (): void => {
        this.notificationListeners.delete(listener);
        signal?.removeEventListener("abort", abort);
      };
      this.notificationListeners.add(listener);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private FailAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.dynamicToolHandlers.clear();
  }

  private readonly options: GongpilCodexAppServerOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<(
    method: string,
    params: Record<string, unknown>,
  ) => void>();
  private readonly dynamicToolHandlers = new Map<
    string,
    (call: GongpilCodexDynamicToolCall) => Promise<GongpilCodexDynamicToolResult>
  >();
  private process?: ChildProcessWithoutNullStreams;
  private started?: Promise<void>;
  private nextRequestId = 1;
}

function CreateFailedDynamicToolResult(message: string): GongpilCodexDynamicToolResult {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: JSON.stringify({ error: message }) }],
  };
}

function IsDynamicToolsUnsupported(error: unknown): boolean {
  if (!(error instanceof GongpilCodexAppServerError) || error.code !== "CODEX_REQUEST_FAILED") {
    return false;
  }
  return /dynamicTools|unknown field|unknown parameter|invalid params/i.test(error.message);
}

function CreateOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      proposal: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", enum: ["create", "replace"] },
              path: { type: "string" },
              content: { type: "string" },
              summary: { type: "string" },
            },
            required: ["action", "path", "content", "summary"],
          },
        ],
      },
    },
    required: ["answer", "proposal"],
  };
}

function ParseProposal(value: unknown): GongpilCodexProposal | undefined {
  const proposal = AsRecord(value);
  const action = ReadString(proposal, "action");
  const path = ReadString(proposal, "path");
  const content = ReadString(proposal, "content");
  const summary = ReadString(proposal, "summary");
  if ((action !== "create" && action !== "replace")
    || path === undefined || content === undefined || summary === undefined) {
    return undefined;
  }
  return { action, path, content, summary };
}

function ParseUsage(params: Record<string, unknown>): GongpilCodexUsage | undefined {
  const threadUsage = AsRecord(params.tokenUsage);
  const usage = AsRecord(threadUsage?.last)
    ?? AsRecord(threadUsage?.total)
    ?? AsRecord(params.usage)
    ?? AsRecord(params.total)
    ?? threadUsage;
  if (usage === undefined) {
    return undefined;
  }
  return {
    inputTokens: ReadNumber(usage, "inputTokens") ?? ReadNumber(usage, "input_tokens") ?? 0,
    cachedInputTokens: ReadNumber(usage, "cachedInputTokens") ?? ReadNumber(usage, "cached_input_tokens") ?? 0,
    outputTokens: ReadNumber(usage, "outputTokens") ?? ReadNumber(usage, "output_tokens") ?? 0,
    reasoningOutputTokens: ReadNumber(usage, "reasoningOutputTokens")
      ?? ReadNumber(usage, "reasoning_output_tokens")
      ?? 0,
  };
}

function AsRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function ReadString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function ReadNumber(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
