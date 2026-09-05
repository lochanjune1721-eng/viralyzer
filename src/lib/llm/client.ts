import { env } from "@/lib/env";

// DeepSeek is OpenAI-compatible: POST {base}/chat/completions. Any other
// OpenAI-compatible endpoint works by overriding LLM_BASE_URL / LLM_MODEL.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function llmAvailable(): boolean {
  return !!env.llm.apiKey;
}

export async function chat(
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (!env.llm.apiKey) throw new Error("LLM not configured: set DEEPSEEK_API_KEY");
  const res = await fetch(`${env.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: env.llm.model,
      messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 2500,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return content;
}

/** Ask for JSON and parse it defensively (strips code fences if the model adds them). */
export async function chatJson<T>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
  const raw = await chat(messages, { ...opts, json: true });
  return parseJsonLoose<T>(raw);
}

export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("LLM did not return valid JSON");
  }
}
