import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GongpilContextSnapshot } from "./context-builder.ts";

export interface GongpilChatClassification {
  topic?: string;
  task?: string;
  session?: string;
  labels?: string[];
}

export interface GongpilChatMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  contextSnapshot?: GongpilContextSnapshot;
  inReplyToMessageId?: string;
  classification?: GongpilChatClassification;
}

export interface GongpilDocumentProposal {
  proposalId: string;
  action: "create" | "replace";
  path: string;
  summary: string;
  beforeContent: string;
  proposedContent: string;
  expectedRevision?: string;
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  resolvedAt?: string;
}

export interface GongpilChatSession {
  projectId: string;
  messages: GongpilChatMessage[];
  proposals: GongpilDocumentProposal[];
  updatedAt: string;
}

export class GongpilChatStoreError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilChatStoreError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilChatStore {
  public constructor(dataRoot: string) {
    this.chatRoot = join(dataRoot, "chats");
  }

  public async ReadSession(projectId: string): Promise<GongpilChatSession> {
    return await this.RunMutation(projectId, async () => await this.ReadSessionUnsafe(projectId));
  }

  public async AppendMessage(
    projectId: string,
    role: GongpilChatMessage["role"],
    content: string,
    options: Pick<GongpilChatMessage, "contextSnapshot" | "inReplyToMessageId" | "classification"> = {},
  ): Promise<GongpilChatMessage> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const message: GongpilChatMessage = {
        messageId: `message-${randomUUID()}`,
        role,
        content,
        createdAt: new Date().toISOString(),
        ...options,
      };
      session.messages.push(message);
      session.updatedAt = message.createdAt;
      await this.WriteSession(session);
      return message;
    });
  }

  public async UpdateMessageClassification(
    projectId: string,
    messageId: string,
    classification: GongpilChatClassification,
  ): Promise<GongpilChatMessage> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const message = session.messages.find((candidate) => candidate.messageId === messageId);
      if (message === undefined) {
        throw new GongpilChatStoreError(
          "CHAT_MESSAGE_NOT_FOUND",
          "분류할 채팅 메시지가 없거나 현재 프로젝트에 속하지 않습니다.",
        );
      }
      const normalized = NormalizeClassification(classification);
      if (normalized === undefined) {
        delete message.classification;
      }
      else {
        message.classification = normalized;
      }
      session.updatedAt = new Date().toISOString();
      await this.WriteSession(session);
      return message;
    });
  }

  public async UpdateMessageContextSnapshot(
    projectId: string,
    messageId: string,
    contextSnapshot: GongpilContextSnapshot,
  ): Promise<GongpilChatMessage> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const message = session.messages.find((candidate) => candidate.messageId === messageId);
      if (message === undefined) {
        throw new GongpilChatStoreError(
          "CHAT_MESSAGE_NOT_FOUND",
          "컨텍스트를 확정할 채팅 메시지가 없거나 현재 프로젝트에 속하지 않습니다.",
        );
      }
      if (!IsContextSnapshot(contextSnapshot)) {
        throw new GongpilChatStoreError("CHAT_CONTEXT_INVALID", "채팅 컨텍스트 snapshot이 올바르지 않습니다.");
      }
      message.contextSnapshot = contextSnapshot;
      session.updatedAt = new Date().toISOString();
      await this.WriteSession(session);
      return message;
    });
  }

  public async CreateProposal(
    projectId: string,
    value: Omit<GongpilDocumentProposal, "proposalId" | "status" | "createdAt">,
  ): Promise<GongpilDocumentProposal> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const proposal: GongpilDocumentProposal = {
        ...value,
        proposalId: `proposal-${randomUUID()}`,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      session.proposals.push(proposal);
      session.updatedAt = proposal.createdAt;
      await this.WriteSession(session);
      return proposal;
    });
  }

  public async GetProposal(projectId: string, proposalId: string): Promise<GongpilDocumentProposal> {
    const session = await this.ReadSession(projectId);
    const proposal = session.proposals.find((candidate) => candidate.proposalId === proposalId);
    if (proposal === undefined) {
      throw new GongpilChatStoreError("PROPOSAL_NOT_FOUND", "변경 제안을 찾지 못했습니다.");
    }
    return proposal;
  }

  public async ResolveProposal(
    projectId: string,
    proposalId: string,
    status: "applied" | "rejected",
  ): Promise<GongpilDocumentProposal> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const proposal = session.proposals.find((candidate) => candidate.proposalId === proposalId);
      if (proposal === undefined) {
        throw new GongpilChatStoreError("PROPOSAL_NOT_FOUND", "변경 제안을 찾지 못했습니다.");
      }
      if (proposal.status !== "pending") {
        throw new GongpilChatStoreError("PROPOSAL_ALREADY_RESOLVED", "이미 처리된 변경 제안입니다.");
      }
      proposal.status = status;
      proposal.resolvedAt = new Date().toISOString();
      session.updatedAt = proposal.resolvedAt;
      await this.WriteSession(session);
      return proposal;
    });
  }

  private async ReadSessionUnsafe(projectId: string): Promise<GongpilChatSession> {
    try {
      const value = JSON.parse(await readFile(this.GetSessionPath(projectId), "utf8")) as GongpilChatSession;
      if (value.projectId !== projectId
        || !Array.isArray(value.messages)
        || !value.messages.every(IsChatMessage)
        || !Array.isArray(value.proposals)) {
        throw new Error("invalid");
      }
      return value;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new GongpilChatStoreError("CHAT_STORE_CORRUPT", "채팅 저장 파일이 손상되었습니다.");
      }
      return { projectId, messages: [], proposals: [], updatedAt: new Date(0).toISOString() };
    }
  }

  private async WriteSession(session: GongpilChatSession): Promise<void> {
    const sessionPath = this.GetSessionPath(session.projectId);
    await mkdir(dirname(sessionPath), { recursive: true });
    const temporaryPath = `${sessionPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(session, null, 2)}\n`, "utf8");
      await handle.sync();
    }
    finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, sessionPath);
    }
    catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private GetSessionPath(projectId: string): string {
    if (!/^project-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId)) {
      throw new GongpilChatStoreError("PROJECT_ID_INVALID", "프로젝트 ID가 올바르지 않습니다.");
    }
    return join(this.chatRoot, `${projectId}.json`);
  }

  private RunMutation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.mutations.set(projectId, current.then(() => undefined, () => undefined));
    return current;
  }

  private readonly chatRoot: string;
  private readonly mutations = new Map<string, Promise<void>>();
}

