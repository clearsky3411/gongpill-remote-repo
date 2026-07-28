import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const setupPath = process.env.GONGPIL_SETUP_PATH;
if (setupPath === undefined) {
  throw new Error("GONGPIL_SETUP_PATH가 필요합니다.");
}

test("Windows Installer가 사용자 지정 dataRoot로 실행되고 제거 뒤 설정과 데이터를 보존한다", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "gongpil-installer-test-"));
  const installRoot = join(testRoot, "installed", "Gongpil");
  const localAppData = join(testRoot, "local-app-data");
  const dataRoot = join(testRoot, "selected-data-root");
  const legacySettingsPath = join(localAppData, "Gongpil", "client-settings.json");
  const settingsPath = join(testRoot, "installed", "GongpilConfig", "client-settings.json");
  const environment = CreateIsolatedEnvironment(localAppData);

  try {
    Install(installRoot, join(testRoot, "install-1.log"), environment);
    await AssertInstalledLayout(installRoot);
    await mkdir(join(localAppData, "Gongpil"), { recursive: true });
    await writeFile(legacySettingsPath, JSON.stringify({
      schemaVersion: 1,
      dataRoot,
      showConnectorOnStartup: false,
    }), "utf8");

    const firstRun = StartInstalledClient(installRoot, environment);
    try {
      const session = await OpenBrowserSession(firstRun.ReadStdout);
      const projectResult = await SendCommand(session, "project.create", { name: "설치형 검증" });
      assert.equal(projectResult.state, "succeeded");
      const projectId = projectResult.payload.project.projectId;
      const documentResult = await SendCommand(session, "document.create", {
        projectId,
        path: "설치검증.md",
        content: "제거 뒤에도 보존할 데이터",
      });
      assert.equal(documentResult.state, "succeeded");
      await SendCommand(session, "system.shutdown.request", {});
      assert.equal(await firstRun.WaitForExit(), 0, firstRun.ReadStderr());
    }
    finally {
      firstRun.Kill();
    }

    const machineBeforeUninstall = JSON.parse(await readFile(join(dataRoot, "machine.json"), "utf8"));
    await assert.rejects(readFile(legacySettingsPath), /ENOENT/);
    Uninstall(installRoot, join(testRoot, "uninstall-1.log"), environment);
    await WaitForMissing(installRoot);
    assert.equal(JSON.parse(await readFile(join(dataRoot, "machine.json"), "utf8")).machineId, machineBeforeUninstall.machineId);
    assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).dataRoot, dataRoot);

    Install(installRoot, join(testRoot, "install-2.log"), environment);
    const secondRun = StartInstalledClient(installRoot, environment);
    try {
      const session = await OpenBrowserSession(secondRun.ReadStdout);
      const projects = await SendCommand(session, "project.list", {});
      assert.equal(projects.payload.projects[0].name, "설치형 검증");
      const opened = await SendCommand(session, "project.open", {
        projectId: projects.payload.projects[0].projectId,
      });
      assert.equal(opened.payload.documents.some((document: { path: string }) => document.path === "설치검증.md"), true);
      await SendCommand(session, "system.shutdown.request", {});
      assert.equal(await secondRun.WaitForExit(), 0, secondRun.ReadStderr());
    }
    finally {
      secondRun.Kill();
    }

    Uninstall(installRoot, join(testRoot, "uninstall-2.log"), environment);
    await WaitForMissing(installRoot);
    await access(join(dataRoot, "machine.json"));
    await access(settingsPath);
  }
  finally {
    await RemoveTreeEventually(testRoot);
  }
});

function Install(installRoot: string, logPath: string, environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(setupPath, [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/SP-",
    "/NOICONS",
    `/DIR=${installRoot}`,
    `/LOG=${logPath}`,
  ], { env: environment, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function Uninstall(installRoot: string, logPath: string, environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(join(installRoot, "unins000.exe"), [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    `/LOG=${logPath}`,
  ], { env: environment, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

async function AssertInstalledLayout(installRoot: string): Promise<void> {
  await Promise.all([
    access(join(installRoot, "runtime", "node.exe")),
    access(join(installRoot, "runtime", "NODE_LICENSE.txt")),
    access(join(installRoot, "client", "src", "client-process.ts")),
    access(join(installRoot, "client", "windows", "GongpilConnector.ps1")),
    access(join(installRoot, "Gongpil.vbs")),
    access(join(installRoot, "Gongpil.cmd")),
    access(join(installRoot, "installed.marker")),
    access(join(installRoot, "unins000.exe")),
  ]);
  assert.match(await readFile(join(installRoot, "Gongpil.vbs"), "utf8"), /WScript\.Arguments/);
  await assert.rejects(() => access(join(installRoot, "portable.marker")));
}

function StartInstalledClient(installRoot: string, environment: NodeJS.ProcessEnv) {
  const runtimePath = join(installRoot, "runtime", "node.exe");
  const childProcess = spawn(runtimePath, [
    join(installRoot, "client", "src", "client-process.ts"),
    "--no-open",
  ], {
    cwd: installRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  childProcess.stdout.on("data", (chunk) => { stdout += chunk; });
  childProcess.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    ReadStdout: () => stdout,
    ReadStderr: () => stderr,
    WaitForExit: () => WaitForExit(childProcess),
    Kill: () => {
      if (childProcess.exitCode === null) {
        childProcess.kill("SIGKILL");
      }
    },
  };
}

function CreateIsolatedEnvironment(localAppData: string): NodeJS.ProcessEnv {
  return {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LOCALAPPDATA: localAppData,
    PATH: "",
  };
}

async function OpenBrowserSession(readOutput: () => string) {
  const deadline = Date.now() + 10_000;
  let launchUrl: string | undefined;
  while (Date.now() < deadline) {
    const match = /인스턴스 시작 주소: (http:\/\/127\.0\.0\.1:\d+\/launch\/[A-Za-z0-9_-]+)/.exec(readOutput());
    if (match !== null) {
      launchUrl = match[1];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(launchUrl, `인스턴스 시작 주소 대기 시간 초과: ${readOutput()}`);
  const launchResponse = await fetch(launchUrl, { redirect: "manual" });
  assert.equal(launchResponse.status, 303);
  return {
    origin: new URL(launchUrl).origin,
    cookie: (launchResponse.headers.get("set-cookie") ?? "").split(";")[0],
  };
}

async function SendCommand(
  session: { origin: string; cookie: string },
  commandName: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`${session.origin}/api/v1/commands/${commandName}`, {
    method: "POST",
    headers: { Cookie: session.cookie, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      protocolVersion: { major: 1, minor: 0 },
      requestId: `request-${crypto.randomUUID()}`,
      commandName,
      payload,
    }),
  });
  assert.equal(response.status, 200);
  return await response.json();
}

async function WaitForMissing(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
    }
    catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`제거 뒤에도 경로가 남았습니다: ${path}`);
}

async function RemoveTreeEventually(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await rm(path, { recursive: true, force: true });
}

function WaitForExit(childProcess: ReturnType<typeof spawn>): Promise<number | null> {
  if (childProcess.exitCode !== null) {
    return Promise.resolve(childProcess.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("설치형 Client 종료 대기 시간 초과")), 10_000);
    childProcess.once("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
}
