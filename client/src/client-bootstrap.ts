import { randomBytes } from "node:crypto";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  IsProtocolCompatible,
  ParseClientBootstrapConfig,
  type GongpilBootstrapErrorShape,
  type GongpilBrowserSessionSummary,
  type GongpilClientBootstrapConfig,
  type GongpilCoreActivationResult,
  type GongpilCoreReadyInfo,
} from "../../packages/contracts/bootstrap/contracts.ts";
import type { GongpilNetworkConnectionProfile } from "../../platform/network-runtime/src/contracts.ts";
import { GongpilNetworkRuntime } from "../../platform/network-runtime/src/network-runtime.ts";
import { GongpilLoopbackHttpTransport } from "../../platform/network-runtime/src/transports/loopback-http-transport.ts";
import {
  GongpilCoreProcessError,
  GongpilCoreProcessManager,
  type GongpilManagedCoreProcess,
} from "./core-process-manager.ts";

export interface GongpilClientBootstrapResult {
  activationResult: GongpilCoreActivationResult;
  browserSession: GongpilBrowserSessionSummary;
}

interface GongpilActiveCore {
  config: GongpilClientBootstrapConfig;
  process: GongpilManagedCoreProcess;
  readyInfo: GongpilCoreReadyInfo;
}

export class GongpilClientBootstrapError extends Error {
  public constructor(error: GongpilBootstrapErrorShape, cause?: unknown) {
    super(error.userMessage, { cause });
    this.name = "GongpilClientBootstrapError";
    this.bootstrapError = error;
  }

  public readonly bootstrapError: GongpilBootstrapErrorShape;
}

export class GongpilClientBootstrap {
  public constructor(processManager: GongpilCoreProcessManager) {
    this.processManager = processManager;
    this.networkRuntime = new GongpilNetworkRuntime((profile) => this.CreateTransport(profile));
  }

  public async ActivateCore(
    inputConfig: GongpilClientBootstrapConfig,
  ): Promise<GongpilClientBootstrapResult> {
    const config = this.ParseConfig(inputConfig);
    const previousCore = this.activeCore;
    const sessionToken = randomBytes(32).toString("base64url");
    let candidateProcess: GongpilManagedCoreProcess | undefined;
    let candidateProfileId: string | undefined;

    try {
      candidateProcess = await this.processManager.StartCore(config, sessionToken);
      const readyInfo = candidateProcess.GetReadyInfo();
      this.ValidateReadyInfo(config, readyInfo);

      candidateProfileId = readyInfo.networkProfile.profileId;
      this.sessionTokens.set(candidateProfileId, sessionToken);
      await this.networkRuntime.ReplaceConnection(readyInfo.networkProfile);

      this.activeCore = { config, process: candidateProcess, readyInfo };
      if (previousCore !== undefined) {
        this.sessionTokens.delete(previousCore.readyInfo.networkProfile.profileId);
        await previousCore.process.Stop();
      }

      return {
        activationResult: {
          protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
          launchId: config.launchId,
          sessionId: config.sessionId,
          accepted: true,
          activeCoreVersion: readyInfo.coreVersion,
          rollbackRequired: false,
        },
        browserSession: this.CreateBrowserSession(config, readyInfo, "ready"),
      };
    }
    catch (error) {
      if (candidateProfileId !== undefined) {
        this.sessionTokens.delete(candidateProfileId);
      }
      await candidateProcess?.Stop();

      const bootstrapError = this.NormalizeError(error);
      if (previousCore === undefined) {
        throw new GongpilClientBootstrapError(bootstrapError, error);
      }

      return {
        activationResult: {
          protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
          launchId: config.launchId,
          sessionId: config.sessionId,
          accepted: false,
          activeCoreVersion: previousCore.readyInfo.coreVersion,
          rollbackRequired: true,
          error: bootstrapError,
        },
        browserSession: {
          ...this.CreateBrowserSession(
            previousCore.config,
            previousCore.readyInfo,
            "rolled-back",
          ),
          error: bootstrapError,
        },
      };
    }
  }

  public async Stop(): Promise<void> {
    const activeCore = this.activeCore;
    this.activeCore = undefined;
    await this.networkRuntime.Disconnect();
    if (activeCore !== undefined) {
      this.sessionTokens.delete(activeCore.readyInfo.networkProfile.profileId);
      await activeCore.process.Stop();
    }
  }

  public GetNetworkRuntime(): GongpilNetworkRuntime {
    return this.networkRuntime;
  }

  public GetActiveProcessId(): number | undefined {
    return this.activeCore?.process.GetProcessId();
  }

