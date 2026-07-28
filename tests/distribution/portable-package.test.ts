import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const packageRoot = process.env.GONGPIL_PORTABLE_ROOT;
if (packageRoot === undefined) {
  throw new Error("GONGPIL_PORTABLE_ROOT가 필요합니다.");
}

const runtimePath = join(packageRoot, "runtime", "node.exe");
const clientEntryPath = join(packageRoot, "client", "src", "client-process.ts");
const dataRoot = join(packageRoot, "GongpilData");

test("포터블 패키지가 포함 Node만으로 실행되고 앱 옆에 데이터를 보존한다", async () => {
  await rm(dataRoot, { recursive: true, force: true });
  const isolatedEnvironment = {
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LOCALAPPDATA: join(packageRoot, "outside-local-app-data"),
    PATH: "",
  };

  const runtimeVersion = spawnSync(runtimePath, ["--version"], {
    encoding: "utf8",
    env: isolatedEnvironment,
    windowsHide: true,
  });
  assert.equal(runtimeVersion.status, 0, runtimeVersion.stderr);
  assert.equal(runtimeVersion.stdout.trim(), "v24.18.0");
  await Promise.all([
    access(join(packageRoot, "portable.marker")),
    access(join(packageRoot, "Gongpil.cmd")),
    access(join(packageRoot, "Gongpil.vbs")),
    access(join(packageRoot, "runtime", "NODE_LICENSE.txt")),
  ]);

  const firstRun = StartPortableClient(isolatedEnvironment);
  try {
    const session = await OpenBrowserSession(firstRun.ReadStdout);
    const projectResult = await SendCommand(session, "project.create", { name: "포터블 검증" });
    assert.equal(projectResult.state, "succeeded");
    const projectId = projectResult.payload.project.projectId;
    const documentResult = await SendCommand(session, "document.create", {
      projectId,
      path: "검증.md",
      content: "포터블 데이터",
    });
    assert.equal(documentResult.state, "succeeded");
    await SendCommand(session, "system.shutdown.request", {});
    assert.equal(await firstRun.WaitForExit(), 0, firstRun.ReadStderr());
  }
  finally {
    firstRun.Kill();
  }

  const secondRun = StartPortableClient(isolatedEnvironment);
  try {
    const session = await OpenBrowserSession(secondRun.ReadStdout);
    const projects = await SendCommand(session, "project.list", {});
    assert.equal(projects.state, "succeeded");
    assert.equal(projects.payload.projects[0].name, "포터블 검증");
    const opened = await SendCommand(session, "project.open", {
      projectId: projects.payload.projects[0].projectId,
    });
    assert.equal(opened.payload.documents.some((document: { path: string }) => document.path === "검증.md"), true);
    await SendCommand(session, "system.shutdown.request", {});
    assert.equal(await secondRun.WaitForExit(), 0, secondRun.ReadStderr());
  }
  finally {
    secondRun.Kill();
  }

  const machineManifest = JSON.parse(await readFile(join(dataRoot, "machine.json"), "utf8"));
  assert.match(machineManifest.machineId, /^machine-/);
  await assert.rejects(() => access(join(isolatedEnvironment.LOCALAPPDATA, "Gongpil")));
  await rm(dataRoot, { recursive: true, force: true });
});

function StartPortableClient(environment: NodeJS.ProcessEnv) {
  const childProcess = spawn(runtimePath, [clientEntryPath, "--portable", "--no-open"], {
    cwd: packageRoot,
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

async function OpenBrowserSession(readOutput: () => string) {
  const deadline = Date.now() + 10_000;
  let launchUrl: string | undefined;
  while (Date.now() < deadline) {
    const match = /Browser 시작 주소: (http:\/\/127\.0\.0\.1:\d+\/launch\/[A-Za-z0-9_-]+)/.exec(readOutput());
    if (match !== null) {
      launchUrl = match[1];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(launchUrl, `Browser 시작 주소 대기 시간 초과: ${readOutput()}`);
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
    headers: {
      Cookie: session.cookie,
      "Content-Type": "application/json; charset=utf-8",
    },
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

function WaitForExit(childProcess: ReturnType<typeof spawn>): Promise<number | null> {
  if (childProcess.exitCode !== null) {
    return Promise.resolve(childProcess.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("포터블 Client 종료 대기 시간 초과")), 10_000);
    childProcess.once("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
}
