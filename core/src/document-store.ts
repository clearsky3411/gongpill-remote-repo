import { createHash, randomUUID } from "node:crypto";
import { constants as FileSystemConstants } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { GongpilProjectStore } from "./project-store.ts";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_COUNT = 10_000;
const ALLOWED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json"]);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface GongpilDocumentSummary {
  fileId: string;
  path: string;
  name: string;
  revision: string;
  size: number;
  updatedAt: string;
}

export interface GongpilDocumentSnapshot extends GongpilDocumentSummary {
  content: string;
  encoding: "utf-8";
  newline: "lf" | "crlf" | "mixed" | "none";
}

export class GongpilDocumentStoreError extends Error {
  public constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "GongpilDocumentStoreError";
    this.code = code;
    this.retryable = retryable;
  }

  public readonly code: string;
  public readonly retryable: boolean;
}

export class GongpilDocumentStore {
  public constructor(projectStore: GongpilProjectStore) {
    this.projectStore = projectStore;
  }

  public async ListDocuments(projectId: string): Promise<GongpilDocumentSummary[]> {
    await this.projectStore.GetProject(projectId);
    const workspaceRoot = this.projectStore.GetWorkspaceRoot(projectId);
    const logicalPaths = await this.CollectDocumentPaths(workspaceRoot);
    const documents = await Promise.all(
      logicalPaths.map((logicalPath) => this.ReadDocument(projectId, logicalPath)),
    );
    return documents
      .map(({ content, encoding, newline, ...summary }) => summary)
      .sort((left, right) => left.path.localeCompare(right.path, "ko"));
  }

  public async ReadDocument(
    projectId: string,
    logicalPath: string,
  ): Promise<GongpilDocumentSnapshot> {
    await this.projectStore.GetProject(projectId);
    const normalizedPath = this.NormalizeDocumentPath(logicalPath);
    const documentPath = this.ResolveDocumentPath(projectId, normalizedPath);
    let contentBuffer: Buffer;
    let documentStat;
    try {
      [contentBuffer, documentStat] = await Promise.all([
        readFile(documentPath),
        stat(documentPath),
      ]);
    }
    catch {
      throw new GongpilDocumentStoreError("DOCUMENT_NOT_FOUND", "문서를 찾지 못했습니다.");
    }
    if (!documentStat.isFile() || contentBuffer.length > MAX_DOCUMENT_BYTES) {
      throw new GongpilDocumentStoreError(
        "DOCUMENT_TOO_LARGE",
        "10MB 이하의 일반 문서만 열 수 있습니다.",
      );
    }

    const content = contentBuffer.toString("utf8");
    return {
      fileId: this.CreateFileId(normalizedPath),
      path: normalizedPath,
      name: basename(normalizedPath),
      revision: this.CreateRevision(contentBuffer),
      size: contentBuffer.length,
      updatedAt: documentStat.mtime.toISOString(),
      content,
      encoding: "utf-8",
      newline: this.DetectNewline(content),
    };
  }

