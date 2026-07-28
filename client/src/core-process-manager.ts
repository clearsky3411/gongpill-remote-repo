import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  ParseCoreReadyInfo,
  type GongpilClientBootstrapConfig,
  type GongpilCoreReadyInfo,
} from "../../packages/contracts/bootstrap/contracts.ts";

const LOOPBACK_SESSION_TOKEN_ENV = "GONGPIL_LOOPBACK_SESSION_TOKEN";
const MAX_READY_LINE_BYTES = 1024 * 1024;

export interface GongpilCoreProcessManagerOptions {
  coreEntryPath: string;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  coreEnvironment?: NodeJS.ProcessEnv;
}

export class GongpilCoreProcessError extends Error {
  public constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GongpilCoreProcessError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilManagedCoreProcess {
  public constructor(
    childProcess: ChildProcessWithoutNullStreams,
    readyInfo: GongpilCoreReadyInfo,
    stopTimeoutMs: number,
  ) {
    this.childProcess = childProcess;
    this.readyInfo = readyInfo;
    this.stopTimeoutMs = stopTimeoutMs;
  }

  public async Stop(): Promise<void> {
    if (!this.IsRunning()) {
      return;
    }

    this.childProcess.kill("SIGTERM");
    if (await this.WaitForExitWithin(this.stopTimeoutMs)) {
      return;
    }

    this.childProcess.kill("SIGKILL");
    if (!await this.WaitForExitWithin(this.stopTimeoutMs)) {
      throw new GongpilCoreProcessError(
        "CORE_STOP_FAILED",
        "Core 프로세스를 종료하지 못했습니다.",
      );
    }
  }

  public IsRunning(): boolean {
    return this.childProcess.exitCode === null && this.childProcess.signalCode === null;
  }

  public GetProcessId(): number {
    if (this.childProcess.pid === undefined) {
      throw new GongpilCoreProcessError("CORE_PID_MISSING", "Core process ID가 없습니다.");
    }
    return this.childProcess.pid;
  }

  public GetReadyInfo(): GongpilCoreReadyInfo {
    return {
      ...this.readyInfo,
      protocolVersion: { ...this.readyInfo.protocolVersion },
      networkProfile: {
        ...this.readyInfo.networkProfile,
        protocolVersion: { ...this.readyInfo.networkProfile.protocolVersion },
      },
      capabilities: [...this.readyInfo.capabilities],
    };
  }

  public WaitForExit(): Promise<void> {
    if (!this.IsRunning()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.childProcess.once("exit", () => resolve()));
  }

  private WaitForExitWithin(timeoutMs: number): Promise<boolean> {
    if (!this.IsRunning()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const onExit = (): void => {
        cleanup();
        resolve(true);
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.childProcess.off("exit", onExit);
      };
      this.childProcess.once("exit", onExit);
    });
  }

  private readonly childProcess: ChildProcessWithoutNullStreams;
  private readonly readyInfo: GongpilCoreReadyInfo;
  private readonly stopTimeoutMs: number;
}

export class GongpilCoreProcessManager {
  public constructor(options: GongpilCoreProcessManagerOptions) {
    this.coreEntryPath = options.coreEntryPath;
    this.startTimeoutMs = options.startTimeoutMs ?? 5_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
    this.coreEnvironment = options.coreEnvironment ?? {};
  }

