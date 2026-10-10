import { useBoardStore } from '../../store/useBoardStore';
import { getModelConfig, ModelProvider } from './models';

/**
 * Provider routing, extracted so anything that needs the model the teacher actually picked
 * — chat turns, note-tree indexing — resolves it the same way. Duplicating this was how the
 * Antigravity route ended up reachable from one call site and not the other.
 */
export interface LlmRoute {
  provider: ModelProvider;
  endpoint: string;
  apiKey: string;
  modelName: string;
  displayName: string;
}

/** Human names for the signed-in CLIs, for status lines and chat attribution. */
export const CLI_NAMES: Record<string, string> = { agy: 'Antigravity', claude: 'Claude Code' };

export function resolveLlmRoute(): LlmRoute {
  const store = useBoardStore.getState();

  // Signed-in CLI: no key, the local bridge runs the CLI with its own OAuth session.
  if (store.aiConnection === 'cli') {
    const cliName = CLI_NAMES[store.cliTool] ?? store.cliTool;
    return {
      provider: 'cli',
      endpoint: `/api/cli/${store.cliTool}/chat/completions`,
      apiKey: '',
      modelName: store.cliModel,
      displayName: `${store.cliModel || 'default model'} (${cliName} CLI)`
    };
  }

  const modelConfig = getModelConfig(store.selectedModelId);

  const route: LlmRoute = {
    provider: modelConfig.provider,
    endpoint: '',
    apiKey: '',
    modelName: modelConfig.id,
    displayName: `${modelConfig.name} (${modelConfig.providerName})`
  };

  if (modelConfig.provider === 'nvidia') {
    route.endpoint = '/api/nvidia/v1/chat/completions';
    route.apiKey = store.llmApiKey || store.groqApiKey;
    if (!route.apiKey) {
      throw new Error('NVIDIA NIM API Key missing. Please paste your nvapi-... key in Settings (⚙).');
    }
  } else if (modelConfig.provider === 'groq') {
    route.endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    route.apiKey = store.groqApiKey;
    if (!route.apiKey) {
      throw new Error('Groq API Key missing. Please paste your gsk_... key in Settings (⚙).');
    }
  } else if (modelConfig.provider === 'openai') {
    route.endpoint = 'https://api.openai.com/v1/chat/completions';
    route.apiKey = store.openaiApiKey;
    if (!route.apiKey) {
      throw new Error('OpenAI API Key missing. Please paste your sk-... key in Settings (⚙).');
    }
  } else if (modelConfig.provider === 'custom') {
    route.endpoint = store.customApiEndpoint
      ? `${store.customApiEndpoint.replace(/\/$/, '')}/chat/completions`
      : 'http://localhost:11434/v1/chat/completions';
    route.modelName = store.customModelId || 'mistralai/mistral-7b-instruct';
    route.apiKey = store.llmApiKey || store.openaiApiKey || 'local-key';
  }

  return route;
}

/**
 * A request that never settles is worse than one that fails: the UI waits forever with no
 * error to show. The local Antigravity middleware in particular can accept a connection and
 * then never answer.
 */
export const LLM_TIMEOUT_MS = 120000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = LLM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`The model did not respond within ${Math.round(timeoutMs / 1000)}s. Check the endpoint in Settings (⚙).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Headers for a call on this route. The CLI bridge requires X-Slate-Bridge — a custom
 * header forces a CORS preflight, so other sites cannot drive the local CLIs — and has no
 * key to send.
 */
export function llmHeaders(route: LlmRoute): Record<string, string> {
  if (route.provider === 'cli') return { 'Content-Type': 'application/json', 'X-Slate-Bridge': '1' };
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey}` };
}

/**
 * The error a provider sent, as readable text. The CLI bridge and OpenAI-style APIs both
 * wrap it as {error: {message}}; anything else is shown as it came.
 */
export function readableError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message ?? parsed?.error ?? raw;
  } catch {
    return raw;
  }
}

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  /** NVIDIA-only chain-of-thought switches. Off for indexing — it is an extraction job. */
  nvidiaThinking?: boolean;
}

export function buildLlmBody(messages: any[], route: LlmRoute, options: LlmCallOptions = {}): string {
  const body: any = {
    model: route.modelName,
    messages,
    temperature: options.temperature ?? 0.1
  };

  if (route.provider === 'nvidia') {
    body.top_p = 0.95;
    body.max_tokens = options.maxTokens ?? 16384;
    if (options.nvidiaThinking) {
      body.chat_template_kwargs = { thinking: true, reasoning_effort: 'high' };
    }
  } else if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  return JSON.stringify(body);
}

/**
 * One plain completion on the routed provider. No Groq fallback and no chat-feed side
 * effects — callers that need those (the board command path) own that behaviour.
 */
export async function callLlm(messages: any[], options: LlmCallOptions = {}): Promise<string> {
  const route = resolveLlmRoute();

  const response = await fetchWithTimeout(route.endpoint, {
    method: 'POST',
    headers: llmHeaders(route),
    body: buildLlmBody(messages, route, options)
  });

  if (!response.ok) {
    const errText = readableError(await response.text());
    throw new Error(`LLM call failed (${response.status}): ${errText}`);
  }

  const completion = await response.json();
  return completion.choices?.[0]?.message?.content || '';
}

/**
 * Pulls a JSON value out of a completion. Models wrap JSON in prose or fences no matter how
 * the prompt is worded, so the parse has to survive that rather than assume clean output.
 */
export function extractJson<T>(raw: string): T | undefined {
  if (!raw) return undefined;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();

  const candidates = [body];
  const firstArray = body.indexOf('[');
  const lastArray = body.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) candidates.push(body.slice(firstArray, lastArray + 1));

  const firstObject = body.indexOf('{');
  const lastObject = body.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) candidates.push(body.slice(firstObject, lastObject + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next slice
    }
  }

  return undefined;
}
