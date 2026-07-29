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
  type GongpilChatClassification,
  type GongpilDocumentProposal,
} from "./chat-store.ts";
import {
  CreateChatHistoryIndex,
  GongpilChatHistoryContextError,
  ResolveChatHistorySelection,
  type GongpilChatHistoryChunk,
} from "./chat-history-context.ts";
import {
  GongpilDocumentStore,
  GongpilDocumentStoreError,
} from "./document-store.ts";
import {
  GongpilProjectStore,
  GongpilProjectStoreError,
} from "./project-store.ts";
import { LoadOpenAiConfig } from "./openai-config.ts";
import {
  GongpilCodexAppServerClient,
  GongpilCodexAppServerError,
  type GongpilCodexUsage,
} from "./codex-app-server-client.ts";
import { GongpilDiagnosticLogStore } from "./diagnostic-log-store.ts";
import {
  GongpilChunkIndexStore,
  GongpilChunkIndexStoreError,
} from "./chunk-index-store.ts";
import {
  GongpilPersonaStore,
  GongpilPersonaStoreError,
} from "./persona-store.ts";
import { BuildWritingContext } from "./context-builder.ts";
import { GongpilBrowserPresenceMonitor } from "./browser-presence-monitor.ts";
import {
  GongpilInstanceLayoutStore,
  GongpilInstanceLayoutStoreError,
} from "./instance-layout-store.ts";

const LOOPBACK_SESSION_TOKEN_ENV = "GONGPIL_LOOPBACK_SESSION_TOKEN";
const CORE_API_VERSION = "1.0.0";
const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/models/compare";

interface GongpilObservedUsage extends GongpilCodexUsage {
  estimatedCostUsd?: number;
  pricingLabel: "chatgpt-subscription" | "openai-standard-estimate" | "pricing-unavailable";
  pricingSource?: string;
}

