import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export type GongpilDiagnosticLevel = "info" | "warning" | "error";

export interface GongpilDiagnosticEntry {
  id: string;
  timestamp: string;
  level: GongpilDiagnosticLevel;
  source: "core" | "codex" | "openai-api" | "network";
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface GongpilDiagnosticInput {
  level: GongpilDiagnosticLevel;
  source: GongpilDiagnosticEntry["source"];
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_ENTRIES = 500;
const SAFE_DETAIL_KEYS = new Set([
  "command",
  "provider",
  "model",
  "status",
  "durationMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "personaVersion",
  "contextSources",
  "contextOmitted",
  "httpStatus",
  "retryable",
]);

export class GongpilDiagnosticLogStore {
  public constructor(dataRoot: string) {
    this.logPath = join(dataRoot, "logs", "core.jsonl");
  }

  public async Append(input: GongpilDiagnosticInput): Promise<GongpilDiagnosticEntry> {
    const entry: GongpilDiagnosticEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: input.level,
      source: input.source,
      code: NormalizeShortText(input.code, 80),
      message: NormalizeShortText(input.message, 500),
      requestId: NormalizeOptionalIdentifier(input.requestId),
      details: SanitizeDetails(input.details),
    };
    await mkdir(dirname(this.logPath), { recursive: true });
    await this.RotateIfNeeded();
    await appendFile(this.logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", flush: true });
    return entry;
  }

  public async Read(limit = 200): Promise<GongpilDiagnosticEntry[]> {
    const safeLimit = Math.max(1, Math.min(MAX_READ_ENTRIES, Math.trunc(limit)));
    try {
      const lines = (await readFile(this.logPath, "utf8")).split(/\r?\n/).filter(Boolean);
      const entries: GongpilDiagnosticEntry[] = [];
      for (const line of lines.slice(-safeLimit)) {
        try {
          entries.push(JSON.parse(line) as GongpilDiagnosticEntry);
        }
        catch {
          // A partial final line must not make the developer log unusable.
        }
      }
      return entries.reverse();
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async RotateIfNeeded(): Promise<void> {
    try {
      const file = await stat(this.logPath);
      if (file.size < MAX_FILE_BYTES) {
        return;
      }
      await rename(this.logPath, `${this.logPath}.1`);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private readonly logPath: string;
}

function SanitizeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (details === undefined) {
    return undefined;
  }
  const safeDetails: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      safeDetails[key] = value;
    }
    else if (typeof value === "string") {
      safeDetails[key] = NormalizeShortText(value, 160);
    }
  }
  return Object.keys(safeDetails).length === 0 ? undefined : safeDetails;
}

function NormalizeShortText(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function NormalizeOptionalIdentifier(value: string | undefined): string | undefined {
  if (value === undefined || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    return undefined;
  }
  return value;
}
