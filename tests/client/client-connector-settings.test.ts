import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";

import {
  LoadClientSettings,
  ResolveClientSettingsPath,
  SaveClientSettings,
} from "../../client/src/client-settings-store.ts";

test("설치형 첫 실행은 기본 dataRoot와 접속기 표시 옵션을 준비한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-default-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      localAppData: join(testRoot, "local-app-data"),
      settingsRoot: join(testRoot, "settings"),
    };
    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.isFirstRun, true);
    assert.equal(loaded.settings.dataRoot, join(testRoot, "program", "GongpilData"));
    assert.equal(loaded.settings.showConnectorOnStartup, true);
    assert.equal(loaded.settings.aiProvider, "codex");
    assert.equal(loaded.settings.codexModel, "gpt-5.6-terra");
    assert.equal(loaded.settings.openAiModel, "gpt-5.6-terra");
    assert.equal(loaded.settingsPath, join(context.settingsRoot, "client-settings.json"));
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("설치형 사용자 경로와 시작 옵션을 원자 저장하고 다시 읽는다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-save-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      localAppData: join(testRoot, "local-app-data"),
      settingsRoot: join(testRoot, "settings"),
    };
    const dataRoot = join(testRoot, "selected-data");
    await SaveClientSettings(context, {
      schemaVersion: 1,
      dataRoot,
      showConnectorOnStartup: false,
      openAiModel: "gpt-5.6-terra",
    });
    await SaveClientSettings(context, {
      schemaVersion: 1,
      dataRoot,
      showConnectorOnStartup: true,
      aiProvider: "codex",
      codexModel: "gpt-5.6-terra",
      openAiModel: "gpt-5.6-terra",
    });
    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.isFirstRun, false);
    assert.equal(loaded.settings.dataRoot, dataRoot);
    assert.equal(loaded.settings.showConnectorOnStartup, true);
    assert.deepEqual(await readdir(context.settingsRoot), ["client-settings.json"]);
    assert.deepEqual(JSON.parse(await readFile(loaded.settingsPath, "utf8")), {
      schemaVersion: 1,
      dataRoot,
      showConnectorOnStartup: true,
      aiProvider: "codex",
      codexModel: "gpt-5.6-terra",
      openAiModel: "gpt-5.6-terra",
    });
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("드라이브 루트와 프로그램 폴더 내부를 설치형 dataRoot로 거부한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-boundary-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      localAppData: join(testRoot, "local-app-data"),
      settingsRoot: join(testRoot, "settings"),
    };
    await assert.rejects(
      SaveClientSettings(context, {
        schemaVersion: 1,
        dataRoot: parse(testRoot).root,
        showConnectorOnStartup: true,
        openAiModel: "gpt-5.6-terra",
      }),
      /드라이브 루트/,
    );
    await assert.rejects(
      SaveClientSettings(context, {
        schemaVersion: 1,
        dataRoot: join(context.appRoot, "data"),
        showConnectorOnStartup: true,
        openAiModel: "gpt-5.6-terra",
      }),
      /설치 폴더 내부/,
    );
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("포터블은 저장된 값과 무관하게 앱 옆 GongpilData로 고정한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-portable-"));
  try {
    const context = {
      mode: "portable" as const,
      appRoot: join(testRoot, "Gongpil"),
    };
    const saved = await SaveClientSettings(context, {
      schemaVersion: 1,
      dataRoot: join(testRoot, "ignored"),
      showConnectorOnStartup: false,
      openAiModel: "gpt-5.6-terra",
    });
    assert.equal(saved.dataRoot, join(context.appRoot, "GongpilData"));
    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.settings.dataRoot, join(context.appRoot, "GongpilData"));
    assert.equal(ResolveClientSettingsPath(context), join(context.appRoot, "GongpilData", "client-settings.json"));
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("손상된 설정 파일은 조용히 덮어쓰지 않고 사용자 오류를 낸다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-corrupt-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      localAppData: join(testRoot, "local-app-data"),
      settingsRoot: join(testRoot, "settings"),
    };
    const settingsPath = ResolveClientSettingsPath(context);
    await mkdir(context.settingsRoot, { recursive: true });
    await writeFile(settingsPath, "{not-json", { encoding: "utf8", flush: true });
    await assert.rejects(LoadClientSettings(context), /설정 파일이 손상/);
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("설치 패키지는 기존 LOCALAPPDATA 설정을 앱 기준 설정 폴더로 검증 후 이동한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-migrate-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      localAppData: join(testRoot, "local-app-data"),
      migrateLegacySettings: true,
    };
    const legacyPath = join(context.localAppData, "Gongpil", "client-settings.json");
    const dataRoot = join(testRoot, "selected-data");
    await mkdir(join(context.localAppData, "Gongpil"), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      schemaVersion: 1,
      dataRoot,
      showConnectorOnStartup: true,
    }), "utf8");

    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.isFirstRun, false);
    assert.equal(loaded.settings.dataRoot, dataRoot);
    assert.equal(loaded.settingsPath, join(testRoot, "program", "GongpilConfig", "client-settings.json"));
    await assert.rejects(readFile(legacyPath), /ENOENT/);
    assert.equal(JSON.parse(await readFile(loaded.settingsPath, "utf8")).openAiModel, "gpt-5.6-terra");
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Windows 접속기 스크립트가 설정 입력을 읽고 시작 응답을 반환한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-connector-script-"));
  try {
    const inputPath = join(testRoot, "input.json");
    const outputPath = join(testRoot, "output.json");
    const appRoot = join(testRoot, "program", "Gongpil");
    const dataRoot = join(testRoot, "selected-data");
    await writeFile(inputPath, JSON.stringify({
      mode: "installed",
      settings: { schemaVersion: 1, dataRoot, showConnectorOnStartup: true },
      isFirstRun: true,
      lifecycleReason: "startup",
      appRoot,
      settingsPath: join(testRoot, "settings", "client-settings.json"),
    }), "utf8");
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    assert.ok(systemRoot, "SystemRoot가 필요합니다.");
    const result = spawnSync(
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
        "-File", join(process.cwd(), "client", "windows", "GongpilConnector.ps1"),
        "-InputPath", inputPath,
        "-OutputPath", outputPath,
        "-AutomationAction", "Start",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const response = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(response, {
      action: "start",
      dataRoot,
      showConnectorOnStartup: true,
      aiProvider: "codex",
      codexExecutable: "",
      codexModel: "gpt-5.6-terra",
      openAiEnvFile: "",
      openAiModel: "gpt-5.6-terra",
    });
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
