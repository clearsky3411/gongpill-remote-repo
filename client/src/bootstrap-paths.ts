import { win32 as WindowsPath } from "node:path";

import type {
  GongpilBootstrapPaths,
  GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";

export interface GongpilBootstrapPathOptions {
  mode: GongpilClientBootstrapConfig["mode"];
  sessionId: string;
  appRoot: string;
  installedDataRoot?: string;
  bundledRuntimePath?: string;
}

export function ResolveBootstrapPaths(
  options: GongpilBootstrapPathOptions,
): GongpilBootstrapPaths {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.sessionId)) {
    throw new Error("sessionId가 경로에 사용할 수 있는 형식이 아닙니다.");
  }

  const appRoot = RequireAbsolutePath(options.appRoot, "appRoot");
  const dataRoot = options.mode === "portable"
    ? WindowsPath.join(appRoot, "GongpilData")
    : RequireAbsolutePath(
      options.installedDataRoot ?? ProcessInstalledDataRoot(),
      "installedDataRoot",
    );
  const bundledRuntimePath = options.bundledRuntimePath === undefined
    ? WindowsPath.join(appRoot, "runtime", "node.exe")
    : RequireAbsolutePath(options.bundledRuntimePath, "bundledRuntimePath");

  return {
    appRoot,
    dataRoot,
    versionRoot: WindowsPath.join(appRoot, "versions"),
    sessionTemp: WindowsPath.join(dataRoot, "sessions", options.sessionId),
    bundledRuntimePath,
  };
}

function ProcessInstalledDataRoot(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData === undefined || !WindowsPath.isAbsolute(localAppData)) {
    throw new Error("설치형 dataRoot를 결정할 LOCALAPPDATA가 없습니다.");
  }
  return WindowsPath.join(localAppData, "Gongpil");
}

function RequireAbsolutePath(value: string, name: string): string {
  if (!WindowsPath.isAbsolute(value)) {
    throw new Error(`${name}는 Windows 절대 경로여야 합니다.`);
  }
  return WindowsPath.normalize(value);
}