function IsChatMessage(value: unknown): value is GongpilChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as Partial<GongpilChatMessage>;
  return typeof message.messageId === "string"
    && (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string"
    && typeof message.createdAt === "string"
    && (message.inReplyToMessageId === undefined || typeof message.inReplyToMessageId === "string")
    && (message.classification === undefined || IsChatClassification(message.classification))
    && (message.contextSnapshot === undefined || IsContextSnapshot(message.contextSnapshot));
}

function IsContextSnapshot(value: GongpilContextSnapshot): boolean {
  return typeof value.snapshotId === "string"
    && typeof value.createdAt === "string"
    && typeof value.persona === "object"
    && value.persona !== null
    && typeof value.persona.personaId === "string"
    && typeof value.persona.versionId === "string"
    && Number.isSafeInteger(value.persona.version)
    && typeof value.persona.name === "string"
    && typeof value.profile === "object"
    && value.profile !== null
    && typeof value.profile.profileId === "string"
    && typeof value.profile.name === "string"
    && Number.isSafeInteger(value.profile.contextTokenBudget)
    && Number.isSafeInteger(value.requestedSourceCount)
    && Number.isSafeInteger(value.includedSourceCount)
    && Number.isSafeInteger(value.omittedSourceCount)
    && Number.isSafeInteger(value.estimatedInputTokens)
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string")
    && (value.omissions === undefined || (
      Array.isArray(value.omissions)
      && value.omissions.every((omission) => (
        typeof omission.sourceReference === "string"
        && (omission.sourceKind === "document" || omission.sourceKind === "conversation")
        && (omission.reason === "duplicate" || omission.reason === "token-budget")
      ))
    ))
    && Array.isArray(value.sources)
    && value.sources.every(IsSourceSnapshot)
    && (value.automaticRetrieval === undefined || IsAutomaticRetrieval(value.automaticRetrieval));
}

