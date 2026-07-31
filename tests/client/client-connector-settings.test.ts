import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";

import {
  GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
  GONGPIL_SYSTEM_CONFIG_DEFAULTS,
  LoadClientSettings,
  ResolveClientAppearanceSeedPath,
  ResolveClientFontRoot,
  ResolveClientSettingsPath,
  SaveClientSettings,
} from "../../client/src/client-settings-store.ts";
import {
  ListClientUserFontFiles,
  LoadClientFontCatalog,
} from "../../client/src/client-font-catalog.ts";
import { ResolveClientStoragePaths } from "../../client/src/bootstrap-paths.ts";
import { LoadClientReleaseNotes } from "../../client/src/client-connector.ts";

const APP_ROOT = process.cwd();

test("Client Package 릴리스 정보가 버전·가능 기능·패치노트를 제공한다", async () => {
  const releaseNotes = await LoadClientReleaseNotes(APP_ROOT);
  const packageManifest = JSON.parse(await readFile(join(APP_ROOT, "package.json"), "utf8"));
  assert.equal(releaseNotes.schemaVersion, 1);
  assert.equal(releaseNotes.productVersion, packageManifest.version);
  assert.equal(releaseNotes.productVersion, "0.1.1");
  assert.ok(releaseNotes.capabilities.length >= 5);
  assert.ok(releaseNotes.changes.some((change) => change.includes("heartbeat")));
  const versionSourcePaths = [
    ["client", "src", "client-process.ts"],
    ["client", "windows", "GongpilConnector.ps1"],
    ["core", "src", "codex-app-server-client.ts"],
    ["installer", "windows", "Gongpil.iss"],
    ["scripts", "build-portable.ps1"],
    ["scripts", "build-installer.ps1"],
    ["scripts", "test-portable.ps1"],
    ["scripts", "test-installer.ps1"],
    ["scripts", "validate-release.ps1"],
  ];
  for (const pathParts of versionSourcePaths) {
    assert.match(
      await readFile(join(APP_ROOT, ...pathParts), "utf8"),
      new RegExp(releaseNotes.productVersion.replaceAll(".", "\\.")),
      `${pathParts.join("/")}의 기본 버전이 Client Package 버전과 다릅니다.`,
    );
  }
});

