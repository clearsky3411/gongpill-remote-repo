import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface GongpilOpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export async function LoadOpenAiConfig(): Promise<GongpilOpenAiConfig | undefined> {
  const envFile = process.env.GONGPIL_OPENAI_ENV_FILE;
  if (envFile === undefined || envFile.trim().length === 0) {
    return undefined;
  }
  if (!isAbsolute(envFile)) {
    throw new Error("OpenAI API 환경파일은 절대 경로여야 합니다.");
  }
  const content = await readFile(resolve(envFile), "utf8");
  const entry = content.split(/\r?\n/).find((line) => /^\s*OPENAI_API_KEY\s*=/.test(line));
  if (entry === undefined) {
    throw new Error("환경파일에 OPENAI_API_KEY가 없습니다.");
  }
  const rawValue = entry.slice(entry.indexOf("=") + 1).trim();
  const apiKey = RemoveMatchingQuotes(rawValue);
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
    throw new Error("OPENAI_API_KEY 형식이 올바르지 않습니다.");
  }
  const model = process.env.GONGPIL_OPENAI_MODEL?.trim() || "gpt-5.6-terra";
  if (!/^gpt-[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error("OpenAI 모델 이름이 올바르지 않습니다.");
  }
  return {
    apiKey,
    model,
    baseUrl: process.env.GONGPIL_OPENAI_BASE_URL?.trim() || undefined,
  };
}

function RemoveMatchingQuotes(value: string): string {
  if (value.length >= 2 && (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  )) {
    return value.slice(1, -1);
  }
  return value;
}
