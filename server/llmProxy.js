// ═══════════════════════════════════════════════════════════════
// LLM PROXY — Server-side LLM API calls for adjudication.
// Keeps API keys server-side. Supports Anthropic and OpenAI.
// Ported from vite.config.js llmPlugin() with security hardening.
// ═══════════════════════════════════════════════════════════════

import { Agent, setGlobalDispatcher } from "undici";

// 15min timeout for LLM calls (large scenarios can take a while)
const LLM_TIMEOUT_MS = 900_000;
const BUDGET_WINDOW_MS = readBudgetNumber(process.env.LLM_BUDGET_WINDOW_MS, 15 * 60_000);
const MAX_BUDGET_REQUESTS = readBudgetNumber(process.env.LLM_BUDGET_MAX_REQUESTS, process.env.NODE_ENV === "production" ? 0 : 10);
// 500k accommodates AI-vs-AI auto-play: ~60k per AI order call × 2 sides + ~70k adjudication
const MAX_BUDGET_PROJECTED_TOKENS = readBudgetNumber(process.env.LLM_BUDGET_MAX_PROJECTED_TOKENS, process.env.NODE_ENV === "production" ? 0 : 500_000);
const BUDGET_BUCKET_TTL_MS = readBudgetNumber(process.env.LLM_BUDGET_BUCKET_TTL_MS, Math.max(BUDGET_WINDOW_MS * 2, 60 * 60_000));
const llmBudgetBuckets = new Map();

// Set global fetch timeout to match
setGlobalDispatcher(new Agent({ bodyTimeout: LLM_TIMEOUT_MS, headersTimeout: LLM_TIMEOUT_MS }));

function readBudgetNumber(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Server controls which models are allowed — client cannot pick arbitrary models.
// This prevents abuse (e.g., requesting expensive Opus when game is configured for Sonnet).
const ALLOWED_MODELS = {
  anthropic: new Set([
    "claude-sonnet-4-6",
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
    "gpt-5.2",
    "gpt-5.3-chat-latest",
    "gpt-5.4",
    "gpt-5.4-pro",
  ]),
};

/**
 * Call LLM provider with messages. Returns { ok, content, usage, model, stop_reason }
 * or { ok: false, error }.
 *
 * @param {string} provider - "anthropic" or "openai"
 * @param {string} model - model ID (must be in ALLOWED_MODELS)
 * @param {Array} messages - chat messages array
 * @param {Object} options - { temperature, maxTokens, apiKeys, budgetKey }
 * @param {Object} [options.apiKeys] - Per-game API key overrides.
 *   { anthropicKey, openaiKey }. Falls back to process.env if not set.
 */
export async function callLLM(provider, model, messages, { temperature = 0.4, maxTokens = 8192, apiKeys, budgetKey } = {}) {
  // Validate provider and model
  if (!ALLOWED_MODELS[provider]) {
    return buildLlmError(`Unknown provider: ${provider}`, { errorCode: "unknown_provider" });
  }
  if (!ALLOWED_MODELS[provider].has(model)) {
    return buildLlmError(`Model not allowed: ${model}. Allowed: ${[...ALLOWED_MODELS[provider]].join(", ")}`, { errorCode: "model_not_allowed" });
  }

  // Clamp max_tokens to a safe model-aware range
  const clampedMax = clampMaxTokens(provider, model, maxTokens);

  if (provider === "anthropic") {
    return callAnthropic(model, messages, temperature, clampedMax, apiKeys?.anthropicKey, budgetKey);
  } else {
    return callOpenAI(model, messages, temperature, clampedMax, apiKeys?.openaiKey, budgetKey);
  }
}

/** Add a model to the allowlist at runtime (e.g., from game config) */
export function allowModel(provider, model) {
  if (ALLOWED_MODELS[provider]) {
    ALLOWED_MODELS[provider].add(model);
  }
}

function buildLlmError(error, { retryable = false, errorCode = null, meta = null } = {}) {
  return {
    ok: false,
    error,
    retryable,
    ...(errorCode ? { errorCode } : {}),
    ...(meta ? { meta } : {}),
  };
}

function isRetryableErrorMessage(error) {
  const normalized = String(error || "").toLowerCase();
  return normalized.includes("rate limit")
    || normalized.includes("too many requests")
    || normalized.includes("429")
    || normalized.includes("overloaded")
    || normalized.includes("temporarily unavailable")
    || normalized.includes("service unavailable");
}

function normalizeBudgetKey(budgetKey) {
  const normalized = String(budgetKey || "").trim();
  return normalized || "global";
}

function pruneBudgetBuckets(now = Date.now()) {
  for (const [key, bucket] of llmBudgetBuckets.entries()) {
    if (now - (bucket.lastTouchedAt || bucket.windowStartedAt || 0) >= BUDGET_BUCKET_TTL_MS) {
      llmBudgetBuckets.delete(key);
    }
  }
}

function getBudgetBucket(budgetKey) {
  const now = Date.now();
  pruneBudgetBuckets(now);
  const key = normalizeBudgetKey(budgetKey);
  let bucket = llmBudgetBuckets.get(key);
  if (!bucket) {
    bucket = {
      windowStartedAt: now,
      lastTouchedAt: now,
      requests: 0,
      projectedTokens: 0,
      actualInputTokens: 0,
      actualOutputTokens: 0,
    };
    llmBudgetBuckets.set(key, bucket);
  } else {
    bucket.lastTouchedAt = now;
  }
  return { key, bucket };
}

function resetBudgetBucketIfNeeded(bucket, now = Date.now()) {
  bucket.lastTouchedAt = now;
  if (now - bucket.windowStartedAt < BUDGET_WINDOW_MS) return;
  bucket.windowStartedAt = now;
  bucket.requests = 0;
  bucket.projectedTokens = 0;
  bucket.actualInputTokens = 0;
  bucket.actualOutputTokens = 0;
}

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function estimateContentTokens(content) {
  if (!content) return 0;
  if (typeof content === "string") return estimateTextTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => {
      if (!part) return sum;
      if (typeof part === "string") return sum + estimateTextTokens(part);
      if (part.type === "text" || part.type === "output_text") {
        return sum + estimateTextTokens(part.text);
      }
      if (part.type === "image_url" || part.type === "input_image" || part.type === "image") {
        return sum + 1024;
      }
      return sum;
    }, 0);
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return estimateTextTokens(content.text);
    if (content.image_url || content.source?.data) return 1024;
  }
  return 0;
}