  public async StartCore(
    config: GongpilClientBootstrapConfig,
    sessionToken: string,
  ): Promise<GongpilManagedCoreProcess> {
    if (sessionToken.length < 16) {
      throw new GongpilCoreProcessError(
        "SESSION_AUTH_FAILED",
        "Core 세션 인증정보가 올바르지 않습니다.",
      );
    }

    const childProcess = spawn(
      config.paths.bundledRuntimePath,
      [this.coreEntryPath],
      {
        cwd: config.paths.appRoot,
        env: {
          ...process.env,
          ...this.coreEnvironment,
          [LOOPBACK_SESSION_TOKEN_ENV]: sessionToken,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    childProcess.stdout.setEncoding("utf8");
    childProcess.stderr.setEncoding("utf8");

    try {
      const readyInfoPromise = this.WaitForReadyInfo(childProcess);
      childProcess.stdin.write(`${JSON.stringify(config)}\n`);
      const readyInfo = await readyInfoPromise;
      const managedProcess = new GongpilManagedCoreProcess(
        childProcess,
        readyInfo,
        this.stopTimeoutMs,
      );
      this.processes.add(managedProcess);
      childProcess.once("exit", () => this.processes.delete(managedProcess));
      return managedProcess;
    }
    catch (error) {
      await this.StopFailedChild(childProcess);
      if (error instanceof GongpilCoreProcessError) {
        throw error;
      }
      throw new GongpilCoreProcessError(
        "CORE_START_FAILED",
        "Core 프로세스를 시작하지 못했습니다.",
        error,
      );
    }
  }

  public GetRunningProcessIds(): number[] {
    return [...this.processes]
      .filter((managedProcess) => managedProcess.IsRunning())
      .map((managedProcess) => managedProcess.GetProcessId());
  }

  private WaitForReadyInfo(
    childProcess: ChildProcessWithoutNullStreams,
  ): Promise<GongpilCoreReadyInfo> {
    return new Promise((resolve, reject) => {
      let stdoutBuffer = "";
      let stderrBuffer = "";
      const timeout = setTimeout(() => {
        rejectReady("CORE_START_TIMEOUT", "Core 준비 응답 시간이 초과됐습니다.");
      }, this.startTimeoutMs);

      const cleanup = (): void => {
        clearTimeout(timeout);
        childProcess.stdout.off("data", onStdout);
        childProcess.stderr.off("data", onStderr);
        childProcess.off("error", onError);
        childProcess.off("exit", onExit);
      };
      const rejectReady = (code: string, message: string, cause?: unknown): void => {
        cleanup();
        reject(new GongpilCoreProcessError(code, message, cause));
      };
      const onStdout = (chunk: string): void => {
        stdoutBuffer += chunk;
        if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_READY_LINE_BYTES) {
          rejectReady("CORE_READY_TOO_LARGE", "Core 준비 응답이 제한을 초과했습니다.");
          return;
        }

        const lineEnd = stdoutBuffer.indexOf("\n");
        if (lineEnd < 0) {
          return;
        }
        const line = stdoutBuffer.slice(0, lineEnd).trim();
        const remainder = stdoutBuffer.slice(lineEnd + 1).trim();
        if (line.length === 0 || remainder.length > 0) {
          rejectReady("CORE_READY_INVALID", "Core 준비 응답은 JSON 한 줄이어야 합니다.");
          return;
        }
        try {
          const readyInfo = ParseCoreReadyInfo(JSON.parse(line));
          cleanup();
          resolve(readyInfo);
        }
        catch (error) {
          rejectReady("CORE_READY_INVALID", "Core 준비 응답 계약이 올바르지 않습니다.", error);
        }
      };
      const onStderr = (chunk: string): void => {
        if (stderrBuffer.length < 4096) {
          stderrBuffer += chunk.slice(0, 4096 - stderrBuffer.length);
        }
      };
      const onError = (error: Error): void => {
        rejectReady("CORE_START_FAILED", "Core 프로세스를 실행하지 못했습니다.", error);
      };
      const onExit = (): void => {
        const hasStructuredError = stderrBuffer.includes("CORE_START_FAILED");
        rejectReady(
          "CORE_START_FAILED",
          hasStructuredError
            ? "Core가 시작 경계를 거부했습니다."
            : "Core가 준비 응답 전에 종료됐습니다.",
        );
      };

      childProcess.stdout.on("data", onStdout);
      childProcess.stderr.on("data", onStderr);
      childProcess.once("error", onError);
      childProcess.once("exit", onExit);
    });
  }

  private async StopFailedChild(childProcess: ChildProcessWithoutNullStreams): Promise<void> {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return;
    }
    childProcess.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, this.stopTimeoutMs);
      childProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private readonly coreEntryPath: string;
  private readonly startTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly coreEnvironment: NodeJS.ProcessEnv;
  private readonly processes = new Set<GongpilManagedCoreProcess>();
}
