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
  }): Promise<GongpilCodexGenerationResponse> {
    await this.EnsureStarted();
    const threadResult = await this.Request("thread/start", {
      model: this.options.model,
      cwd: this.options.workspaceRoot,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "gongpil",
      ephemeral: true,
    });
    const threadId = ReadString(AsRecord(threadResult.thread), "id");
    if (threadId === undefined) {
      throw new GongpilCodexAppServerError("CODEX_PROTOCOL_INVALID", "Codex thread를 시작하지 못했습니다.");
    }
    const turnResult = await this.Request("turn/start", {
      threadId,
      input: [{ type: "text", text: `${request.instructions}\n\n${request.input}` }],
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      model: this.options.model,
      effort: "low",
      outputSchema: CreateOutputSchema(),
    });
    const turnId = ReadString(AsRecord(turnResult.turn), "id");
    const completed = await this.WaitForTurn(threadId, turnId, request.signal);
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
    };
  }

  public async Stop(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.started = undefined;
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
      clientInfo: { name: "gongpil", title: "Gongpil", version: "0.1.0" },
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
    const method = ReadString(message, "method");
    const params = AsRecord(message.params) ?? {};
    for (const listener of this.notificationListeners) {
      listener(method ?? "", params);
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
  }

  private readonly options: GongpilCodexAppServerOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<(
    method: string,
    params: Record<string, unknown>,
  ) => void>();
  private process?: ChildProcessWithoutNullStreams;
  private started?: Promise<void>;
  private nextRequestId = 1;
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