function estimateMessageTokens(messages) {
  return (messages || []).reduce((sum, message) => {
    if (!message) return sum;
    return sum + 12 + estimateContentTokens(message.content);
  }, 0);
}

function reserveLlmBudget(provider, model, messages, maxTokens, budgetKey) {
  if (MAX_BUDGET_REQUESTS <= 0 && MAX_BUDGET_PROJECTED_TOKENS <= 0) {
    return null;
  }

  const { key, bucket } = getBudgetBucket(budgetKey);
  resetBudgetBucketIfNeeded(bucket);
  const estimatedInputTokens = estimateMessageTokens(messages);
  const projectedTokens = estimatedInputTokens + Math.max(0, maxTokens || 0);

  if (MAX_BUDGET_REQUESTS > 0 && bucket.requests + 1 > MAX_BUDGET_REQUESTS) {
    return buildLlmError(
      `Local LLM safety budget exceeded for turn bucket "${key}": request cap hit (${bucket.requests}/${MAX_BUDGET_REQUESTS} in ${Math.round(BUDGET_WINDOW_MS / 60000)}m). Set LLM_BUDGET_MAX_REQUESTS to override.`,
      { retryable: false, errorCode: "local_budget_requests_exceeded" }
    );
  }

  if (MAX_BUDGET_PROJECTED_TOKENS > 0 && bucket.projectedTokens + projectedTokens > MAX_BUDGET_PROJECTED_TOKENS) {
    return buildLlmError(
      `Local LLM safety budget exceeded for turn bucket "${key}": projected token cap hit (${bucket.projectedTokens + projectedTokens}/${MAX_BUDGET_PROJECTED_TOKENS} in ${Math.round(BUDGET_WINDOW_MS / 60000)}m). Set LLM_BUDGET_MAX_PROJECTED_TOKENS to override.`,
      { retryable: false, errorCode: "local_budget_tokens_exceeded" }
    );
  }

  bucket.requests += 1;
  bucket.projectedTokens += projectedTokens;
  return null;
}

