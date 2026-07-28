export interface GongpilOpenAiToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface GongpilOpenAiResponse {
  responseId?: string;
  providerRequestId?: string;
  text: string;
  toolCalls: GongpilOpenAiToolCall[];
  usage?: GongpilOpenAiUsage;
}

export interface GongpilOpenAiUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface GongpilOpenAiResponsesRequest {
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  baseUrl?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
}

export class GongpilOpenAiResponsesError extends Error {
  public constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "GongpilOpenAiResponsesError";
    this.code = code;
    this.retryable = retryable;
  }

  public readonly code: string;
  public readonly retryable: boolean;
}

export class GongpilOpenAiResponsesAdapter {
  public async CreateResponse(
    request: GongpilOpenAiResponsesRequest,
  ): Promise<GongpilOpenAiResponse> {
    const baseUrl = NormalizeBaseUrl(request.baseUrl ?? "https://api.openai.com/v1");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          instructions: request.instructions,
          input: request.input,
          reasoning: { effort: "low" },
          text: { verbosity: "medium" },
          stream: true,
          tools: [
            {
              type: "function",
              name: "propose_document",
              description: "사용자 승인을 받아 새 문서를 만들거나 선택 문서 전체를 교체하는 변경안을 제안합니다.",
              strict: true,
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  action: { type: "string", enum: ["create", "replace"] },
                  path: { type: "string" },
                  content: { type: "string" },
                  summary: { type: "string" },
                },
                required: ["action", "path", "content", "summary"],
              },
            },
          ],
          tool_choice: "auto",
        }),
        signal: request.signal,
      });
    }
    catch (error) {
      if (request.signal?.aborted === true) {
        throw new GongpilOpenAiResponsesError("AI_REQUEST_CANCELLED", "AI 요청이 취소되었습니다.");
      }
      throw new GongpilOpenAiResponsesError(
        "AI_NETWORK_FAILED",
        "OpenAI API에 연결하지 못했습니다.",
        true,
      );
    }

    if (!response.ok || response.body === null) {
      const retryable = response.status === 429 || response.status >= 500;
      const apiError = await ReadApiError(response);
      if (apiError.code === "insufficient_quota") {
        throw new GongpilOpenAiResponsesError(
          "AI_QUOTA_EXHAUSTED",
          "OpenAI API 프로젝트의 크레딧 또는 사용 한도를 확인하세요.",
        );
      }
      throw new GongpilOpenAiResponsesError(
        response.status === 401 ? "AI_AUTH_FAILED" : "AI_REQUEST_FAILED",
        response.status === 401
          ? "OpenAI API 키를 확인하세요."
          : `OpenAI API 요청을 완료하지 못했습니다. (${response.status})`,
        retryable,
      );
    }

    const result = await ReadEventStream(response.body, request.onTextDelta);
    return {
      ...result,
      providerRequestId: response.headers.get("x-request-id") ?? undefined,
    };
  }
}

function NormalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const isOfficial = url.protocol === "https:" && url.hostname === "api.openai.com";
  const isLoopbackTest = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!isOfficial && !isLoopbackTest) {
    throw new GongpilOpenAiResponsesError(
      "AI_BASE_URL_REJECTED",
      "허용되지 않은 OpenAI API 주소입니다.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

async function ReadEventStream(
  stream: ReadableStream<Uint8Array>,
  onTextDelta?: (delta: string) => void,
): Promise<GongpilOpenAiResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const toolCalls: GongpilOpenAiToolCall[] = [];
  let buffer = "";
  let text = "";
  let responseId: string | undefined;
  let usage: GongpilOpenAiUsage | undefined;

  const handleFrame = (frame: string): void => {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0 || data === "[DONE]") {
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    }
    catch {
      throw new GongpilOpenAiResponsesError("AI_STREAM_INVALID", "OpenAI 응답 형식이 올바르지 않습니다.", true);
    }
    if (event.type === "response.created") {
      const response = event.response as Record<string, unknown> | undefined;
      responseId = typeof response?.id === "string" ? response.id : responseId;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      text += event.delta;
      onTextDelta?.(event.delta);
    }
    if (event.type === "response.output_item.done") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call" && typeof item.name === "string" && typeof item.arguments === "string") {
        toolCalls.push({
          callId: typeof item.call_id === "string" ? item.call_id : "",
          name: item.name,
          arguments: item.arguments,
        });
      }
    }
    if (event.type === "response.completed") {
      const completedResponse = event.response as Record<string, unknown> | undefined;
      responseId = typeof completedResponse?.id === "string" ? completedResponse.id : responseId;
      usage = ParseUsage(completedResponse?.usage);
    }
    if (event.type === "error") {
      const error = event.error as Record<string, unknown> | undefined;
      const code = typeof error?.code === "string"
        ? error.code
        : (typeof event.code === "string" ? event.code : undefined);
      if (code === "insufficient_quota") {
        throw new GongpilOpenAiResponsesError(
          "AI_QUOTA_EXHAUSTED",
          "OpenAI API 프로젝트의 크레딧 또는 사용 한도를 확인하세요.",
        );
      }
      throw new GongpilOpenAiResponsesError("AI_STREAM_FAILED", "OpenAI 응답 생성 중 오류가 발생했습니다.", true);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const separator = /^\r\n\r\n/.test(buffer.slice(boundary)) ? 4 : 2;
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + separator);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim().length > 0) {
    handleFrame(buffer);
  }
  return { responseId, text, toolCalls, usage };
}

function ParseUsage(value: unknown): GongpilOpenAiUsage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const usage = value as Record<string, unknown>;
  const inputDetails = typeof usage.input_tokens_details === "object" && usage.input_tokens_details !== null
    ? usage.input_tokens_details as Record<string, unknown>
    : undefined;
  const outputDetails = typeof usage.output_tokens_details === "object" && usage.output_tokens_details !== null
    ? usage.output_tokens_details as Record<string, unknown>
    : undefined;
  return {
    inputTokens: ReadTokenCount(usage.input_tokens),
    cachedInputTokens: ReadTokenCount(inputDetails?.cached_tokens),
    outputTokens: ReadTokenCount(usage.output_tokens),
    reasoningOutputTokens: ReadTokenCount(outputDetails?.reasoning_tokens),
  };
}

function ReadTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

async function ReadApiError(response: Response): Promise<{ code?: string }> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return { code: typeof body.error?.code === "string" ? body.error.code : undefined };
  }
  catch {
    return {};
  }
}
