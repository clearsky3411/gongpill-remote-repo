import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  type GongpilClientBootstrapConfig,
} from "../../packages/contracts/bootstrap/contracts.ts";
import { GongpilDocumentStore, GongpilDocumentStoreError } from "../../core/src/document-store.ts";
import { GongpilProjectStore } from "../../core/src/project-store.ts";
import { CreateDefaultInstanceLayout } from "../../core/src/instance-layout-store.ts";
import { ResolveBootstrapPaths } from "../../client/src/bootstrap-paths.ts";
import { GongpilClientBootstrap } from "../../client/src/client-bootstrap.ts";
import { GongpilCoreProcessManager } from "../../client/src/core-process-manager.ts";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CORE_ENTRY_PATH = join(APP_ROOT, "core", "src", "core-process.ts");

test("프로젝트와 문서를 생성하고 revision 검사 뒤 원자 저장과 history를 남긴다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-store-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  try {
    await projectStore.Initialize();
    const project = await projectStore.CreateProject("테스트 프로젝트");
    const projects = await projectStore.ListProjects();
    const initialDocuments = await documentStore.ListDocuments(project.projectId);

    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "테스트 프로젝트");
    assert.equal(initialDocuments[0].path, "README.md");

    const created = await documentStore.CreateDocument(
      project.projectId,
      "notes/첫 장.md",
      "첫 문장\r\n",
    );
    const saved = await documentStore.SaveDocument(
      project.projectId,
      created.path,
      created.revision,
      "수정한 첫 문장\r\n두 번째 문장\r\n",
    );

    assert.notEqual(saved.revision, created.revision);
    assert.equal(saved.newline, "crlf");
    assert.equal(saved.content, "수정한 첫 문장\r\n두 번째 문장\r\n");
    const historyFiles = await readdir(join(
      projectStore.GetHistoryRoot(project.projectId),
      created.fileId,
    ));
    assert.equal(historyFiles.some((name) => name.startsWith(created.revision)), true);

    await assert.rejects(
      () => documentStore.SaveDocument(
        project.projectId,
        created.path,
        created.revision,
        "충돌된 저장",
      ),
      (error: unknown) => {
        assert.ok(error instanceof GongpilDocumentStoreError);
        assert.equal(error.code, "REVISION_CONFLICT");
        return true;
      },
    );
    assert.equal((await documentStore.ReadDocument(project.projectId, created.path)).content, saved.content);
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("프로젝트 밖 경로와 Windows 예약 이름을 문서 경계에서 차단한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-boundary-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  try {
    const project = await projectStore.CreateProject("경계 테스트");
    for (const invalidPath of ["../outside.md", "C:/outside.md", "CON.txt", "notes/../../outside.md"]) {
      await assert.rejects(
        () => documentStore.CreateDocument(project.projectId, invalidPath),
        (error: unknown) => {
          assert.ok(error instanceof GongpilDocumentStoreError);
          assert.match(error.code, /^DOCUMENT_(PATH_INVALID|TYPE_UNSUPPORTED)$/);
          return true;
        },
      );
    }
    await assert.rejects(
      () => readFile(join(dataRoot, "outside.md")),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("같은 revision의 동시 저장은 한 요청만 허용한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-concurrency-"));
  const projectStore = new GongpilProjectStore(dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  try {
    const project = await projectStore.CreateProject("동시 저장 테스트");
    const created = await documentStore.CreateDocument(project.projectId, "동시.md", "기준");
    const results = await Promise.allSettled([
      documentStore.SaveDocument(project.projectId, created.path, created.revision, "첫 저장"),
      documentStore.SaveDocument(project.projectId, created.path, created.revision, "둘째 저장"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof GongpilDocumentStoreError);
    assert.equal(rejected[0].reason.code, "REVISION_CONFLICT");
    assert.match(
      (await documentStore.ReadDocument(project.projectId, created.path)).content,
      /^(첫 저장|둘째 저장)$/,
    );
  }
  finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("실제 Core API와 일회용 Browser 쿠키 세션으로 프로젝트·문서를 사용한다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-mvp-e2e-"));
  const manager = new GongpilCoreProcessManager({ coreEntryPath: CORE_ENTRY_PATH });
  const bootstrap = new GongpilClientBootstrap(manager);
  const launchId = "launch-mvp-e2e";
  const sessionId = "session-mvp-e2e";
  const config: GongpilClientBootstrapConfig = {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId,
    sessionId,
    mode: "installed",
    clientVersion: "0.1.0",
    selectedCoreVersion: "0.1.0",
    supportedCoreProtocol: { major: 1, minMinor: 0, maxMinor: 0 },
    paths: ResolveBootstrapPaths({
      mode: "installed",
      sessionId,
      appRoot: APP_ROOT,
      installedDataRoot: dataRoot,
      bundledRuntimePath: process.execPath,
    }),
    activation: { reason: "startup", requireHealthCheck: true },
  };

  try {
    await bootstrap.ActivateCore(config);
    const createProjectResult = await bootstrap.GetNetworkRuntime().Send("project.create", {
      name: "실제 공필 프로젝트",
    });
    assert.equal(createProjectResult.state, "succeeded");
    const project = createProjectResult.payload?.project as { projectId: string; name: string };

    const defaultLayoutResult = await bootstrap.GetNetworkRuntime().Send("instance.layout.read", {});
    assert.equal(defaultLayoutResult.state, "succeeded");
    assert.deepEqual(defaultLayoutResult.payload?.layout.panelOrder, ["projects", "documents", "editor", "co-writer"]);
    const defaultLayout = CreateDefaultInstanceLayout();
    const updateLayoutResult = await bootstrap.GetNetworkRuntime().Send("instance.layout.update", {
      layout: {
        ...defaultLayout,
        panelOrder: ["documents", "projects", "editor", "co-writer"],
        panels: {
          ...defaultLayout.panels,
          "co-writer": { collapsed: true, widthCssPx: 500 },
        },
      },
    });
    assert.equal(updateLayoutResult.state, "succeeded");
    assert.deepEqual(updateLayoutResult.payload?.layout.panels["co-writer"], { collapsed: true, widthCssPx: 500 });
    const invalidLayoutResult = await bootstrap.GetNetworkRuntime().Send("instance.layout.update", {
      layout: { ...defaultLayout, panelOrder: ["projects", "projects", "editor", "co-writer"] },
    });
    assert.equal(invalidLayoutResult.state, "failed");
    assert.equal(invalidLayoutResult.error?.code, "INSTANCE_LAYOUT_INVALID");

    const createDocumentResult = await bootstrap.GetNetworkRuntime().Send("document.create", {
      projectId: project.projectId,
      path: "draft/시작.md",
      content: "공필 실제 저장",
    });
    assert.equal(createDocumentResult.state, "succeeded");
    const documentSnapshot = createDocumentResult.payload?.document as {
      path: string;
      revision: string;
      content: string;
    };
    assert.equal(documentSnapshot.content, "공필 실제 저장");

    const browserSessionResult = await bootstrap.GetNetworkRuntime().Send("browser.session.create", {});
    const launchPath = browserSessionResult.payload?.launchPath;
    assert.equal(typeof launchPath, "string");
    const launchUrl = bootstrap.CreateBrowserLaunchUrl(launchPath as string);
    const launchResponse = await fetch(launchUrl, { redirect: "manual" });
    const sessionCookie = launchResponse.headers.get("set-cookie");

    assert.equal(launchResponse.status, 303);
    assert.equal(launchResponse.headers.get("location"), "/");
    assert.match(sessionCookie ?? "", /gongpil_session=.*HttpOnly.*SameSite=Strict/i);
    assert.equal((await fetch(launchUrl, { redirect: "manual" })).status, 401);

    const origin = new URL(launchUrl).origin;
    const cookieHeader = (sessionCookie ?? "").split(";")[0];
    const shellResponse = await fetch(`${origin}/`, { headers: { Cookie: cookieHeader } });
    const shellHtml = await shellResponse.text();
    assert.equal(shellResponse.status, 200);
    assert.match(shellResponse.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(shellHtml, /<title>공필<\/title>/);
    assert.match(shellHtml, /공동 집필/);
    assert.match(shellHtml, /인스턴스 종료/);
    assert.doesNotMatch(shellHtml, /공필 종료/);
    assert.match(shellHtml, /href="\/favicon\.svg"/);
    assert.doesNotMatch(shellHtml, /127\.0\.0\.1|gongpil_session|token|dataRoot|appRoot/i);
    const faviconResponse = await fetch(`${origin}/favicon.svg`, { headers: { Cookie: cookieHeader } });
    assert.equal(faviconResponse.status, 200);
    assert.equal(faviconResponse.headers.get("content-type"), "image/svg+xml");
    assert.equal((await fetch(`${origin}/`)).status, 401);

    const browserCommandResult = await SendBrowserCommand(
      origin,
      cookieHeader,
      "project.list",
      {},
    );
    assert.equal(browserCommandResult.state, "succeeded");
    assert.equal(browserCommandResult.payload.projects[0].name, "실제 공필 프로젝트");
  }
  finally {
    await bootstrap.Stop();
    assert.deepEqual(manager.GetRunningProcessIds(), []);
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("실제 Client 사용자 진입점이 Browser를 준비하고 종료 요청 뒤 자식 없이 끝난다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "gongpil-client-smoke-"));
  const childProcess = spawn(
    process.execPath,
    [join(APP_ROOT, "client", "src", "client-process.ts"), "--no-open"],
    {
      cwd: APP_ROOT,
      env: { ...process.env, GONGPIL_DATA_ROOT: dataRoot },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  childProcess.stdout.on("data", (chunk) => { stdout += chunk; });
  childProcess.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const launchUrl = await WaitForLaunchUrl(() => stdout);
    const launchResponse = await fetch(launchUrl, { redirect: "manual" });
    const cookieHeader = (launchResponse.headers.get("set-cookie") ?? "").split(";")[0];
    const origin = new URL(launchUrl).origin;
    assert.equal(launchResponse.status, 303);

    const shutdownResult = await SendBrowserCommand(
      origin,
      cookieHeader,
      "instance.shutdown.request",
      {},
    );
    assert.equal(shutdownResult.state, "succeeded");
    const exitCode = await WaitForChildExit(childProcess);
    assert.equal(exitCode, 0, stderr);
    assert.match(stdout, /공필 0\.1\.0/);
  }
  finally {
    if (childProcess.exitCode === null) {
      childProcess.kill("SIGKILL");
    }
    await rm(dataRoot, { recursive: true, force: true });
  }
});

async function SendBrowserCommand(
  origin: string,
  cookieHeader: string,
  commandName: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`${origin}/api/v1/commands/${commandName}`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
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

async function WaitForLaunchUrl(readOutput: () => string): Promise<string> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const match = /인스턴스 시작 주소: (http:\/\/127\.0\.0\.1:\d+\/launch\/[A-Za-z0-9_-]+)/.exec(
      readOutput(),
    );
    if (match !== null) {
      return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`클라이언트 인스턴스 시작 주소 대기 시간 초과: ${readOutput()}`);
}

function WaitForChildExit(childProcess: ReturnType<typeof spawn>): Promise<number | null> {
  if (childProcess.exitCode !== null) {
    return Promise.resolve(childProcess.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Client 종료 대기 시간 초과")), 8_000);
    childProcess.once("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
}