async function RunCoreProcess(): Promise<void> {
  const config = await ReadBootstrapConfig();
  const sessionToken = ReadSessionToken();
  await PrepareSessionDirectories(config);
  const projectStore = new GongpilProjectStore(config.paths.dataRoot);
  const documentStore = new GongpilDocumentStore(projectStore);
  const chunkIndexStore = new GongpilChunkIndexStore(config.paths.dataRoot, documentStore);
  const chatStore = new GongpilChatStore(config.paths.dataRoot);
  const personaStore = new GongpilPersonaStore(config.paths.dataRoot);
  const instanceLayoutStore = new GongpilInstanceLayoutStore(config.paths.dataRoot);
  const openAiConfig = await LoadOpenAiConfig();
  const openAiAdapter = new GongpilOpenAiResponsesAdapter();
  const providerKind = ResolveProviderKind(openAiConfig !== undefined);
  const diagnosticLogs = new GongpilDiagnosticLogStore(config.paths.dataRoot);
  const codexExecutable = process.env.GONGPIL_CODEX_EXECUTABLE;
  const codexClient = codexExecutable === undefined || codexExecutable.trim().length === 0
    ? undefined
    : new GongpilCodexAppServerClient({
      executablePath: codexExecutable,
      codexHome: join(config.paths.dataRoot, "integrations", "codex"),
      workspaceRoot: join(config.paths.dataRoot, "integrations", "codex", "workspace"),
      model: process.env.GONGPIL_CODEX_MODEL ?? "gpt-5.6-terra",
    });
  let latestUsage: GongpilObservedUsage | undefined;
  await projectStore.Initialize();
  await diagnosticLogs.Append({
    level: "info",
    source: "core",
    code: "CORE_STARTED",
    message: "Core가 시작되었습니다.",
    details: { provider: providerKind },
  });

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
  let shutdownInstance: (() => Promise<void>) | undefined;
  let shutdownRequested = false;
  const requestInstanceShutdown = (): { accepted: true } => {
    if (shutdownRequested) {
      return { accepted: true };
    }
    shutdownRequested = true;
    const shutdownTimer = setTimeout(() => {
      if (shutdownInstance === undefined) {
        process.kill(process.pid, "SIGTERM");
        return;
      }
      void shutdownInstance();
    }, 100);
    shutdownTimer.unref();
    return { accepted: true };
  };
  const browserPresence = new GongpilBrowserPresenceMonitor({
    leaseTimeoutMs: ReadDurationEnvironment("GONGPIL_BROWSER_PRESENCE_TIMEOUT_MS", 30_000),
    startupGraceMs: ReadDurationEnvironment("GONGPIL_BROWSER_STARTUP_GRACE_MS", 60_000),
    resumeDelayToleranceMs: ReadDurationEnvironment("GONGPIL_BROWSER_RESUME_TOLERANCE_MS", 5_000, true),
    onExpired: () => {
      void diagnosticLogs.Append({
        level: "info",
        source: "core",
        code: "BROWSER_PRESENCE_EXPIRED",
        message: "Browser 생존 응답이 끊겨 Instance Runtime을 종료합니다.",
      }).catch(() => undefined).then(() => requestInstanceShutdown());
    },
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
  host.RegisterCommand("browser.session.create", () => {
    browserPresence.Start();
    return { launchPath: host.CreateBrowserLaunchPath() };
  });
  host.RegisterCommand("browser.presence.ack", (payload) => (
    browserPresence.Acknowledge(RequireString(payload, "heartbeatId"))
  ));
  host.RegisterCommand("ai.provider.status", async () => ({
    status: await ReadProviderStatus(providerKind, codexClient, openAiConfig),
  }));
  host.RegisterCommand("ai.provider.login.start", async () => {
    if (providerKind !== "codex" || codexClient === undefined) {
      throw new GongpilLoopbackCommandError(
        "CODEX_NOT_CONFIGURED",
        "클라이언트 설정에서 Codex 실행 파일을 선택하세요.",
      );
    }
    return await codexClient.StartLogin();
  });
  host.RegisterCommand("ai.usage.read", async () => ({
    provider: providerKind,
    latest: latestUsage,
    status: await ReadProviderStatus(providerKind, codexClient, openAiConfig),
  }));
  host.RegisterCommand("diagnostics.logs.read", async (payload) => ({
    entries: await diagnosticLogs.Read(OptionalNumber(payload, "limit") ?? 200),
  }));
  host.RegisterCommand("instance.layout.read", async () => {
    try {
      return { layout: await instanceLayoutStore.Read() };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("instance.layout.update", async (payload) => {
    try {
      return { layout: await instanceLayoutStore.Update(payload.layout) };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
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
      await chunkIndexStore.UpdateDocument(projectId, document);
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
      await chunkIndexStore.UpdateDocument(projectId, document);
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
  host.RegisterCommand("chunk.list", async (payload) => {
    try {
      return {
        chunks: await chunkIndexStore.List(
          RequireString(payload, "projectId"),
          OptionalString(payload, "documentPath"),
        ),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chunk.search", async (payload) => {
    try {
      return {
        results: await chunkIndexStore.Search(
          RequireString(payload, "projectId"),
          RequireString(payload, "query", true),
          {
            documentPaths: OptionalStringArray(payload, "documentPaths", 100),
            limit: OptionalNumber(payload, "limit"),
          },
        ),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("persona.workspace.read", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return { workspace: await personaStore.ReadWorkspace(projectId) };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("persona.version.create", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return {
        workspace: await personaStore.CreateVersion(projectId, {
          personaId: OptionalString(payload, "personaId"),
          name: RequireString(payload, "name"),
          systemInstructions: RequireString(payload, "systemInstructions"),
          workStyle: OptionalString(payload, "workStyle"),
          styleGuide: OptionalString(payload, "styleGuide"),
          forbiddenExpressions: OptionalStringArray(payload, "forbiddenExpressions", 100),
          referencePriorities: OptionalStringArray(payload, "referencePriorities", 100),
        }),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("persona.profile.save", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return {
        workspace: await personaStore.SaveProfile(projectId, {
          profileId: OptionalString(payload, "profileId"),
          name: RequireString(payload, "name"),
          instructions: OptionalString(payload, "instructions"),
          contextTokenBudget: OptionalNumber(payload, "contextTokenBudget") ?? 32_000,
        }),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("persona.selection.update", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return {
        workspace: await personaStore.UpdateSelection(projectId, {
          personaId: OptionalString(payload, "personaId"),
          versionId: OptionalString(payload, "versionId"),
          profileId: OptionalString(payload, "profileId"),
        }),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.session.read", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      const status = await ReadProviderStatus(providerKind, codexClient, openAiConfig);
      return {
        session: await chatStore.ReadSession(projectId),
        configured: status.configured,
        provider: status,
        usage: latestUsage,
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.history.list", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      const session = await chatStore.ReadSession(projectId);
      return {
        history: CreateChatHistoryIndex(session.messages, {
          maxMessages: OptionalNumber(payload, "maxMessages"),
        }),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.message.classification.update", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      await projectStore.GetProject(projectId);
      return {
        message: await chatStore.UpdateMessageClassification(
          projectId,
          RequireString(payload, "messageId"),
          RequireClassification(payload),
        ),
      };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.context.preview", async (payload) => {
    try {
      const projectId = RequireString(payload, "projectId");
      const project = await projectStore.GetProject(projectId);
      const documentPath = OptionalString(payload, "documentPath");
      const document = documentPath === undefined
        ? undefined
        : await documentStore.ReadDocument(projectId, documentPath);
      const chunkIds = OptionalStringArray(payload, "chunkIds", 50) ?? [];
      const selectedChunks = chunkIds.length === 0
        ? []
        : await chunkIndexStore.Resolve(projectId, chunkIds);
      const session = await chatStore.ReadSession(projectId);
      const history = CreateChatHistoryIndex(session.messages);
      const selectedHistoryChunks = ResolveChatHistorySelection(history, {
        chunkIds: OptionalStringArray(payload, "historyChunkIds", 500),
        turnIds: OptionalStringArray(payload, "historyTurnIds", 200),
        recentTurnCount: OptionalNumber(payload, "recentTurnCount"),
      });
      ValidateContextByteLimit(selectedChunks, selectedHistoryChunks);
      const activePersona = await personaStore.GetActiveContext(projectId);
      const writingContext = BuildWritingContext({
        baseInstructions: CreateWritingInstructions(),
        projectName: project.name,
        userText: OptionalString(payload, "message") ?? "컨텍스트 미리보기",
        activePersona,
        selectedChunks,
        selectedHistoryChunks,
        activeDocument: document,
      });
      return { snapshot: writingContext.snapshot };
    }
    catch (error) {
      throw NormalizeDomainError(error);
    }
  });
  host.RegisterCommand("chat.message.send", async (payload, context) => {
    try {
      if (providerKind === "openai-api" && openAiConfig === undefined) {
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
      const chunkIds = OptionalStringArray(payload, "chunkIds", 50) ?? [];
      const selectedChunks = chunkIds.length === 0
        ? []
        : await chunkIndexStore.Resolve(projectId, chunkIds);
      const session = await chatStore.ReadSession(projectId);
      const history = CreateChatHistoryIndex(session.messages);
      const selectedHistoryChunks = ResolveChatHistorySelection(history, {
        chunkIds: OptionalStringArray(payload, "historyChunkIds", 500),
        turnIds: OptionalStringArray(payload, "historyTurnIds", 200),
        recentTurnCount: OptionalNumber(payload, "recentTurnCount"),
      });
      ValidateContextByteLimit(selectedChunks, selectedHistoryChunks);
      const activePersona = await personaStore.GetActiveContext(projectId);
      const writingContext = BuildWritingContext({
        baseInstructions: CreateWritingInstructions(),
        projectName: project.name,
        userText,
        activePersona,
        selectedChunks,
        selectedHistoryChunks,
        activeDocument: document,
      });
      const userMessage = await chatStore.AppendMessage(projectId, "user", userText, {
        contextSnapshot: writingContext.snapshot,
      });
      const startedAt = Date.now();
      const response = providerKind === "codex"
        ? await GenerateWithCodex(
          codexClient,
          writingContext.instructions,
          writingContext.input,
          context.signal,
        )
        : await openAiAdapter.CreateResponse({
          ...openAiConfig!,
          instructions: writingContext.instructions,
          input: writingContext.input,
          signal: context.signal,
          onTextDelta: (delta) => host.Publish("chat.message.delta", {
            projectId,
            requestId: context.requestId,
            delta,
          }, context.requestId),
        });
      latestUsage = ObserveUsage(
        providerKind,
        providerKind === "codex"
          ? process.env.GONGPIL_CODEX_MODEL ?? "gpt-5.6-terra"
          : openAiConfig!.model,
        response.usage,
      );
      const proposal = await CreateProposalFromToolCall(
        chatStore,
        documentStore,
        projectId,
        document,
        response.toolCalls,
      );
      const assistantText = response.text.trim()
        || (proposal === undefined ? "요청을 검토했지만 답변을 만들지 못했습니다." : proposal.summary);
      const assistantMessage = await chatStore.AppendMessage(projectId, "assistant", assistantText, {
        inReplyToMessageId: userMessage.messageId,
      });
      if (providerKind === "codex") {
        host.Publish("chat.message.delta", {
          projectId,
          requestId: context.requestId,
          delta: assistantText,
        }, context.requestId);
      }
      await diagnosticLogs.Append({
        level: "info",
        source: providerKind === "codex" ? "codex" : "openai-api",
        code: "AI_REQUEST_COMPLETED",
        message: "AI 공동 집필 요청을 완료했습니다.",
        requestId: context.requestId,
        details: {
          provider: providerKind,
          model: providerKind === "codex"
            ? process.env.GONGPIL_CODEX_MODEL ?? "gpt-5.6-terra"
            : openAiConfig!.model,
          durationMs: Date.now() - startedAt,
          inputTokens: latestUsage?.inputTokens ?? 0,
          cachedInputTokens: latestUsage?.cachedInputTokens ?? 0,
          outputTokens: latestUsage?.outputTokens ?? 0,
          personaVersion: writingContext.snapshot.persona.version,
          contextSources: writingContext.snapshot.includedSourceCount,
          contextOmitted: writingContext.snapshot.omittedSourceCount,
          reasoningOutputTokens: latestUsage?.reasoningOutputTokens ?? 0,
        },
      });
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
      await diagnosticLogs.Append({
        level: "error",
        source: providerKind === "codex" ? "codex" : "openai-api",
        code: ReadErrorCode(error),
        message: error instanceof Error ? error.message : "AI 요청이 실패했습니다.",
        requestId: context.requestId,
        details: { provider: providerKind },
      });
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
      await chunkIndexStore.UpdateDocument(projectId, document);
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
  host.RegisterCommand("instance.shutdown.request", requestInstanceShutdown);
  host.RegisterCommand("system.shutdown.request", requestInstanceShutdown);

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
      "browser.presence.ack",
      "ai.provider.status",
      "ai.provider.login.start",
      "ai.usage.read",
      "diagnostics.logs.read",
      "instance.layout.read",
      "instance.layout.update",
      "project.list",
      "project.create",
      "project.open",
      "document.list",
      "document.read",
      "document.create",
      "document.save",
      "chunk.list",
      "chunk.search",
      "persona.workspace.read",
      "persona.version.create",
      "persona.profile.save",
      "persona.selection.update",
      "chat.session.read",
      "chat.message.send",
      "proposal.apply",
      "proposal.reject",
      "instance.shutdown.request",
      "system.shutdown.request",
    ],
  };

  await WriteReadyInfo(readyInfo);
  shutdownInstance = InstallShutdownHandlers(host, async () => {
    browserPresence.Stop();
    await codexClient?.Stop();
  });
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

function ReadDurationEnvironment(name: string, fallback: number, allowZero = false): number {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }
  const value = Number(rawValue);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 300_000) {
    throw new Error(`${name} 값이 올바르지 않습니다.`);
  }
  return value;
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

function OptionalNumber(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
): number | undefined {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GongpilLoopbackCommandError("INVALID_COMMAND_PAYLOAD", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return value;
}

function OptionalStringArray(
  payload: Readonly<Record<string, unknown>>,
  fieldName: string,
  maxItems: number,
): string[] | undefined {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => (
    typeof item !== "string" || item.length < 1 || item.length > 512
  ))) {
    throw new GongpilLoopbackCommandError("INVALID_COMMAND_PAYLOAD", `${fieldName} 값이 올바르지 않습니다.`);
  }
  return [...new Set(value)];
}

function RequireClassification(
  payload: Readonly<Record<string, unknown>>,
): GongpilChatClassification {
  const value = payload.classification;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GongpilLoopbackCommandError(
      "INVALID_COMMAND_PAYLOAD",
      "classification 값이 올바르지 않습니다.",
    );
  }
  const classification = value as Readonly<Record<string, unknown>>;
  return {
    topic: OptionalString(classification, "topic"),
    task: OptionalString(classification, "task"),
    session: OptionalString(classification, "session"),
    labels: OptionalStringArray(classification, "labels", 20),
  };
}

function ValidateContextByteLimit(
  selectedChunks: ReadonlyArray<{ content: string }>,
  selectedHistoryChunks: readonly GongpilChatHistoryChunk[],
): void {
  const selectedBytes = [...selectedChunks, ...selectedHistoryChunks].reduce(
    (total, chunk) => total + Buffer.byteLength(chunk.content, "utf8"),
    0,
  );
  if (selectedBytes > 1024 * 1024) {
    throw new GongpilLoopbackCommandError(
      "CONTEXT_SELECTION_TOO_LARGE",
      "선택한 문서와 이전 대화 청크는 합계 1MB 이하여야 합니다.",
    );
  }
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
  if (error instanceof GongpilChatHistoryContextError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilOpenAiResponsesError) {
    return new GongpilLoopbackCommandError(error.code, error.message, error.retryable);
  }
  if (error instanceof GongpilCodexAppServerError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilChunkIndexStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilPersonaStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
  }
  if (error instanceof GongpilInstanceLayoutStoreError) {
    return new GongpilLoopbackCommandError(error.code, error.message);
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
    "문서를 실제로 추가하거나 고치라는 요청이면 제공된 proposal 구조 또는 propose_document 도구로 변경안을 만든다.",
    "도구는 사용자 승인을 위한 제안일 뿐이며 적용됐다고 말하지 않는다.",
    "선택 문서를 고칠 때 action은 replace이고 path는 선택 문서 경로를 그대로 사용한다.",
    "새 문서를 만들 때 action은 create이고 지원 확장자 md, markdown, txt, json 중 하나를 사용한다.",
  ].join("\n");
}

function ResolveProviderKind(hasOpenAiConfig: boolean): "codex" | "openai-api" {
  const configured = process.env.GONGPIL_AI_PROVIDER;
  if (configured === "codex" || configured === "openai-api") {
    return configured;
  }
  return hasOpenAiConfig ? "openai-api" : "codex";
}

async function ReadProviderStatus(
  providerKind: "codex" | "openai-api",
  codexClient: GongpilCodexAppServerClient | undefined,
  openAiConfig: { model: string } | undefined,
): Promise<Record<string, unknown>> {
  if (providerKind === "openai-api") {
    return {
      provider: "openai-api",
      configured: openAiConfig !== undefined,
      model: openAiConfig?.model ?? process.env.GONGPIL_OPENAI_MODEL ?? "gpt-5.6-terra",
      billing: "separate-api",
      message: openAiConfig === undefined ? "OpenAI API 환경파일을 선택하세요." : undefined,
    };
  }
  if (codexClient === undefined) {
    return {
      provider: "codex",
      configured: false,
      model: process.env.GONGPIL_CODEX_MODEL ?? "gpt-5.6-terra",
      billing: "chatgpt-subscription",
      message: "Codex 실행 파일을 찾지 못했습니다. 접속기 설정에서 선택하세요.",
    };
  }
  return { ...(await codexClient.GetStatus()), billing: "chatgpt-subscription" };
}

async function GenerateWithCodex(
  codexClient: GongpilCodexAppServerClient | undefined,
  instructions: string,
  input: string,
  signal: AbortSignal,
): Promise<{
  text: string;
  toolCalls: Array<{ name: string; arguments: string }>;
  usage?: GongpilCodexUsage;
}> {
  if (codexClient === undefined) {
    throw new GongpilLoopbackCommandError(
      "CODEX_NOT_CONFIGURED",
      "Codex 실행 파일을 찾지 못했습니다. 접속기 설정에서 선택하세요.",
    );
  }
  const response = await codexClient.Generate({ instructions, input, signal });
  return {
    text: response.text,
    usage: response.usage,
    toolCalls: response.proposal === undefined
      ? []
      : [{ name: "propose_document", arguments: JSON.stringify(response.proposal) }],
  };
}

function ReadErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "AI_REQUEST_FAILED";
}

function ObserveUsage(
  providerKind: "codex" | "openai-api",
  model: string,
  usage: GongpilCodexUsage | undefined,
): GongpilObservedUsage | undefined {
  if (usage === undefined) {
    return undefined;
  }
  if (providerKind === "codex") {
    return { ...usage, pricingLabel: "chatgpt-subscription" };
  }
  const rates = OPENAI_STANDARD_RATES[model];
  if (rates === undefined) {
    return { ...usage, pricingLabel: "pricing-unavailable", pricingSource: OPENAI_PRICING_SOURCE };
  }
  const longContext = usage.inputTokens > 272_000;
  const cachedTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncachedTokens = usage.inputTokens - cachedTokens;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const estimatedCostUsd = (
    ((uncachedTokens * rates.input) + (cachedTokens * rates.cached)) * inputMultiplier
    + (usage.outputTokens * rates.output * outputMultiplier)
  ) / 1_000_000;
  return {
    ...usage,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    pricingLabel: "openai-standard-estimate",
    pricingSource: OPENAI_PRICING_SOURCE,
  };
}

const OPENAI_STANDARD_RATES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.6-sol": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.6-luna": { input: 1, cached: 0.1, output: 6 },
};

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

function InstallShutdownHandlers(
  host: GongpilLoopbackHttpHost,
  cleanup?: () => Promise<void>,
): () => Promise<void> {
  let stopping = false;
  const parentProcessId = process.ppid;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(parentMonitor);
    try {
      await cleanup?.();
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
  return stop;
}

RunCoreProcess().catch(() => {
  process.stderr.write(`${JSON.stringify({
    code: "CORE_START_FAILED",
    userMessage: "Core 시작 경계를 검증하지 못했습니다.",
    retryable: false,
  })}\n`);
  process.exitCode = 1;
});
