import type { GongpilNetworkConnectionProfile } from "../../../platform/network-runtime/src/contracts.ts";

export const GONGPIL_BOOTSTRAP_PROTOCOL_VERSION = Object.freeze({
  major: 1,
  minor: 0,
});

export interface GongpilProtocolVersion {
  major: number;
  minor: number;
}

export interface GongpilSupportedProtocolRange {
  major: number;
  minMinor: number;
  maxMinor: number;
}

export interface GongpilBootstrapPaths {
  appRoot: string;
  dataRoot: string;
  versionRoot: string;
  sessionTemp: string;
  bundledRuntimePath: string;
}

export interface GongpilActivationRequest {
  reason: "startup" | "update" | "rollback";
  previousCoreVersion?: string;
  requireHealthCheck: true;
}

export interface GongpilClientBootstrapConfig {
  protocolVersion: GongpilProtocolVersion;
  launchId: string;
  sessionId: string;
  mode: "installed" | "portable";
  clientVersion: string;
  selectedCoreVersion: string;
  supportedCoreProtocol: GongpilSupportedProtocolRange;
  paths: GongpilBootstrapPaths;
  activation: GongpilActivationRequest;
}

export interface GongpilCoreReadyInfo {
  protocolVersion: GongpilProtocolVersion;
  launchId: string;
  sessionId: string;
  coreVersion: string;
  coreApiVersion: string;
  health: "ready" | "degraded";
  networkProfile: GongpilNetworkConnectionProfile;
  capabilities: string[];
}

export interface GongpilBootstrapErrorShape {
  code:
    | "INVALID_BOOTSTRAP_CONFIG"
    | "CORE_START_FAILED"
    | "CORE_HEALTH_CHECK_FAILED"
    | "PROTOCOL_INCOMPATIBLE"
    | "CORE_VERSION_INVALID"
    | "CORE_VERSION_ROLLBACK_REQUIRED"
    | "SESSION_AUTH_FAILED";
  userMessage: string;
  retryable: boolean;
  traceId?: string;
}

export interface GongpilCoreActivationResult {
  protocolVersion: GongpilProtocolVersion;
  launchId: string;
  sessionId: string;
  accepted: boolean;
  activeCoreVersion: string;
  rollbackRequired: boolean;
  error?: GongpilBootstrapErrorShape;
}

export interface GongpilBrowserSessionSummary {
  protocolVersion: GongpilProtocolVersion;
  sessionId: string;
  mode: "installed" | "portable";
  coreStatus: "starting" | "ready" | "failed" | "rolled-back";
  coreVersion?: string;
  coreApiVersion?: string;
  activeProjectId?: string;
  activeProjectName?: string;
  readOnly: boolean;
  updateState: "idle" | "activating" | "active" | "rolled-back";
  capabilities: string[];
  error?: GongpilBootstrapErrorShape;
}

export class GongpilBootstrapContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GongpilBootstrapContractError";
  }
}

export function IsProtocolCompatible(
  version: GongpilProtocolVersion,
  supportedRange: GongpilSupportedProtocolRange,
): boolean {
  return version.major === supportedRange.major
    && version.minor >= supportedRange.minMinor
    && version.minor <= supportedRange.maxMinor;
}

export function ParseClientBootstrapConfig(value: unknown): GongpilClientBootstrapConfig {
  const config = RequireRecord(value, "ClientBootstrapConfig");
  RequireExactKeys(config, [
    "protocolVersion",
    "launchId",
    "sessionId",
    "mode",
    "clientVersion",
    "selectedCoreVersion",
    "supportedCoreProtocol",
    "paths",
    "activation",
  ], "ClientBootstrapConfig");

  const protocolVersion = ParseProtocolVersion(config.protocolVersion, "protocolVersion");
  const supportedCoreProtocol = ParseSupportedRange(config.supportedCoreProtocol);
  const paths = ParseBootstrapPaths(config.paths);
  const activation = ParseActivationRequest(config.activation);
  const mode = RequireEnum(config.mode, ["installed", "portable"], "mode");

  return {
    protocolVersion,
    launchId: RequireStableId(config.launchId, "launchId"),
    sessionId: RequireStableId(config.sessionId, "sessionId"),
    mode,
    clientVersion: RequireSemanticVersion(config.clientVersion, "clientVersion"),
    selectedCoreVersion: RequireSemanticVersion(config.selectedCoreVersion, "selectedCoreVersion"),
    supportedCoreProtocol,
    paths,
    activation,
  };
}

