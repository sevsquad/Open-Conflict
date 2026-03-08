// ═══════════════════════════════════════════════════════════════
// LLM PROXY — Server-side LLM API calls for adjudication.
// Keeps API keys server-side. Supports Anthropic and OpenAI.
// Ported from vite.config.js llmPlugin() with security hardening.
// ═══════════════════════════════════════════════════════════════

import { Agent, setGlobalDispatcher } from "undici";

// 15min timeout for LLM calls (large scenarios can take a while)
const LLM_TIMEOUT_MS = 900_000;

// Set global fetch timeout to match
setGlobalDispatcher(new Agent({ bodyTimeout: LLM_TIMEOUT_MS, headersTimeout: LLM_TIMEOUT_MS }));

// Server controls which models are allowed — client cannot pick arbitrary models.
// This prevents abuse (e.g., requesting expensive Opus when game is configured for Sonnet).
const ALLOWED_MODELS = {
  anthropic: new Set([
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ]),
  openai: new Set([
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o1-mini",
  ]),
};

/**
 * Call LLM provider with messages. Returns { ok, content, usage, model, stop_reason }
 * or { ok: false, error }.
 *
 * @param {string} provider - "anthropic" or "openai"
 * @param {string} model - model ID (must be in ALLOWED_MODELS)
 * @param {Array} messages - chat messages array
 * @param {Object} options - { temperature, maxTokens, apiKeys }
 * @param {Object} [options.apiKeys] - Per-game API key overrides.
 *   { anthropicKey, openaiKey }. Falls back to process.env if not set.
 */
export async function callLLM(provider, model, messages, { temperature = 0.4, maxTokens = 8192, apiKeys } = {}) {
  // Validate provider and model
  if (!ALLOWED_MODELS[provider]) {
    return { ok: false, error: `Unknown provider: ${provider}` };
  }
  if (!ALLOWED_MODELS[provider].has(model)) {
    return { ok: false, error: `Model not allowed: ${model}. Allowed: ${[...ALLOWED_MODELS[provider]].join(", ")}` };
  }

  // Clamp max_tokens to safe range
  const clampedMax = Math.min(Math.max(maxTokens, 4096), 64000);

  if (provider === "anthropic") {
    return callAnthropic(model, messages, temperature, clampedMax, apiKeys?.anthropicKey);
  } else {
    return callOpenAI(model, messages, temperature, clampedMax, apiKeys?.openaiKey);
  }
}

/** Add a model to the allowlist at runtime (e.g., from game config) */
export function allowModel(provider, model) {
  if (ALLOWED_MODELS[provider]) {
    ALLOWED_MODELS[provider].add(model);
  }
}

// ── Anthropic ────────────────────────────────────────────────

async function callAnthropic(model, messages, temperature, maxTokens, overrideKey) {
  const apiKey = overrideKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");

  const apiBody = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: userMsgs,
  };
  // Cache system prompt across turns within a game
  if (systemMsg) {
    apiBody.system = [{
      type: "text",
      text: systemMsg.content,
      cache_control: { type: "ephemeral" },
    }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(apiBody),
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error?.message || JSON.stringify(data) };
    }
    return {
      ok: true,
      content: data.content?.find(c => c.type === "text")?.text || "",
      usage: {
        input: data.usage?.input_tokens,
        output: data.usage?.output_tokens,
        cache_read: data.usage?.cache_read_input_tokens || 0,
        cache_creation: data.usage?.cache_creation_input_tokens || 0,
      },
      model: data.model,
      stop_reason: data.stop_reason,
    };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, error: "LLM request timed out" };
    return { ok: false, error: `Anthropic API error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI ───────────────────────────────────────────────────

async function callOpenAI(model, messages, temperature, maxTokens, overrideKey) {
  const apiKey = overrideKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not configured" };

  const apiBody = {
    model,
    temperature,
    messages,
    response_format: { type: "json_object" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(apiBody),
      signal: controller.signal,
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: data.error?.message || JSON.stringify(data) };
    }
    return {
      ok: true,
      content: data.choices?.[0]?.message?.content || "",
      usage: {
        input: data.usage?.prompt_tokens,
        output: data.usage?.completion_tokens,
      },
      model: data.model,
      stop_reason: data.choices?.[0]?.finish_reason,
    };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, error: "LLM request timed out" };
    return { ok: false, error: `OpenAI API error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}
