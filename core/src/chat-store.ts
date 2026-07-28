import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface GongpilChatMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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
  ): Promise<GongpilChatMessage> {
    return await this.RunMutation(projectId, async () => {
      const session = await this.ReadSessionUnsafe(projectId);
      const message: GongpilChatMessage = {
        messageId: `message-${randomUUID()}`,
        role,
        content,
        createdAt: new Date().toISOString(),
      };
      session.messages.push(message);
      session.updatedAt = message.createdAt;
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
      if (value.projectId !== projectId || !Array.isArray(value.messages) || !Array.isArray(value.proposals)) {
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