export function ParseCoreReadyInfo(value: unknown): GongpilCoreReadyInfo {
  const readyInfo = RequireRecord(value, "CoreReadyInfo");
  RequireExactKeys(readyInfo, [
    "protocolVersion",
    "launchId",
    "sessionId",
    "coreVersion",
    "coreApiVersion",
    "health",
    "networkProfile",
    "capabilities",
  ], "CoreReadyInfo");

  if (!Array.isArray(readyInfo.capabilities)) {
    throw new GongpilBootstrapContractError("capabilities는 배열이어야 합니다.");
  }
  const capabilities = readyInfo.capabilities.map((item, index) => (
    RequireStableId(item, `capabilities[${index}]`)
  ));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new GongpilBootstrapContractError("capabilities는 중복될 수 없습니다.");
  }

  return {
    protocolVersion: ParseProtocolVersion(readyInfo.protocolVersion, "protocolVersion"),
    launchId: RequireStableId(readyInfo.launchId, "launchId"),
    sessionId: RequireStableId(readyInfo.sessionId, "sessionId"),
    coreVersion: RequireSemanticVersion(readyInfo.coreVersion, "coreVersion"),
    coreApiVersion: RequireSemanticVersion(readyInfo.coreApiVersion, "coreApiVersion"),
    health: RequireEnum(readyInfo.health, ["ready", "degraded"], "health"),
    networkProfile: ParseNetworkProfile(readyInfo.networkProfile),
    capabilities,
  };
}

function ParseActivationRequest(value: unknown): GongpilActivationRequest {
  const activation = RequireRecord(value, "activation");
  RequireAllowedKeys(
    activation,
    ["reason", "previousCoreVersion", "requireHealthCheck"],
    "activation",
  );
  if (activation.requireHealthCheck !== true) {
    throw new GongpilBootstrapContractError("requireHealthCheck는 true여야 합니다.");
  }

  const result: GongpilActivationRequest = {
    reason: RequireEnum(activation.reason, ["startup", "update", "rollback"], "reason"),
    requireHealthCheck: true,
  };
  if (activation.previousCoreVersion !== undefined) {
    result.previousCoreVersion = RequireSemanticVersion(
      activation.previousCoreVersion,
      "previousCoreVersion",
    );
  }
  return result;
}

function ParseBootstrapPaths(value: unknown): GongpilBootstrapPaths {
  const paths = RequireRecord(value, "paths");
  const keys = ["appRoot", "dataRoot", "versionRoot", "sessionTemp", "bundledRuntimePath"];
  RequireExactKeys(paths, keys, "paths");

  return {
    appRoot: RequireAbsoluteWindowsPath(paths.appRoot, "appRoot"),
    dataRoot: RequireAbsoluteWindowsPath(paths.dataRoot, "dataRoot"),
    versionRoot: RequireAbsoluteWindowsPath(paths.versionRoot, "versionRoot"),
    sessionTemp: RequireAbsoluteWindowsPath(paths.sessionTemp, "sessionTemp"),
    bundledRuntimePath: RequireAbsoluteWindowsPath(paths.bundledRuntimePath, "bundledRuntimePath"),
  };
}

