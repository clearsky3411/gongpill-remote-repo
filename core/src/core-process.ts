import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
  ParseClientBootstrapConfig,
  type GongpilClientBootstrapConfig,
  type GongpilCoreReadyInfo,
} from "../../packages/contracts/bootstrap/contracts.ts";
import {
  GongpilLoopbackCommandError,
  GongpilLoopbackHttpHost,
} from "../../platform/network-runtime/src/host/loopback-http-host.ts";
import {
  GongpilOpenAiResponsesAdapter,
  GongpilOpenAiResponsesError,
} from "../../platform/network-runtime/src/external/openai-responses-adapter.ts";
import {
  GongpilChatStore,
  GongpilChatStoreError,
  type GongpilDocumentProposal,
} from "./chat-store.ts";
import {
  GongpilDocumentStore,
  GongpilDocumentStoreError,
} from "./document-store.ts";
import {
  GongpilProjectStore,
  GongpilProjectStoreError,
} from "./project-store.ts";
import { LoadOpenAiConfig } from "./openai-config.ts";

const LOOPBACK_SESSION_TOKEN_ENV = "GONGPIL_LOOPBACK_SESSION_TOKEN";
const CORE_API_VERSION = "1.0.0";

async function RunCoreProcess(): Promise<void> {
  const config = await ReadBootstrapConfig();
  const sessionToken = ReadSessionToken();
  await PrepareSessionDirectories(config);
  const projectStore = new GongpilProjectStore(config.paths.dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  const chatStore = new GongpilChatStore(config.paths.dataRoot);
  const openAiConfig = await LoadOpenAiConfig();
  const openAiAdapter = new GongpilOpenAiResponsesAdapter();
  await projectStore.Initialize();

  const host = new GongpilLoopbackHttpHost({
    profileId: `core.${config.launchId}`,
    sessionToken,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
    browserAssetsRoot: join(config.paths.appRoot, "browser", "src"),
    browserNetworkRuntimePath: join(
      config.paths.appRoot,
      "platform",
      "network-runtime",
      "browser",
      "network-runtime.js",
    ),
  });
  host.RegisterCommand("system.health.read", () => ({
    status: "ready",
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
  }));
  host.RegisterCommand("system.readiness.verify", () => ({
    ready: true,
    launchId: config.launchId,
    sessionId: config.sessionId,
  }));
  host.RegisterCommand("browser.session.create", () => ({
    launchPath: host.CreateBrowserLaunchPath(),
  }));
  host.RegisterCommand("project.list", async () => ({
    projects: await projectStore.ListProjects(),
  }));
  host.RegisterCommand("project.create", async (payload) => {
    try {
      const project = await projectStore.CreateProject(RequireString(payload, "name"));
      host.Publish("project.changed", { projectId: project.projectId, change: "created" });
      return { project };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("project.open", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const [project, documents] = await Promise.all([
        projectStore.GetProject(projectId),
        documentStore.ListDocuments(projectId),
      ]);
      return { project, documents };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.list", async (payload) => {
    try {
      return {
        documents: await documentStore.ListDocuments(RequireString(payload, "projectId")),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.read", async (payload) => {
    try {
      return {
        document: await documentStore.ReadDocument(
          RequireString(payload, "projectId"),
          RequireString(payload, "path"),
        ),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.create", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const document = await documentStore.CreateDocument(
        projectId,
        RequireString(payload, "path"),
        OptionalString(payload, "content") ?? "",
      );
      host.Publish("document.changed", {
        projectId,
        path: document.path,
        revision: document.revision,
        change: "created",
      });
      return { document };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("document.save", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const document = await documentStore.SaveDocument(
        projectId,
        RequireString(payload, "path"),
        RequireString(payload, "expectedRevision"),
        RequireString(payload, "content", true),
      );
      host.Publish("document.changed", {
        projectId,
        path: document.path,
        revision: document.revision,
        change: "saved",
      });
      return { document };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.session.read", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return { session: await chatStore.ReadSession(projectId), configured: openAiConfig !== undefined };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.message.send", async (payload, context) => {
    try {
      if (openAiConfig === undefined) {
        throw new GongpilLoopbackCommandError(
          "AI_NOT_CONFIGURED",
          "클라이언트 설정에서 OpenAI API 환경파일을 선택하세요.",
        );
      }
      const projectId = RequireString(payload, "projectId");
      const userText = RequireString(payload, "message");
      if (userText.length > 20_000) {
        throw new GongpilLoopbackCommandError("CHAT_MESSAGE_TOO_LARGE", "메시지는 20,000자 이하여야 합니다.");
      }
      const project = await projectStore.GetProject(projectId);
      const documentPath = OptionalString(payload, "documentPath");
      const document = documentPath === undefined
        ? undefined
        : await documentStore.ReadDocument(projectId, documentPath);
      const userMessage = await chatStore.AppendMessage(projectId, "user", userText);
      const response = await openAiAdapter.CreateResponse({
        ...openAiConfig,
        instructions: CreateWritingInstructions(),
        input: CreateWritingInput(project.name, userText, document),
        signal: context.signal,
        onTextDelta: (delta) => host.Publish("chat.message.delta", {
          projectId,
          requestId: context.requestId,
          delta,
        }, context.requestId),
      });
      const proposal = await CreateProposalFromToolCall(
        chatStore,
        documentStore,
        projectId,
        document,
        response.toolCalls,
      );
      const assistantText = response.text.trim()
        || (proposal === undefined ? "요청을 검토했지만 답변을 만들지 못했습니다." : proposal.summary);
      const assistantMessage = await chatStore.AppendMessage(projectId, "assistant", assistantText);
      if (proposal !== undefined) {
        host.Publish("proposal.created", { projectId, proposal }, context.requestId);
      }
      host.Publish("chat.message.completed", {
        projectId,
        requestId: context.requestId,
        message: assistantMessage,
      }, context.requestId);
      return { userMessage, message: assistantMessage, proposal };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("proposal.apply", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const proposalId = RequireString(payload, "proposalId");
      const proposal = await chatStore.GetProposal(projectId, proposalId);
      if (proposal.status !== "pending") {
        throw new GongpilChatStoreError("PROPOSAL_ALREADY_RESOLVED", "이미 처리된 변경 제안입니다.");
      }
      const document = proposal.action === "create"
        ? await documentStore.CreateDocument(projectId, proposal.path, proposal.proposedContent)
        : await documentStore.SaveDocument(
          projectId,
          proposal.path,
          proposal.expectedRevision ?? "",
          proposal.proposedContent,
        );
      const resolvedProposal = await chatStore.ResolveProposal(projectId, proposalId, "applied");
      host.Publish("document.changed", {
        projectId,
        path: document.path,
        revision: document.revision,
        change: proposal.action === "create" ? "created" : "saved",
      });
      host.Publish("proposal.applied", { projectId, proposal: resolvedProposal });
      return { proposal: resolvedProposal, document };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("proposal.reject", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const proposal = await chatStore.ResolveProposal(
        projectId,
        RequireString(payload, "proposalId"),
        "rejected",
      );
      host.Publish("proposal.rejected", { projectId, proposal });
      return { proposal };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("system.shutdown.request", () => {
    const shutdownTimer = setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
    shutdownTimer.unref();
    return { accepted: true };
  });

  const networkProfile = await host.Start();
  const readyInfo: GongpilCoreReadyInfo = {
    protocolVersion: GONGPIL_BOOTSTRAP_PROTOCOL_VERSION,
    launchId: config.launchId,
    sessionId: config.sessionId,
    coreVersion: config.selectedCoreVersion,
    coreApiVersion: CORE_API_VERSION,
    health: "ready",
    networkProfile,
    capabilities: [
      "system.health.read",
      "system.readiness.verify",
      "browser.session.create",
      "project.list",
      "project.create",
      "project.open",
      "document.list",
      "document.read",
      "document.create",
      "document.save",
      "chat.session.read",
      "chat.message.send",
      "proposal.apply",
      "proposal.reject",
      "system.shutdown.request",
    ],
  };

  await WriteReadyInfo(readyInfo);
  InstallShutdownHandlers(host);
}

async function ReadBootstrapConfig(): Promise<GongpilClientBootstrapConfig> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      if (line.trim().length === 0) {
        continue;
      }
      const config = ParseClientBootstrapConfig(JSON.parse(line));
      if (config.protocolVersion.major !== GONGPIL_BOOTSTRAP_PROTOCOL_VERSION.major) {
        throw new Error("BOOTSTRAP_PROTOCOL_INCOMPATIBLE");
      }
      return config;
    }
  }
  finally {
    input.close();
  }
  throw new Error("BOOTSTRAP_CONFIG_MISSING");
}

function ReadSessionToken(): string {
  const sessionToken = process.env[LOOPBACK_SESSION_TOKEN_ENV];
  if (sessionToken === undefined || sessionToken.length < 16) {
    throw new Error("LOOPBACK_SESSION_TOKEN_MISSING");
  }
  return sessionToken;
}

function RequireString(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
  allowEmpty = false,
): string {
  const value = payload[fieldName];
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new GongpilLoopbackCommandError(
      "INVALID_COMMAND_PAYLOAD",
      `${fieldName} 값이 올바르지 않습니다.`,
    );
  }
  return value;
}

function OptionalString(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
): string | undefined {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new GongpilLoopbackCommandError(
      "INVALID_COMMAND_PAYLOAD",
      `${fieldName} 값이 올바르지 않습니다.`,
    );
  }
  return value;
}

function NormalizeDomainError(error: unknown): GongpilLoopbackCommandError {
  if (error instanceof GongpilLoopbackCommandError) {
    return error;
  }
  if (error instanceof GongpilDocumentStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message, error.retryable);
  }
  if (error instanceof GongpilProjectStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilChatStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilOpenAiResponsesError) {
    return new GongpilLoopbackCommandError(error.code, error.message, error.retryable);
  }
  return new GongpilLoopbackCommandError(
    "CORE_OPERATION_FAILED",
    "Core가 요청을 처리하지 못했습니다.",
    true,
  );
}

function CreateWritingInstructions(): string {
  return [
    "당신은 공필의 한국어 공동 집필 파트너다.",
    "사용자의 질문에는 자연스러운 한국어로 답한다.",
    "문서를 실제로 추가하거나 고치라는 요청이면 propose_document 도구로 변경안을 만든다.",
    "도구는 사용자 승인을 위한 제안일 뿐이며 적용됐다고 말하지 않는다.",
    "선택 문서를 고칠 때 action은 replace이고 path는 선택 문서 경로를 그대로 사용한다.",
    "새 문서를 만들 때 action은 create이고 지원 확장자 md, markdown, txt, json 중 하나를 사용한다.",
  ].join("\n");
}

function CreateWritingInput(
  projectName: string,
  userText: string,
  document?: { path: string; revision: string; content: string },
): string {
  const context = document === undefined
    ? "선택된 문서 없음"
    : `선택 문서: ${document.path}\nrevision: ${document.revision}\n--- 문서 시작 ---\n${document.content}\n--- 문서 끝 ---`;
  return `프로젝트: ${projectName}\n${context}\n\n사용자 요청:\n${userText}`;
}

async function CreateProposalFromToolCall(
  chatStore: GongpilChatStore,
  documentStore: GongpilDocumentStore,
  projectId: string,
  selectedDocument: { path: string; revision: string; content: string } | undefined,
  toolCalls: ReadonlyArray<{ name: string; arguments: string }>,
): Promise<GongpilDocumentProposal | undefined> {
  const toolCall = toolCalls.find((candidate) => candidate.name === "propose_document");
  if (toolCall === undefined) {
    return undefined;
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  }
  catch {
    throw new GongpilLoopbackCommandError("AI_PROPOSAL_INVALID", "AI 변경 제안 형식이 올바르지 않습니다.", true);
  }
  const action = value.action;
  const proposedPath = value.path;
  const content = value.content;
  const summary = value.summary;
  if ((action !== "create" && action !== "replace")
    || typeof proposedPath !== "string"
    || typeof content !== "string"
    || typeof summary !== "string") {
    throw new GongpilLoopbackCommandError("AI_PROPOSAL_INVALID", "AI 변경 제안 형식이 올바르지 않습니다.", true);
  }
  if (action === "replace" && selectedDocument === undefined) {
    throw new GongpilLoopbackCommandError("AI_PROPOSAL_DOCUMENT_REQUIRED", "문서 수정 제안에는 선택된 문서가 필요합니다.");
  }
  const path = action === "replace" ? selectedDocument!.path : proposedPath;
  if (action === "create") {
    try {
      await documentStore.ReadDocument(projectId, path);
      throw new GongpilLoopbackCommandError("DOCUMENT_ALREADY_EXISTS", "새 문서 제안 경로에 이미 문서가 있습니다.");
    }
    catch (error) {
      if (error instanceof GongpilDocumentStoreError && error.code === "DOCUMENT_NOT_FOUND") {
        // Expected: creation proposals must target a new logical path.
      }
      else {
        throw error;
      }
    }
  }
  return await chatStore.CreateProposal(projectId, {
    action,
    path,
    summary: summary.trim() || "AI 문서 변경 제안",
    beforeContent: selectedDocument?.content ?? "",
    proposedContent: content,
    expectedRevision: action === "replace" ? selectedDocument?.revision : undefined,
  });
}

async function PrepareSessionDirectories(config: GongpilClientBootstrapConfig): Promise<void> {
  await Promise.all([
    mkdir(config.paths.dataRoot, { recursive: true }),
    mkdir(config.paths.versionRoot, { recursive: true }),
    mkdir(config.paths.sessionTemp, { recursive: true }),
  ]);
}

function WriteReadyInfo(readyInfo: GongpilCoreReadyInfo): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(readyInfo)}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      }
      else {
        reject(error);
      }
    });
  });
}

function InstallShutdownHandlers(host: GongpilLoopbackHttpHost): void {
  let stopping = false;
  const parentProcessId = process.ppid;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(parentMonitor);
    try {
      await host.Stop();
    }
    finally {
      process.exit(0);
    }
  };

  const parentMonitor = setInterval(() => {
    try {
      process.kill(parentProcessId, 0);
    }
    catch {
      void stop();
    }
  }, 2_000);
  parentMonitor.unref();

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

RunCoreProcess().catch(() => {
  process.stderr.write(`${JSON.stringify({
    code: "CORE_START_FAILED",
    userMessage: "Core 시작 경계를 검증하지 못했습니다.",
    retryable: false,
  })}\n`);
  process.exitCode = 1;
});
