import { config } from "./config";

export class ModelError extends Error {
  constructor(public code: "MODEL_UNAVAILABLE" | "BUDGET_EXHAUSTED", message: string) {
    super(message);
  }
}

export function modelConfigured() {
  return Boolean(config.llm.key);
}

/** Calls a real OpenAI-compatible chat-completions endpoint. Never substitutes canned output. */
export async function summarise(text: string): Promise<{ output: string; model: string; latencyMs: number }> {
  if (!config.llm.key) throw new ModelError("MODEL_UNAVAILABLE", "LLM_API_KEY is not configured on the server");
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.llm.timeoutMs);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.key}` },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: "system", content: "Summarise the user's text as exactly three concise bullet points. Output only the bullets, each starting with '- '." },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new ModelError("MODEL_UNAVAILABLE", `model provider returned HTTP ${res.status}`);
    const json = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    const output = json.choices?.[0]?.message?.content?.trim();
    if (!output) throw new ModelError("MODEL_UNAVAILABLE", "model provider returned an empty completion");
    return { output, model: json.model ?? config.llm.model, latencyMs: Date.now() - started };
  } catch (e) {
    if (e instanceof ModelError) throw e;
    const aborted = (e as Error).name === "AbortError";
    throw new ModelError("MODEL_UNAVAILABLE", aborted ? "model call timed out" : "model provider unreachable");
  } finally {
    clearTimeout(timer);
  }
}
