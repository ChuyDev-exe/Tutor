import * as vscode from 'vscode';

export type ApiKind = 'openai' | 'anthropic' | 'gemini';

export interface ProviderDef {
  id: string;
  label: string;
  kind: ApiKind;
  baseUrl: string;
  models: string[];
  needsKey: boolean;
  nota?: string;
  /** Página donde el usuario obtiene su API key. */
  keyUrl?: string;
}

/** Proveedores soportados. "openai" = API compatible con /chat/completions. */
export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-4-5',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5',
      'claude-3-5-haiku-latest',
    ],
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (multi-modelo)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq (rápido y barato)',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'opencode',
    label: 'OpenCode (local, vía opencode serve)',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:4096/v1',
    models: ['opencode/gpt-5.1-codex', 'anthropic/claude-sonnet-4-5', 'local-model'],
    needsKey: false,
    nota: 'Ejecuta `opencode serve --port 4096` y ajusta el puerto si usas otro.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5-coder', 'mistral'],
    needsKey: false,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    models: ['local-model'],
    needsKey: false,
  },
  {
    id: 'custom',
    label: 'Otro (cualquier API compatible con OpenAI)',
    kind: 'openai',
    baseUrl: '',
    models: [],
    needsKey: true,
    nota: 'Cubre proveedores y proxies que expongan POST /chat/completions.',
  },
];

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SECRET_PREFIX = 'tutor.apiKey:';

export function getProviderDef(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export function apiKindOfProvider(id: string): ApiKind {
  return getProviderDef(id).kind;
}

export async function getApiKey(context: vscode.ExtensionContext, providerId: string): Promise<string> {
  return (await context.secrets.get(SECRET_PREFIX + providerId)) || '';
}

export async function setApiKey(
  context: vscode.ExtensionContext,
  providerId: string,
  key: string
): Promise<void> {
  if (key) {
    await context.secrets.store(SECRET_PREFIX + providerId, key);
  } else {
    await context.secrets.delete(SECRET_PREFIX + providerId);
  }
}

export interface ActiveConfig {
  providerId: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export async function getActiveConfig(
  context: vscode.ExtensionContext
): Promise<ActiveConfig> {
  const cfg = vscode.workspace.getConfiguration('tutor');
  const providerId = cfg.get<string>('provider') || 'openai';
  const def = getProviderDef(providerId);
  const baseUrl = (cfg.get<string>('apiBaseUrl') || def.baseUrl).replace(/\/+$/, '');
  const model = cfg.get<string>('model') || def.models[0] || '';
  const hasKey = !def.needsKey || !!(await getApiKey(context, providerId));
  return { providerId, baseUrl, model, hasKey };
}

/** Pide al proveedor la lista de modelos disponibles. Lanza si no responde o no hay lista. */
export async function listModels(
  def: ProviderDef,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    let url: string;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (def.kind === 'anthropic') {
      url = `${base}/v1/models?limit=1000`;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (def.kind === 'gemini') {
      url = `${base}/v1beta/models?pageSize=1000`;
      headers['x-goog-api-key'] = apiKey;
    } else {
      url = `${base}/models`;
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    let ids: string[];
    if (def.kind === 'gemini') {
      ids = (data.models || [])
        .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
    } else {
      ids = (data.data || data.models || []).map((m: any) => String(m.id || m.name || ''));
    }
    ids = ids.filter(Boolean);
    if (def.id === 'openai') {
      ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(embedding|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|search)/.test(id));
    }
    if (!ids.length) throw new Error('lista vacía');
    return Array.from(new Set(ids)).sort();
  } finally {
    clearTimeout(timer);
  }
}

/** Recibe el texto acumulado de la respuesta mientras llega (streaming). */
export type OnText = (soFar: string) => void;

/** Sin datos del proveedor durante este tiempo, se aborta la petición. */
const IDLE_TIMEOUT_MS = 90_000;

/**
 * Envía la conversación al proveedor activo. El system prompt del tutor
 * SIEMPRE viaja como primer mensaje/instrucción: el modo mentor no se puede saltar.
 * Con `onText` la respuesta llega en streaming; si el proveedor no lo soporta, llega entera.
 */
export async function chat(
  context: vscode.ExtensionContext,
  systemPrompt: string,
  history: ChatMessage[],
  onText?: OnText
): Promise<string> {
  const { providerId, baseUrl, model, hasKey } = await getActiveConfig(context);
  const def = getProviderDef(providerId);

  if (!baseUrl || !model) {
    throw new Error('Falta configurar URL base o modelo. Usa "Tutor: Configurar IA del tutor".');
  }
  if (def.needsKey && !hasKey) {
    throw new Error(`Falta la API key para ${def.label}. Usa "Tutor: Configurar IA del tutor".`);
  }
  const apiKey = await getApiKey(context, providerId);

  const controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  const alive = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  const req = (() => {
    switch (def.kind) {
      case 'anthropic':
        return anthropicRequest(baseUrl, model, apiKey, systemPrompt, history);
      case 'gemini':
        return geminiRequest(baseUrl, model, apiKey, systemPrompt, history);
      default:
        return openAIRequest(baseUrl, model, apiKey, systemPrompt, history);
    }
  })();
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...req.headers },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    }
    let content: string;
    // algunos servidores compatibles ignoran `stream` y responden JSON: se aceptan ambos
    if (res.body && (res.headers.get('content-type') || '').includes('text/event-stream')) {
      content = '';
      for await (const data of readSSE(res.body, alive)) {
        const piece = req.delta(data);
        if (!piece) continue;
        content += piece;
        onText?.(content);
      }
    } else {
      content = req.full(await res.json());
    }
    if (!content) throw new Error('La API no devolvió contenido.');
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('La IA dejó de responder (90 s sin datos). Inténtalo de nuevo.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Texto de un evento del stream (data: …). */
  delta: (data: any) => string | undefined;
  /** Texto de una respuesta JSON completa (sin streaming). */
  full: (data: any) => string;
}

/** Lee un cuerpo text/event-stream y devuelve el JSON de cada línea `data:`. */
export async function* readSSE(body: ReadableStream<Uint8Array>, onChunk?: () => void): AsyncGenerator<any> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    onChunk?.();
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const data = parseSSELine(line);
      if (data !== undefined) yield data;
    }
  }
  const data = parseSSELine(pending);
  if (data !== undefined) yield data;
}