test("Windows 접속기 UI가 홈·설정·시스템·정보와 Runtime 상태를 구분한다", async () => {
  const script = await readFile(join(APP_ROOT, "client", "windows", "GongpilConnector.ps1"), "utf8");
  assert.match(script, /\$homeTab\.Text = '홈'/);
  assert.match(script, /\$settingsTab\.Text = '설정'/);
  assert.match(script, /\$systemTab\.Text = '시스템'/);
  assert.match(script, /\$infoTab\.Text = '정보'/);
  assert.match(script, /Client Runtime 실행 중/);
  assert.match(script, /지금 가능한 작업/);
  assert.match(script, /패치노트/);
  assert.match(script, /Source Repository/);
  assert.match(script, /Distribution Repository/);
  assert.match(script, /자동 다운로드와 활성 버전 전환은 아직 TARGET/);
  assert.match(script, /\$appearanceTab\.Text = '화면'/);
  assert.match(script, /System\.Drawing\.Text\.PrivateFontCollection/);
  assert.match(script, /SetProcessDpiAwarenessContext/);
  assert.match(script, /AutoScaleMode.*Dpi/);
  assert.match(script, /System\.Drawing\.Point/);
  assert.doesNotMatch(script, /\.CenterToScreen\(/);
  assert.doesNotMatch(script, /Malgun Gothic/);
});

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
    assert.equal(loaded.settings.schemaVersion, 2);
    assert.equal(loaded.settings.showConnectorOnStartup, true);
    assert.equal(loaded.settings.aiProvider, "codex");
    assert.equal(loaded.settings.codexModel, "gpt-5.6-terra");
    assert.equal(loaded.settings.openAiModel, "gpt-5.6-terra");
    assert.deepEqual(loaded.settings.repositories, GONGPIL_SYSTEM_CONFIG_DEFAULTS.repositories);
    assert.deepEqual(loaded.settings.update, GONGPIL_SYSTEM_CONFIG_DEFAULTS.update);
    assert.equal(loaded.settingsPath, join(context.settingsRoot, "client-settings.json"));
    assert.deepEqual(loaded.settings.appearance, {
      ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
      fontRoot: join(context.settingsRoot, "fonts"),
    });
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("설치형 첫 실행은 인스톨러 화면 시드를 검증·원자 저장한 뒤 제거한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-appearance-seed-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      settingsRoot: join(testRoot, "settings"),
    };
    const fontRoot = join(testRoot, "my-client-fonts");
    const seedPath = ResolveClientAppearanceSeedPath(context);
    await mkdir(context.settingsRoot, { recursive: true });
    await writeFile(seedPath, JSON.stringify({
      schemaVersion: 1,
      appearance: {
        ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
        fontRoot,
        baseFontSizePt: 11,
        uiScalePercent: 125,
        windowWidthDip: 980,
        windowHeightDip: 820,
      },
    }), "utf8");

    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.isFirstRun, true);
    assert.deepEqual(loaded.settings.appearance, {
      ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
      fontRoot,
      baseFontSizePt: 11,
      uiScalePercent: 125,
      windowWidthDip: 980,
      windowHeightDip: 820,
    });
    assert.deepEqual(JSON.parse(await readFile(loaded.settingsPath, "utf8")).appearance, loaded.settings.appearance);
    await assert.rejects(readFile(seedPath), /ENOENT/);
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
    const defaults = (await LoadClientSettings(context)).settings;
    await SaveClientSettings(context, {
      ...defaults,
      dataRoot,
      showConnectorOnStartup: true,
      appearance: {
        ...defaults.appearance,
        baseFontSizePt: 10,
        uiScalePercent: 110,
        windowWidthDip: 900,
        windowHeightDip: 800,
      },
      repositories: {
        source: {
          type: "git",
          url: "https://github.com/example/gongpil-source.git",
          defaultBranch: "develop",
        },
        distribution: {
          type: "github-releases",
          url: "https://github.com/example/gongpil-distribution/releases",
        },
      },
      update: { channel: "beta" },
    });
    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.isFirstRun, false);
    assert.equal(loaded.settings.dataRoot, dataRoot);
    assert.equal(loaded.settings.showConnectorOnStartup, true);
    assert.deepEqual((await readdir(context.settingsRoot)).sort(), ["client-settings.json", "fonts"]);
    assert.deepEqual(JSON.parse(await readFile(loaded.settingsPath, "utf8")), {
      schemaVersion: 2,
      dataRoot,
      showConnectorOnStartup: true,
      aiProvider: "codex",
      codexModel: "gpt-5.6-terra",
      openAiModel: "gpt-5.6-terra",
      appearance: {
        ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
        fontRoot: join(context.settingsRoot, "fonts"),
        baseFontSizePt: 10,
        uiScalePercent: 110,
        windowWidthDip: 900,
        windowHeightDip: 800,
      },
      repositories: {
        source: {
          type: "git",
          url: "https://github.com/example/gongpil-source.git",
          defaultBranch: "develop",
        },
        distribution: {
          type: "github-releases",
          url: "https://github.com/example/gongpil-distribution/releases",
        },
      },
      update: { channel: "beta" },
    });
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("기존 v2 설정은 저장소와 Update Channel을 같은 설정 파일에 보완한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-system-config-upgrade-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      settingsRoot: join(testRoot, "settings"),
    };
    const settingsPath = ResolveClientSettingsPath(context);
    const dataRoot = join(testRoot, "data");
    await mkdir(context.settingsRoot, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      schemaVersion: 2,
      dataRoot,
      showConnectorOnStartup: true,
      aiProvider: "codex",
      codexModel: "gpt-5.6-terra",
      openAiModel: "gpt-5.6-terra",
      appearance: {
        ...GONGPIL_CLIENT_APPEARANCE_DEFAULTS,
        fontRoot: join(context.settingsRoot, "fonts"),
      },
    }), "utf8");

    const loaded = await LoadClientSettings(context);
    assert.deepEqual(loaded.settings.repositories, GONGPIL_SYSTEM_CONFIG_DEFAULTS.repositories);
    assert.deepEqual(loaded.settings.update, GONGPIL_SYSTEM_CONFIG_DEFAULTS.update);
    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(persisted.repositories, GONGPIL_SYSTEM_CONFIG_DEFAULTS.repositories);
    assert.deepEqual(persisted.update, GONGPIL_SYSTEM_CONFIG_DEFAULTS.update);
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("System Config는 안전하지 않은 저장소 URL과 알 수 없는 Update Channel을 거부한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-system-config-invalid-"));
  try {
    const context = {
      mode: "installed" as const,
      appRoot: join(testRoot, "program", "Gongpil"),
      settingsRoot: join(testRoot, "settings"),
    };
    const defaults = (await LoadClientSettings(context)).settings;
    await assert.rejects(
      SaveClientSettings(context, {
        ...defaults,
        repositories: {
          ...defaults.repositories,
          source: { ...defaults.repositories.source, url: "http://example.com/repository.git" },
        },
      }),
      /HTTPS 주소/,
    );
    await assert.rejects(
      SaveClientSettings(context, {
        ...defaults,
        update: { channel: "nightly" },
      }),
      /stable, beta 또는 dev/,
    );
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
    assert.equal(ResolveClientSettingsPath(context), join(context.appRoot, "GongpilClient", "client-settings.json"));
    assert.equal(ResolveClientFontRoot(context), join(context.appRoot, "GongpilClient", "fonts"));
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("포터블의 이전 GongpilData 설정을 GongpilClient로 검증 후 이동한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-settings-portable-migrate-"));
  try {
    const context = {
      mode: "portable" as const,
      appRoot: join(testRoot, "Gongpil"),
    };
    const legacyPath = join(context.appRoot, "GongpilData", "client-settings.json");
    await mkdir(join(context.appRoot, "GongpilData"), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({
      schemaVersion: 1,
      dataRoot: join(testRoot, "ignored"),
      showConnectorOnStartup: false,
    }), "utf8");

    const loaded = await LoadClientSettings(context);
    assert.equal(loaded.settings.schemaVersion, 2);
    assert.equal(loaded.settings.dataRoot, join(context.appRoot, "GongpilData"));
    assert.equal(loaded.settings.appearance.fontRoot, join(context.appRoot, "GongpilClient", "fonts"));
    assert.equal(loaded.settingsPath, join(context.appRoot, "GongpilClient", "client-settings.json"));
    await assert.rejects(readFile(legacyPath), /ENOENT/);
    assert.equal(JSON.parse(await readFile(loaded.settingsPath, "utf8")).schemaVersion, 2);
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
    assert.equal(JSON.parse(await readFile(loaded.settingsPath, "utf8")).schemaVersion, 2);
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Client Package 글꼴 manifest가 나눔고딕 두 파일과 공식 D2Coding을 checksum으로 검증한다", async () => {
  const catalog = await LoadClientFontCatalog(APP_ROOT);
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.fonts.map((font) => font.id), ["nanum-gothic", "d2coding"]);
  assert.equal(catalog.fonts.flatMap((font) => font.files).length, 3);
  assert.equal(catalog.fonts.find((font) => font.id === "nanum-gothic")?.files.length, 2);
  assert.equal(catalog.fonts.find((font) => font.id === "d2coding")?.files[0]?.families[0], "D2Coding");
  assert.deepEqual(catalog.licenses.map((license) => license.id), ["naver-nanum", "d2coding-ofl-1.1"]);
});