function ParseNetworkProfile(value: unknown): GongpilNetworkConnectionProfile {
  const profile = RequireRecord(value, "networkProfile");
  RequireExactKeys(profile, [
    "protocolVersion",
    "profileId",
    "mode",
    "origin",
    "commandBasePath",
    "eventPath",
    "statusPath",
    "authMode",
  ], "networkProfile");
  const mode = RequireEnum(profile.mode, ["local", "cloud"], "networkProfile.mode");
  const authMode = RequireEnum(
    profile.authMode,
    ["loopback-session", "secure-cookie"],
    "networkProfile.authMode",
  );
  if (profile.commandBasePath !== "/api/v1/commands"
    || profile.eventPath !== "/api/v1/events"
    || profile.statusPath !== "/api/v1/network/status") {
    throw new GongpilBootstrapContractError("networkProfile route가 고정 계약과 다릅니다.");
  }
  if (typeof profile.origin !== "string") {
    throw new GongpilBootstrapContractError("networkProfile.origin이 문자열이 아닙니다.");
  }

  return {
    protocolVersion: ParseProtocolVersion(profile.protocolVersion, "networkProfile.protocolVersion"),
    profileId: RequireStableId(profile.profileId, "networkProfile.profileId"),
    mode,
    origin: profile.origin,
    commandBasePath: "/api/v1/commands",
    eventPath: "/api/v1/events",
    statusPath: "/api/v1/network/status",
    authMode,
  };
}

function ParseProtocolVersion(value: unknown, name: string): GongpilProtocolVersion {
  const version = RequireRecord(value, name);
  RequireExactKeys(version, ["major", "minor"], name);
  return {
    major: RequireNonNegativeInteger(version.major, `${name}.major`),
    minor: RequireNonNegativeInteger(version.minor, `${name}.minor`),
  };
}

function ParseSupportedRange(value: unknown): GongpilSupportedProtocolRange {
  const range = RequireRecord(value, "supportedCoreProtocol");
  RequireExactKeys(range, ["major", "minMinor", "maxMinor"], "supportedCoreProtocol");
  const result = {
    major: RequireNonNegativeInteger(range.major, "supportedCoreProtocol.major"),
    minMinor: RequireNonNegativeInteger(range.minMinor, "supportedCoreProtocol.minMinor"),
    maxMinor: RequireNonNegativeInteger(range.maxMinor, "supportedCoreProtocol.maxMinor"),
  };
  if (result.minMinor > result.maxMinor) {
    throw new GongpilBootstrapContractError("지원 protocol minor 범위가 올바르지 않습니다.");
  }
  return result;
}

function RequireRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GongpilBootstrapContractError(`${name}은 객체여야 합니다.`);
  }
  return value as Record<string, unknown>;
}

function RequireExactKeys(
  value: Record<string, unknown>,
  keys: string[],
  name: string,
): void {
  RequireAllowedKeys(value, keys, name);
  for (const key of keys) {
    if (!(key in value)) {
      throw new GongpilBootstrapContractError(`${name}.${key}가 필요합니다.`);
    }
  }
}

function RequireAllowedKeys(
  value: Record<string, unknown>,
  keys: string[],
  name: string,
): void {
  const allowedKeys = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new GongpilBootstrapContractError(`${name}.${key}는 허용되지 않습니다.`);
    }
  }
}

function RequireStableId(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new GongpilBootstrapContractError(`${name}가 안정적인 ID 형식이 아닙니다.`);
  }
  return value;
}

function RequireSemanticVersion(value: unknown, name: string): string {
  const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (typeof value !== "string" || value.length > 128 || !pattern.test(value)) {
    throw new GongpilBootstrapContractError(`${name}가 semantic version 형식이 아닙니다.`);
  }
  return value;
}

function RequireAbsoluteWindowsPath(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 32767 || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) {
    throw new GongpilBootstrapContractError(`${name}가 Windows 절대 경로가 아닙니다.`);
  }
  return value;
}

function RequireNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new GongpilBootstrapContractError(`${name}는 0 이상의 정수여야 합니다.`);
  }
  return value as number;
}

function RequireEnum<const TValue extends string>(
  value: unknown,
  values: readonly TValue[],
  name: string,
): TValue {
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new GongpilBootstrapContractError(`${name} 값이 허용 범위에 없습니다.`);
  }
  return value as TValue;
}