  public async CreateDocument(
    projectId: string,
    logicalPath: string,
    content = "",
  ): Promise<GongpilDocumentSnapshot> {
    const normalizedPath = this.NormalizeDocumentPath(logicalPath);
    return await this.RunDocumentMutation(`${projectId}:${normalizedPath}`, async () => {
      await this.projectStore.GetProject(projectId);
      const documentPath = this.ResolveDocumentPath(projectId, normalizedPath);
      const contentBuffer = Buffer.from(content, "utf8");
      this.RequireSize(contentBuffer);
      await mkdir(dirname(documentPath), { recursive: true });
      try {
        const fileHandle = await open(documentPath, "wx");
        try {
          await fileHandle.writeFile(contentBuffer);
          await fileHandle.sync();
        }
        finally {
          await fileHandle.close();
        }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new GongpilDocumentStoreError("DOCUMENT_ALREADY_EXISTS", "같은 이름의 문서가 있습니다.");
        }
        throw error;
      }
      await this.projectStore.TouchProject(projectId);
      return await this.ReadDocument(projectId, normalizedPath);
    });
  }

  public async SaveDocument(
    projectId: string,
    logicalPath: string,
    expectedRevision: string,
    content: string,
  ): Promise<GongpilDocumentSnapshot> {
    const normalizedPath = this.NormalizeDocumentPath(logicalPath);
    return await this.RunDocumentMutation(`${projectId}:${normalizedPath}`, async () => {
      const current = await this.ReadDocument(projectId, normalizedPath);
      if (current.revision !== expectedRevision) {
        throw new GongpilDocumentStoreError(
          "REVISION_CONFLICT",
          "다른 변경이 먼저 저장됐습니다. 문서를 다시 불러온 뒤 저장하세요.",
          true,
        );
      }

      const contentBuffer = Buffer.from(content, "utf8");
      this.RequireSize(contentBuffer);
      const documentPath = this.ResolveDocumentPath(projectId, current.path);
      await this.BackupDocument(projectId, current, documentPath);
      await this.WriteAtomically(documentPath, contentBuffer);
      await this.projectStore.TouchProject(projectId);
      return await this.ReadDocument(projectId, current.path);
    });
  }

  private async CollectDocumentPaths(workspaceRoot: string): Promise<string[]> {
    const paths: string[] = [];
    const visit = async (directoryPath: string): Promise<void> => {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries) {
        if (paths.length >= MAX_DOCUMENT_COUNT) {
          throw new GongpilDocumentStoreError(
            "DOCUMENT_LIMIT_EXCEEDED",
            "프로젝트 문서 수가 10,000개 제한을 초과했습니다.",
          );
        }
        if (entry.name.startsWith(".")) {
          continue;
        }
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        }
        else if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          paths.push(relative(workspaceRoot, entryPath).split(sep).join("/"));
        }
      }
    };
    await visit(workspaceRoot);
    return paths;
  }

  private async BackupDocument(
    projectId: string,
    snapshot: GongpilDocumentSnapshot,
    documentPath: string,
  ): Promise<void> {
    const historyRoot = join(this.projectStore.GetHistoryRoot(projectId), snapshot.fileId);
    await mkdir(historyRoot, { recursive: true });
    const backupPath = join(historyRoot, `${snapshot.revision}${extname(documentPath)}`);
    try {
      await copyFile(documentPath, backupPath, FileSystemConstants.COPYFILE_EXCL);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  private async WriteAtomically(documentPath: string, content: Buffer): Promise<void> {
    const tempPath = join(dirname(documentPath), `.gongpil-${randomUUID()}.tmp`);
    let fileHandle;
    try {
      fileHandle = await open(tempPath, "wx");
      await fileHandle.writeFile(content);
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(tempPath, documentPath);
    }
    finally {
      await fileHandle?.close();
      await rm(tempPath, { force: true });
    }
  }

  private NormalizeDocumentPath(logicalPath: string): string {
    const normalizedPath = logicalPath.trim().replace(/\\/g, "/");
    if (normalizedPath.length < 1 || normalizedPath.length > 512 || normalizedPath.startsWith("/")) {
      throw new GongpilDocumentStoreError("DOCUMENT_PATH_INVALID", "문서 경로가 올바르지 않습니다.");
    }
    const segments = normalizedPath.split("/");
    if (segments.some((segment) => (
      segment.length < 1
      || segment === "."
      || segment === ".."
      || /[<>:"|?*\u0000-\u001F]/.test(segment)
      || WINDOWS_RESERVED_NAMES.test(segment)
    ))) {
      throw new GongpilDocumentStoreError("DOCUMENT_PATH_INVALID", "문서 경로가 올바르지 않습니다.");
    }
    if (!ALLOWED_EXTENSIONS.has(extname(normalizedPath).toLowerCase())) {
      throw new GongpilDocumentStoreError(
        "DOCUMENT_TYPE_UNSUPPORTED",
        "Markdown, text 또는 JSON 문서만 사용할 수 있습니다.",
      );
    }
    return segments.join("/");
  }

  private ResolveDocumentPath(projectId: string, logicalPath: string): string {
    const workspaceRoot = resolve(this.projectStore.GetWorkspaceRoot(projectId));
    const documentPath = resolve(workspaceRoot, ...logicalPath.split("/"));
    const relativePath = relative(workspaceRoot, documentPath);
    if (relativePath.startsWith("..") || relativePath.length === 0) {
      throw new GongpilDocumentStoreError("DOCUMENT_PATH_OUTSIDE_PROJECT", "프로젝트 밖의 경로는 사용할 수 없습니다.");
    }
    return documentPath;
  }

  private RequireSize(content: Buffer): void {
    if (content.length > MAX_DOCUMENT_BYTES) {
      throw new GongpilDocumentStoreError("DOCUMENT_TOO_LARGE", "문서는 10MB 이하여야 합니다.");
    }
  }

  private CreateFileId(logicalPath: string): string {
    return `file-${createHash("sha256").update(logicalPath).digest("hex").slice(0, 24)}`;
  }

  private CreateRevision(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private DetectNewline(content: string): GongpilDocumentSnapshot["newline"] {
    const hasCrLf = content.includes("\r\n");
    const hasLf = content.replace(/\r\n/g, "").includes("\n");
    if (hasCrLf && hasLf) {
      return "mixed";
    }
    if (hasCrLf) {
      return "crlf";
    }
    if (hasLf) {
      return "lf";
    }
    return "none";
  }

  private async RunDocumentMutation<TResult>(
    mutationKey: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previousMutation = this.documentMutations.get(mutationKey) ?? Promise.resolve();
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const mutationTail = previousMutation.then(() => mutationGate);
    this.documentMutations.set(mutationKey, mutationTail);

    await previousMutation;
    try {
      return await operation();
    }
    finally {
      releaseMutation();
      if (this.documentMutations.get(mutationKey) === mutationTail) {
        this.documentMutations.delete(mutationKey);
      }
    }
  }

  private readonly projectStore: GongpilProjectStore;
  private readonly documentMutations = new Map<string, Promise<void>>();
}