function recordLlmUsage(usage, budgetKey) {
  if (!usage) return;
  const { bucket } = getBudgetBucket(budgetKey);
  resetBudgetBucketIfNeeded(bucket);
  bucket.actualInputTokens += usage?.input || 0;
  bucket.actualOutputTokens += usage?.output || 0;
}

// ── Anthropic ────────────────────────────────────────────────

async function callAnthropic(model, messages, temperature, maxTokens, overrideKey, budgetKey) {
  const apiKey = overrideKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildLlmError("ANTHROPIC_API_KEY not configured", { errorCode: "missing_api_key" });
  const budgetError = reserveLlmBudget("anthropic", model, messages, maxTokens, budgetKey);
  if (budgetError) return budgetError;

  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");

  // Convert user messages to block format so we can add cache_control
  // to the first (largest) user message — saves huge cost on retries
  const apiMessages = userMsgs.map((msg, idx) => {
    // Cache the first user message (the big adjudication prompt)
    // Anthropic caches content blocks with cache_control: ephemeral,
    // so retries and rebuttal calls reuse the cached prompt
    if (idx === 0 && msg.role === "user") {
      return {
        role: "user",
        content: [{
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        }],
      };
    }
    return msg;
  });

  const apiBody = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: apiMessages,
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
      return buildLlmError(
        data.error?.message || JSON.stringify(data),
        {
          retryable: isRetryableErrorMessage(data.error?.message || ""),
          errorCode: data.error?.type || data.error?.code || "anthropic_error",
        }
      );
    }
    const result = {
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
    recordLlmUsage(result.usage, budgetKey);
    return result;
  } catch (e) {
    if (e.name === "AbortError") return buildLlmError("LLM request timed out", { errorCode: "timeout" });
    return buildLlmError(`Anthropic API error: ${e.message}`, {
      retryable: isRetryableErrorMessage(e.message),
      errorCode: "anthropic_exception",
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI ───────────────────────────────────────────────────

function isOpenAIProModel(model) {
  return typeof model === "string" && model.toLowerCase().endsWith("-pro");
}

function clampMaxTokens(provider, model, maxTokens) {
  const lowerBound = 4096;
  let upperBound = 64000;

  if (provider === "openai") {
    const m = (model || "").toLowerCase();
    if (isOpenAIProModel(model)) {
      // GPT-5 pro can spend a very long time reasoning when given huge output ceilings.
      upperBound = 12000;
    } else if (m.startsWith("gpt-4-turbo")) {
      upperBound = 4096;  // gpt-4-turbo hard limit
    } else if (m.startsWith("gpt-4o")) {
      upperBound = 16384; // gpt-4o / gpt-4o-mini hard limit
    }
    // gpt-5.x and o1-mini have larger output windows, keep 64k default
  }

  return Math.min(Math.max(maxTokens, lowerBound), upperBound);
}

function normalizeResponsesContent(role, content) {
  const textType = role === "assistant" ? "output_text" : "input_text";
  if (Array.isArray(content)) {
    const normalized = [];
    for (const block of content) {
      if (!block) continue;
      if (typeof block === "string") {
        normalized.push({ type: textType, text: block });
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        normalized.push({ type: textType, text: block.text });
        continue;
      }
      if (block.type === "output_text" && typeof block.text === "string") {
        normalized.push({ type: "output_text", text: block.text });
        continue;
      }
      if (block.type === "image_url") {
        const imageUrl = typeof block.image_url === "string"
          ? block.image_url
          : block.image_url?.url;
        if (imageUrl && role !== "assistant") {
          normalized.push({ type: "input_image", image_url: imageUrl });
        }
      }
    }
    return normalized;
  }

  if (typeof content === "string") {
    return [{ type: textType, text: content }];
  }

  if (content?.type === "text" && typeof content.text === "string") {
    return [{ type: textType, text: content.text }];
  }

  if (content?.type === "output_text" && typeof content.text === "string") {
    return [{ type: "output_text", text: content.text }];
  }

  return [];
}

function toResponsesInput(messages) {
  const systemParts = [];
  const input = [];

  for (const message of messages || []) {
    if (!message) continue;
    const role = message.role || "user";
    const content = normalizeResponsesContent(role, message.content);
    if (content.length === 0) continue;
    if (role === "system") {
      for (const part of content) {
        if (part.type === "input_text" && part.text) {
          systemParts.push(part.text);
        }
      }
      continue;
    }
    input.push({ role, content });
  }

  return {
    instructions: systemParts.join("\n\n").trim() || undefined,
    input,
  };
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

async function callOpenAI(model, messages, temperature, maxTokens, overrideKey, budgetKey) {
  if (isOpenAIProModel(model)) {
    return callOpenAIResponses(model, messages, temperature, maxTokens, overrideKey, budgetKey);
  }
  return callOpenAIChat(model, messages, temperature, maxTokens, overrideKey, budgetKey);
}

async function callOpenAIChat(model, messages, temperature, maxTokens, overrideKey, budgetKey) {
  const apiKey = overrideKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return buildLlmError("OPENAI_API_KEY not configured", { errorCode: "missing_api_key" });
  const budgetError = reserveLlmBudget("openai", model, messages, maxTokens, budgetKey);
  if (budgetError) return budgetError;

  const apiBody = {
    model,
    temperature,
    max_tokens: maxTokens,
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
      return buildLlmError(
        data.error?.message || JSON.stringify(data),
        {
          retryable: isRetryableErrorMessage(data.error?.message || ""),
          errorCode: data.error?.type || data.error?.code || "openai_error",
        }
      );
    }
    const result = {
      ok: true,
      content: data.choices?.[0]?.message?.content || "",
      usage: {
        input: data.usage?.prompt_tokens,
        output: data.usage?.completion_tokens,
      },
      model: data.model,
      stop_reason: data.choices?.[0]?.finish_reason,
    };
    recordLlmUsage(result.usage, budgetKey);
    return result;
  } catch (e) {
    if (e.name === "AbortError") return buildLlmError("LLM request timed out", { errorCode: "timeout" });
    return buildLlmError(`OpenAI API error: ${e.message}`, {
      retryable: isRetryableErrorMessage(e.message),
      errorCode: "openai_exception",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIResponses(model, messages, temperature, maxTokens, overrideKey, budgetKey) {
  const apiKey = overrideKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return buildLlmError("OPENAI_API_KEY not configured", { errorCode: "missing_api_key" });
  const budgetError = reserveLlmBudget("openai", model, messages, maxTokens, budgetKey);
  if (budgetError) return budgetError;

  const { instructions, input } = toResponsesInput(messages);
  const apiBody = {
    model,
    input,
    max_output_tokens: maxTokens,
    reasoning: { effort: "low" },
    text: { format: { type: "json_object" } },
  };
  if (instructions) {
    apiBody.instructions = instructions;
  }
  // GPT-5 pro models reject the temperature parameter on the Responses API.
  // Keep the client-side temperature setting for UI compatibility, but omit it here.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
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
      return buildLlmError(
        data.error?.message || JSON.stringify(data),
        {
          retryable: isRetryableErrorMessage(data.error?.message || ""),
          errorCode: data.error?.type || data.error?.code || "openai_error",
        }
      );
    }
    const result = {
      ok: true,
      content: extractResponsesText(data),
      usage: {
        input: data.usage?.input_tokens,
        output: data.usage?.output_tokens,
        reasoning: data.usage?.output_tokens_details?.reasoning_tokens || 0,
      },
      model: data.model,
      stop_reason: data.incomplete_details?.reason || data.status || null,
    };
    recordLlmUsage(result.usage, budgetKey);
    return result;
  } catch (e) {
    if (e.name === "AbortError") return buildLlmError("LLM request timed out", { errorCode: "timeout" });
    return buildLlmError(`OpenAI API error: ${e.message}`, {
      retryable: isRetryableErrorMessage(e.message),
      errorCode: "openai_exception",
    });
  } finally {
    clearTimeout(timer);
  }
}