test("사용자 글꼴 루트는 지원 확장자의 일반 파일만 checksum과 함께 열거한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-user-fonts-"));
  try {
    const fontRoot = join(testRoot, "fonts");
    await mkdir(fontRoot, { recursive: true });
    await copyFile(join(APP_ROOT, "client", "resources", "fonts", "NanumGothic.ttf"), join(fontRoot, "MyFont.ttf"));
    await writeFile(join(fontRoot, "ignore.txt"), "not a font", "utf8");
    const fonts = await ListClientUserFontFiles(fontRoot);
    assert.equal(fonts.length, 1);
    assert.equal(fonts[0].id, "user:myfont.ttf");
    assert.equal(fonts[0].bytes, 4691820);
    assert.equal(fonts[0].sha256, "48a28e97b34fc8e5b157657633670cd1b7de126cfc414da65ce9c3d5bc8be733");
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("Client Runtime 설정·글꼴 루트는 설치형과 포터블에서 프로젝트 데이터와 분리된다", () => {
  const installed = ResolveClientStoragePaths({
    mode: "installed",
    appRoot: "C:\\Apps\\Gongpil",
  });
  assert.deepEqual(installed, {
    clientConfigRoot: "C:\\Apps\\GongpilConfig",
    settingsPath: "C:\\Apps\\GongpilConfig\\client-settings.json",
    userFontRoot: "C:\\Apps\\GongpilConfig\\fonts",
  });
  const portable = ResolveClientStoragePaths({
    mode: "portable",
    appRoot: "D:\\Portable\\Gongpil",
  });
  assert.deepEqual(portable, {
    clientConfigRoot: "D:\\Portable\\Gongpil\\GongpilClient",
    settingsPath: "D:\\Portable\\Gongpil\\GongpilClient\\client-settings.json",
    userFontRoot: "D:\\Portable\\Gongpil\\GongpilClient\\fonts",
  });
});

test("Windows 접속기 스크립트가 설정 입력을 읽고 시작 응답을 반환한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-client-connector-script-"));
  try {
    const inputPath = join(testRoot, "input.json");
    const outputPath = join(testRoot, "output.json");
    const appRoot = join(testRoot, "program", "Gongpil");
    const dataRoot = join(testRoot, "selected-data");
    const settingsContext = {
      mode: "installed" as const,
      appRoot,
      settingsRoot: join(testRoot, "settings"),
    };
    const settings = (await LoadClientSettings(settingsContext)).settings;
    const appearance = {
      ...settings.appearance,
      baseFontSizePt: 10,
      uiScalePercent: 125,
      windowWidthDip: 900,
      windowHeightDip: 800,
    };
    await writeFile(inputPath, JSON.stringify({
      mode: "installed",
      settings: { ...settings, dataRoot, appearance },
      isFirstRun: true,
      lifecycleReason: "startup",
      appRoot,
      settingsPath: join(testRoot, "settings", "client-settings.json"),
      releaseNotes: await LoadClientReleaseNotes(APP_ROOT),
      fontCatalog: await LoadClientFontCatalog(APP_ROOT),
      userFontFiles: [],
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
      repositories: settings.repositories,
      update: settings.update,
      appearance,
    });
    const shownProbeOutputPath = join(testRoot, "shown-probe-output.json");
    const shownProbe = spawnSync(
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA",
        "-File", join(process.cwd(), "client", "windows", "GongpilConnector.ps1"),
        "-InputPath", inputPath,
        "-OutputPath", shownProbeOutputPath,
        "-AutomationAction", "ProbeShown",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    assert.equal(shownProbe.status, 0, `${shownProbe.stdout}\n${shownProbe.stderr}`);
    assert.equal(JSON.parse(await readFile(shownProbeOutputPath, "utf8")).action, "cancel");
  }
  finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
