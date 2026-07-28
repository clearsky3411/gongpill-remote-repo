import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ParseDocumentChunks, type GongpilChunkDescriptor } from "./chunk-parser.ts";
import type { GongpilDocumentSnapshot, GongpilDocumentStore } from "./document-store.ts";

interface IndexedDocument {
  path: string;
  revision: string;
  chunks: GongpilChunkDescriptor[];
}

interface PersistedChunkIndex {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  documents: IndexedDocument[];
}

export interface GongpilChunkSearchResult {
  chunk: GongpilChunkDescriptor;
  score: number;
}

export class GongpilChunkIndexStoreError extends Error {
  public constructor(code: string, message: string) {
    super(message);
    this.name = "GongpilChunkIndexStoreError";
    this.code = code;
  }

  public readonly code: string;
}

export class GongpilChunkIndexStore {
  public constructor(dataRoot: string, documentStore: GongpilDocumentStore) {
    this.indexRoot = join(dataRoot, "indexes", "chunks");
    this.documentStore = documentStore;
  }

  public async EnsureProject(projectId: string): Promise<GongpilChunkDescriptor[]> {
    const currentDocuments = await this.documentStore.ListDocuments(projectId);
    const index = await this.LoadIndex(projectId);
    const currentPaths = new Set(currentDocuments.map((document) => document.path));
    let changed = false;
    for (const indexedPath of [...index.keys()]) {
      if (!currentPaths.has(indexedPath)) {
        index.delete(indexedPath);
        changed = true;
      }
    }
    for (const summary of currentDocuments) {
      if (index.get(summary.path)?.revision === summary.revision) {
        continue;
      }
      const document = await this.documentStore.ReadDocument(projectId, summary.path);
      index.set(summary.path, this.CreateIndexedDocument(document));
      changed = true;
    }
    if (changed) {
      await this.Persist(projectId, index);
    }
    return Flatten(index);
  }

  public async UpdateDocument(
    projectId: string,
    document: GongpilDocumentSnapshot,
  ): Promise<GongpilChunkDescriptor[]> {
    await this.EnsureProject(projectId);
    const index = this.cache.get(projectId)!;
    const current = index.get(document.path);
    if (current?.revision === document.revision) {
      return current.chunks;
    }
    const indexedDocument = this.CreateIndexedDocument(document);
    index.set(document.path, indexedDocument);
    await this.Persist(projectId, index);
    return indexedDocument.chunks;
  }

  public async List(
    projectId: string,
    documentPath?: string,
  ): Promise<GongpilChunkDescriptor[]> {
    const chunks = await this.EnsureProject(projectId);
    return documentPath === undefined
      ? chunks
      : chunks.filter((chunk) => chunk.path === documentPath);
  }