function IsSourceSnapshot(source: GongpilContextSnapshot["sources"][number]): boolean {
  const common = typeof source.sourceId === "string"
    && Number.isSafeInteger(source.byteStart)
    && Number.isSafeInteger(source.byteEnd)
    && typeof source.content === "string"
    && /^[a-f0-9]{64}$/.test(source.contentSha256);
  if (!common) {
    return false;
  }
  if (source.sourceKind === "conversation") {
    return source.selectionKind === "conversation"
      && typeof source.historyChunkId === "string"
      && typeof source.messageId === "string"
      && typeof source.turnId === "string"
      && (source.role === "user" || source.role === "assistant")
      && typeof source.createdAt === "string"
      && (source.classification === undefined || IsChatClassification(source.classification));
  }
  return (source.sourceKind === undefined || source.sourceKind === "document")
    && (source.selectionKind === "explicit"
      || source.selectionKind === "active-document"
      || source.selectionKind === "pair-writer")
    && typeof source.fileId === "string"
    && typeof source.path === "string"
    && typeof source.revision === "string"
    && typeof source.title === "string"
    && Number.isSafeInteger(source.lineStart)
    && Number.isSafeInteger(source.lineEnd);
}

function IsAutomaticRetrieval(value: NonNullable<GongpilContextSnapshot["automaticRetrieval"]>): boolean {
  return typeof value === "object"
    && value !== null
    && typeof value.dynamicToolsEnabled === "boolean"
    && Array.isArray(value.searchQueries)
    && value.searchQueries.every((query) => typeof query === "string")
    && Array.isArray(value.requestedChunkIds)
    && value.requestedChunkIds.every((chunkId) => typeof chunkId === "string")
    && Array.isArray(value.includedChunkIds)
    && value.includedChunkIds.every((chunkId) => typeof chunkId === "string")
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function IsChatClassification(value: GongpilChatClassification): boolean {
  return IsOptionalBoundedString(value.topic)
    && IsOptionalBoundedString(value.task)
    && IsOptionalBoundedString(value.session)
    && (value.labels === undefined || (
      Array.isArray(value.labels)
      && value.labels.length <= 20
      && value.labels.every((label) => IsOptionalBoundedString(label) && label.trim().length > 0)
    ));
}

function NormalizeClassification(
  value: GongpilChatClassification,
): GongpilChatClassification | undefined {
  if (!IsChatClassification(value)) {
    throw new GongpilChatStoreError("CHAT_CLASSIFICATION_INVALID", "대화 분류 값이 올바르지 않습니다.");
  }
  const topic = value.topic?.trim() || undefined;
  const task = value.task?.trim() || undefined;
  const session = value.session?.trim() || undefined;
  const labels = value.labels === undefined
    ? undefined
    : [...new Set(value.labels.map((label) => label.trim()).filter(Boolean))];
  if (topic === undefined && task === undefined && session === undefined && (labels?.length ?? 0) === 0) {
    return undefined;
  }
  return { topic, task, session, labels: labels?.length === 0 ? undefined : labels };
}

function IsOptionalBoundedString(value: string | undefined): boolean {
  return value === undefined || (typeof value === "string" && value.length <= 100);
}