function parseSSELine(line: string): any {
  if (!line.startsWith('data:')) return undefined;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return undefined;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function openAIRequest(baseUrl: string, model: string, apiKey: string, systemPrompt: string, history: ChatMessage[]): ProviderRequest {
  return {
    url: `${baseUrl}/chat/completions`,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    // o1/o3/o4 y gpt-5 exigen max_completion_tokens y no aceptan temperature
    body: {
      model,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      ...(/^(o\d|gpt-5)/i.test(model.split('/').pop() || '')
        ? { max_completion_tokens: 1500 }
        : { temperature: 0.4, max_tokens: 800 }),
    },
    delta: (d) => d?.choices?.[0]?.delta?.content,
    full: (d) => d?.choices?.[0]?.message?.content || '',
  };
}

function anthropicRequest(baseUrl: string, model: string, apiKey: string, systemPrompt: string, history: ChatMessage[]): ProviderRequest {
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/v1/messages`,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: {
      model,
      stream: true,
      system: systemPrompt,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 800,
      temperature: 0.4,
    },
    delta: (d) => {
      if (d?.type === 'error') throw new Error(`Error: ${d.error?.message || 'el proveedor cortó la respuesta'}`);
      return d?.type === 'content_block_delta' && d.delta?.type === 'text_delta' ? d.delta.text : undefined;
    },
    full: (d) =>
      (d?.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n'),
  };
}

function geminiRequest(baseUrl: string, model: string, apiKey: string, systemPrompt: string, history: ChatMessage[]): ProviderRequest {
  const text = (d: any) => (d?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': apiKey },
    body: {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    },
    delta: text,
    // sin SSE, streamGenerateContent devuelve un arreglo de fragmentos
    full: (d) => (Array.isArray(d) ? d.map(text).join('') : text(d)),
  };
}