  public async Search(
    projectId: string,
    query: string,
    options: { documentPaths?: string[]; limit?: number } = {},
  ): Promise<GongpilChunkSearchResult[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    if (normalizedQuery.length > 500) {
      throw new GongpilChunkIndexStoreError("CHUNK_QUERY_TOO_LARGE", "검색어는 500자 이하여야 합니다.");
    }
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const allowedPaths = options.documentPaths === undefined
      ? undefined
      : new Set(options.documentPaths);
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)));
    const chunks = (await this.EnsureProject(projectId))
      .filter((chunk) => allowedPaths === undefined || allowedPaths.has(chunk.path));
    if (terms.length === 0) {
      return chunks.slice(0, limit).map((chunk) => ({ chunk, score: 0 }));
    }
    return chunks
      .map((chunk) => ({ chunk, score: ScoreChunk(chunk, normalizedQuery, terms) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score
        || left.chunk.path.localeCompare(right.chunk.path, "ko")
        || left.chunk.ordinal - right.chunk.ordinal)
      .slice(0, limit);
  }

  public async Resolve(
    projectId: string,
    chunkIds: readonly string[],
  ): Promise<GongpilChunkDescriptor[]> {
    const chunks = await this.EnsureProject(projectId);
    const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
    const resolved: GongpilChunkDescriptor[] = [];
    for (const chunkId of chunkIds) {
      const chunk = byId.get(chunkId);
      if (chunk === undefined) {
        throw new GongpilChunkIndexStoreError(
          "CHUNK_SELECTION_STALE",
          "선택한 청크가 문서 변경으로 오래되었습니다. 청크 목록을 새로 불러오세요.",
        );
      }
      resolved.push(chunk);
    }
    return resolved;
  }

  private async LoadIndex(projectId: string): Promise<Map<string, IndexedDocument>> {
    const cached = this.cache.get(projectId);
    if (cached !== undefined) {
      return cached;
    }
    let index = new Map<string, IndexedDocument>();
    try {
      const value = JSON.parse(await readFile(this.GetIndexPath(projectId), "utf8")) as Partial<PersistedChunkIndex>;
      if (value.schemaVersion === 1 && value.projectId === projectId && Array.isArray(value.documents)) {
        index = new Map(value.documents
          .filter(IsIndexedDocument)
          .map((document) => [document.path, document]));
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    this.cache.set(projectId, index);
    return index;
  }

  private CreateIndexedDocument(document: GongpilDocumentSnapshot): IndexedDocument {
    return {
      path: document.path,
      revision: document.revision,
      chunks: ParseDocumentChunks(document),
    };
  }

  private async Persist(
    projectId: string,
    index: Map<string, IndexedDocument>,
  ): Promise<void> {
    const indexPath = this.GetIndexPath(projectId);
    await mkdir(dirname(indexPath), { recursive: true });
    const temporaryPath = `${indexPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx");
    try {
      const value: PersistedChunkIndex = {
        schemaVersion: 1,
        projectId,
        updatedAt: new Date().toISOString(),
        documents: [...index.values()].sort((left, right) => left.path.localeCompare(right.path, "ko")),
      };
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.sync();
    }
    finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, indexPath);
    }
    catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private GetIndexPath(projectId: string): string {
    if (!/^project-[A-Za-z0-9._-]{1,127}$/.test(projectId)) {
      throw new GongpilChunkIndexStoreError("PROJECT_ID_INVALID", "프로젝트 ID가 올바르지 않습니다.");
    }
    return join(this.indexRoot, `${projectId}.json`);
  }

  private readonly indexRoot: string;
  private readonly documentStore: GongpilDocumentStore;
  private readonly cache = new Map<string, Map<string, IndexedDocument>>();
}

function ScoreChunk(
  chunk: GongpilChunkDescriptor,
  normalizedQuery: string,
  terms: string[],
): number {
  const title = chunk.title.toLocaleLowerCase("ko");
  const content = chunk.content.toLocaleLowerCase("ko");
  let score = title.includes(normalizedQuery) ? 20 : 0;
  score += content.includes(normalizedQuery) ? 8 : 0;
  for (const term of terms) {
    if (title.includes(term)) {
      score += 6;
    }
    if (content.includes(term)) {
      score += 2;
    }
  }
  return score;
}

function Flatten(index: Map<string, IndexedDocument>): GongpilChunkDescriptor[] {
  return [...index.values()]
    .sort((left, right) => left.path.localeCompare(right.path, "ko"))
    .flatMap((document) => document.chunks);
}

function IsIndexedDocument(value: unknown): value is IndexedDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const document = value as Partial<IndexedDocument>;
  return typeof document.path === "string"
    && typeof document.revision === "string"
    && Array.isArray(document.chunks)
    && document.chunks.every(IsChunkDescriptor);
}

function IsChunkDescriptor(value: unknown): value is GongpilChunkDescriptor {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const chunk = value as Partial<GongpilChunkDescriptor>;
  const coordinate = chunk.coordinate;
  return typeof chunk.chunkId === "string"
    && typeof chunk.fileId === "string"
    && typeof chunk.path === "string"
    && typeof chunk.revision === "string"
    && (chunk.format === "markdown" || chunk.format === "json" || chunk.format === "text")
    && typeof chunk.kind === "string"
    && typeof chunk.title === "string"
    && Number.isSafeInteger(chunk.ordinal)
    && typeof chunk.content === "string"
    && typeof chunk.preview === "string"
    && typeof coordinate === "object"
    && coordinate !== null
    && Number.isSafeInteger(coordinate.byteStart)
    && Number.isSafeInteger(coordinate.byteEnd)
    && Number.isSafeInteger(coordinate.lineStart)
    && Number.isSafeInteger(coordinate.lineEnd)
    && typeof coordinate.display === "string";
}