  public CreateBrowserLaunchUrl(launchPath: string): string {
    const activeCore = this.activeCore;
    if (activeCore === undefined) {
      throw new GongpilClientBootstrapError({
        code: "CORE_START_FAILED",
        userMessage: "활성 Core가 없습니다.",
        retryable: true,
      });
    }
    if (!/^\/launch\/[A-Za-z0-9_-]{20,128}$/.test(launchPath)) {
      throw new GongpilClientBootstrapError({
        code: "INVALID_BOOTSTRAP_CONFIG",
        userMessage: "Browser 시작 경로가 올바르지 않습니다.",
        retryable: false,
      });
    }
    return new URL(launchPath, activeCore.readyInfo.networkProfile.origin).toString();
  }

  public async WaitForActiveCoreExit(): Promise<void> {
    await this.activeCore?.process.WaitForExit();
  }

  private CreateBrowserSession(
    config: GongpilClientBootstrapConfig,
    readyInfo: GongpilCoreReadyInfo,
    coreStatus: GongpilBrowserSessionSummary["coreStatus"],
  ): GongpilBrowserSessionSummary {
    return {
      protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
      sessionId: readyInfo.sessionId,
      mode: config.mode,
      coreStatus,
      coreVersion: readyInfo.coreVersion,
      coreApiVersion: readyInfo.coreApiVersion,
      readOnly: false,
      updateState: coreStatus === "rolled-back" ? "rolled-back" : "active",
      capabilities: [...readyInfo.capabilities],
    };
  }

  private CreateTransport(
    profile: GongpilNetworkConnectionProfile,
  ): GongpilLoopbackHttpTransport {
    const sessionToken = this.sessionTokens.get(profile.profileId);
    if (sessionToken === undefined) {
      throw new GongpilCoreProcessError(
        "SESSION_AUTH_FAILED",
        "Core profile에 대응하는 세션 인증정보가 없습니다.",
      );
    }
    return new GongpilLoopbackHttpTransport({ sessionToken });
  }

  private NormalizeError(error: unknown): GongpilBootstrapErrorShape {
    if (error instanceof GongpilClientBootstrapError) {
      return error.bootstrapError;
    }
    if (error instanceof GongpilCoreProcessError) {
      const allowedCodes = new Set<GongpilBootstrapErrorShape["code"]>([
        "CORE_START_FAILED",
        "PROTOCOL_INCOMPATIBLE",
        "CORE_VERSION_INVALID",
        "CORE_HEALTH_CHECK_FAILED",
        "SESSION_AUTH_FAILED",
      ]);
      return {
        code: allowedCodes.has(error.code as GongpilBootstrapErrorShape["code"])
          ? error.code as GongpilBootstrapErrorShape["code"]
          : "CORE_START_FAILED",
        userMessage: error.message,
        retryable: false,
      };
    }
    return {
      code: "CORE_HEALTH_CHECK_FAILED",
      userMessage: "후보 Core 연결 검증에 실패했습니다.",
      retryable: true,
    };
  }

  private ParseConfig(inputConfig: GongpilClientBootstrapConfig): GongpilClientBootstrapConfig {
    try {
      return ParseClientBootstrapConfig(inputConfig);
    }
    catch (error) {
      throw new GongpilClientBootstrapError({
        code: "INVALID_BOOTSTRAP_CONFIG",
        userMessage: "Client 부트스트랩 설정이 계약과 일치하지 않습니다.",
        retryable: false,
      }, error);
    }
  }

  private ValidateReadyInfo(
    config: GongpilClientBootstrapConfig,
    readyInfo: GongpilCoreReadyInfo,
  ): void {
    if (readyInfo.launchId !== config.launchId || readyInfo.sessionId !== config.sessionId) {
      throw new GongpilCoreProcessError(
        "CORE_START_FAILED",
        "Core 준비 응답의 실행 식별자가 일치하지 않습니다.",
      );
    }
    if (!IsProtocolCompatible(readyInfo.protocolVersion, config.supportedCoreProtocol)) {
      throw new GongpilCoreProcessError(
        "PROTOCOL_INCOMPATIBLE",
        "Core protocol이 Client 지원 범위와 맞지 않습니다.",
      );
    }
    if (readyInfo.coreVersion !== config.selectedCoreVersion) {
      throw new GongpilCoreProcessError(
        "CORE_VERSION_INVALID",
        "실행된 Core 버전이 선택한 후보와 다릅니다.",
      );
    }
    if (readyInfo.health !== "ready") {
      throw new GongpilCoreProcessError(
        "CORE_HEALTH_CHECK_FAILED",
        "후보 Core가 준비 상태가 아닙니다.",
      );
    }
  }

  private readonly processManager: GongpilCoreProcessManager;
  private readonly networkRuntime: GongpilNetworkRuntime;
  private readonly sessionTokens = new Map<string, string>();
  private activeCore: GongpilActiveCore | undefined;
}
