/**
 * Unified Multi-Provider Local & BYOK LLM Service
 * Supports: Ollama, LM Studio, llama.cpp, Custom OpenAI-compatible,
 * Google Gemini, OpenAI, Anthropic, OpenRouter, and Groq.
 */
const { CLOUD_CATALOG } = require('./catalog');

class ThinkTagStreamParser {
  constructor(onThinking, onContent) {
    this.onThinking = onThinking;
    this.onContent = onContent;
    this.inThink = false;
    this.buffer = '';
  }

  push(chunk) {
    if (!chunk) return;
    this.buffer += chunk;
    this._drain(false);
  }

  flush() {
    this._drain(true);
  }

  _drain(final) {
    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const openMatch = this.buffer.match(/<(think|thought)>/i);
        if (openMatch) {
          const before = this.buffer.slice(0, openMatch.index);
          if (before) this.onContent?.(before);
          this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length);
          this.inThink = true;
          continue;
        }
        if (!final) {
          // Hold back potential partial '<think>' or '<thought>' prefix at end of buffer
          const ltIdx = this.buffer.lastIndexOf('<');
          if (ltIdx !== -1 && this.buffer.length - ltIdx < 10) {
            const safe = this.buffer.slice(0, ltIdx);
            if (safe) this.onContent?.(safe);
            this.buffer = this.buffer.slice(ltIdx);
            return;
          }
        }
        this.onContent?.(this.buffer);
        this.buffer = '';
      } else {
        const closeMatch = this.buffer.match(/<\/(think|thought)>/i);
        if (closeMatch) {
          const thought = this.buffer.slice(0, closeMatch.index);
          if (thought) this.onThinking?.(thought);
          this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length);
          // Trim single leading newline after </think>
          if (this.buffer.startsWith('\n')) this.buffer = this.buffer.slice(1);
          this.inThink = false;
          continue;
        }
        if (!final) {
          const ltIdx = this.buffer.lastIndexOf('<');
          if (ltIdx !== -1 && this.buffer.length - ltIdx < 11) {
            const safe = this.buffer.slice(0, ltIdx);
            if (safe) this.onThinking?.(safe);
            this.buffer = this.buffer.slice(ltIdx);
            return;
          }
        }
        this.onThinking?.(this.buffer);
        this.buffer = '';
      }
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatFriendlyModelName(rawName) {
  if (!rawName) return 'Model';
  const base = rawName.split('/').pop();
  const [namePart, tagPart] = base.split(':');
  const pretty = namePart
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)b\b/gi, '$1B')
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bLlm\b/g, 'LLM');
  if (tagPart && tagPart !== 'latest') {
    return `${pretty} (${tagPart})`;
  }
  return pretty;
}

async function discoverModels(settings) {
  const models = [];
  const providerStatus = {
    ollama: { online: false, url: settings.ollamaUrl, count: 0 },
    lmstudio: { online: false, url: settings.lmStudioUrl, count: 0 },
    llamacpp: { online: false, url: settings.llamaCppUrl, count: 0 },
    custom: { online: false, url: settings.customOpenAiUrl, count: 0 },
    gemini: { configured: Boolean(settings.geminiApiKey) },
    openai: { configured: Boolean(settings.openaiApiKey) },
    anthropic: { configured: Boolean(settings.anthropicApiKey) },
    openrouter: { configured: Boolean(settings.openrouterApiKey) },
    groq: { configured: Boolean(settings.groqApiKey) }
  };

  // 1. Ollama Local Discovery
  if (settings.ollamaUrl) {
    try {
      const baseUrl = settings.ollamaUrl.replace(/\/+$/, '');
      const res = await fetchWithTimeout(`${baseUrl}/api/tags`, {}, 2500);
      if (res.ok) {
        const data = await res.json();
        providerStatus.ollama.online = true;
        const list = Array.isArray(data.models) ? data.models : [];
        providerStatus.ollama.count = list.length;
        for (const m of list) {
          models.push({
            id: m.name,
            name: formatFriendlyModelName(m.name),
            provider: 'ollama',
            providerLabel: 'Ollama (Local)',
            local: true,
            available: true,
            parameterSize: m.details?.parameter_size || '',
            quantization: m.details?.quantization_level || '',
            contextLength: m.details?.context_length || 32768,
            capabilities: Array.isArray(m.capabilities) ? m.capabilities : ['completion']
          });
        }
      }
    } catch {}
  }

  // 2. LM Studio Discovery
  if (settings.lmStudioUrl) {
    try {
      const baseUrl = settings.lmStudioUrl.replace(/\/+$/, '');
      const res = await fetchWithTimeout(`${baseUrl}/models`, {}, 1500);
      if (res.ok) {
        const data = await res.json();
        providerStatus.lmstudio.online = true;
        const list = Array.isArray(data.data) ? data.data : [];
        providerStatus.lmstudio.count = list.length;
        for (const m of list) {
          models.push({
            id: m.id,
            name: formatFriendlyModelName(m.id),
            provider: 'lmstudio',
            providerLabel: 'LM Studio (Local)',
            local: true,
            available: true,
            capabilities: ['tools', 'thinking', 'completion']
          });
        }
      }
    } catch {}
  }

  // 3. llama.cpp / LocalAI Server Discovery
  if (settings.llamaCppUrl) {
    try {
      const baseUrl = settings.llamaCppUrl.replace(/\/+$/, '');
      const res = await fetchWithTimeout(`${baseUrl}/models`, {}, 1500);
      if (res.ok) {
        const data = await res.json();
        providerStatus.llamacpp.online = true;
        const list = Array.isArray(data.data) ? data.data : [];
        providerStatus.llamacpp.count = list.length;
        for (const m of list) {
          models.push({
            id: m.id,
            name: formatFriendlyModelName(m.id),
            provider: 'llamacpp',
            providerLabel: 'llama.cpp (Local)',
            local: true,
            available: true,
            capabilities: ['thinking', 'completion']
          });
        }
      }
    } catch {}
  }

  // 4. Custom OpenAI-compatible Local/Remote Endpoint
  if (settings.customOpenAiUrl) {
    try {
      const baseUrl = settings.customOpenAiUrl.replace(/\/+$/, '');
      const headers = settings.customOpenAiKey
        ? { Authorization: `Bearer ${settings.customOpenAiKey}` }
        : {};
      const res = await fetchWithTimeout(`${baseUrl}/models`, { headers }, 2000);
      if (res.ok) {
        const data = await res.json();
        providerStatus.custom.online = true;
        const list = Array.isArray(data.data) ? data.data : [];
        providerStatus.custom.count = list.length;
        for (const m of list) {
          models.push({
            id: m.id,
            name: formatFriendlyModelName(m.id),
            provider: 'custom',
            providerLabel: 'Custom Endpoint',
            local: true,
            available: true,
            capabilities: ['tools', 'thinking', 'completion']
          });
        }
      }
    } catch {}
  }

  // 5. BYOK Cloud Catalog (always visible so users can switch or add keys easily)
  for (const item of CLOUD_CATALOG) {
    models.push({
      id: item.id,
      name: item.name,
      provider: item.provider,
      providerLabel: item.providerLabel,
      local: false,
      available: Boolean(settings[item.keyField]),
      capabilities: item.capabilities
    });
  }

  return { models, providerStatus };
}

/**
 * Stream from Ollama /api/chat with automatic resilience for `think` and `tools` params
 */
async function streamOllama({ model, messages, tools, thinkingEffort, temperature, maxTokens, settings, signal, onThinking, onContent }) {
  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const formattedMessages = messages.map((m) => {
    const msg = { role: m.role, content: m.content || '' };
    if (Array.isArray(m.images) && m.images.length > 0) {
      msg.images = m.images.map((img) => img.replace(/^data:[^;]+;base64,/, ''));
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      msg.tool_calls = m.tool_calls.map((tc) => ({
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? safeJsonParse(tc.function.arguments, {})
            : (tc.function.arguments || {})
        }
      }));
    }
    return msg;
  });

  const buildPayload = (thinkMode, includeTools) => {
    const body = {
      model,
      messages: formattedMessages,
      stream: true,
      options: {
        temperature: temperature ?? 0.7,
        num_predict: maxTokens || 8192
      }
    };
    if (thinkMode !== undefined) {
      body.think = thinkMode;
    }
    if (includeTools && Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
    }
    return body;
  };

  // Determine ordered fallback attempts for `think` parameter
  const thinkAttempts = [];
  if (!settings.streamThinking || thinkingEffort === 'off') {
    thinkAttempts.push(false, undefined);
  } else if (thinkingEffort === 'low' || thinkingEffort === 'medium' || thinkingEffort === 'high') {
    thinkAttempts.push(thinkingEffort, true, undefined);
  } else {
    thinkAttempts.push(true, undefined);
  }

  let response = null;
  let lastErrText = '';
  const hasTools = Array.isArray(tools) && tools.length > 0;

  outer: for (const includeTools of hasTools ? [true, false] : [false]) {
    for (const thinkVal of thinkAttempts) {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(thinkVal, includeTools)),
        signal
      });
      if (res.ok) {
        response = res;
        break outer;
      }
      lastErrText = await res.text().catch(() => res.statusText);
      // Only retry on 400 Bad Request (unsupported think level or tools)
      if (res.status !== 400) {
        throw new Error(`Ollama error (${res.status}): ${lastErrText}`);
      }
    }
  }

  if (!response) {
    throw new Error(`Ollama request failed: ${lastErrText}`);
  }

  let fullThinking = '';
  let fullContent = '';
  const collectedToolCalls = [];

  const tagParser = new ThinkTagStreamParser(
    (t) => {
      fullThinking += t;
      onThinking?.(t);
    },
    (c) => {
      fullContent += c;
      onContent?.(c);
    }
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    lineBuf += decoder.decode(value, { stream: true });
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      const msg = parsed.message || {};
      if (msg.thinking) {
        fullThinking += msg.thinking;
        onThinking?.(msg.thinking);
      }
      if (msg.content) {
        tagParser.push(msg.content);
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          collectedToolCalls.push({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: {
              name: tc.function?.name,
              arguments: typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {})
            }
          });
        }
      }
    }
  }
  tagParser.flush();

  return {
    thinking: fullThinking,
    content: fullContent,
    toolCalls: collectedToolCalls
  };
}

/**
 * Stream from any OpenAI-compatible API (LM Studio, llama.cpp, OpenAI, OpenRouter, Groq, Custom)
 */
async function streamOpenAICompatible({ baseUrl, apiKey, extraHeaders = {}, model, messages, tools, thinkingEffort, temperature, maxTokens, signal, onThinking, onContent }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const formattedMessages = messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id || 'call_default',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      };
    }
    if (Array.isArray(m.images) && m.images.length > 0 && m.role === 'user') {
      const parts = [{ type: 'text', text: m.content || '' }];
      for (const img of m.images) {
        const dataUrl = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
        parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
      return { role: 'user', content: parts };
    }
    const out = { role: m.role, content: m.content || '' };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      out.tool_calls = m.tool_calls;
    }
    return out;
  });

  const body = {
    model,
    messages: formattedMessages,
    stream: true,
    max_tokens: maxTokens || 8192
  };

  if (!/^o\d/i.test(model)) {
    body.temperature = temperature ?? 0.7;
  } else if (thinkingEffort && thinkingEffort !== 'off') {
    body.reasoning_effort = thinkingEffort;
  }

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  // Fallback without tools if local OpenAI-compatible server rejects tools
  if (!res.ok && res.status === 400 && body.tools) {
    delete body.tools;
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`API error (${res.status}): ${errText}`);
  }

  let fullThinking = '';
  let fullContent = '';
  const toolCallsByIndex = new Map();

  const tagParser = new ThinkTagStreamParser(
    (t) => {
      fullThinking += t;
      onThinking?.(t);
    },
    (c) => {
      fullContent += c;
      onContent?.(c);
    }
  );

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      const reasoningChunk = delta.reasoning_content || delta.reasoning;
      if (reasoningChunk) {
        fullThinking += reasoningChunk;
        onThinking?.(reasoningChunk);
      }

      if (delta.content) {
        tagParser.push(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsByIndex.has(idx)) {
            toolCallsByIndex.set(idx, {
              id: tc.id || `call_${Date.now()}_${idx}`,
              type: 'function',
              function: { name: '', arguments: '' }
            });
          }
          const entry = toolCallsByIndex.get(idx);
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.function.name += tc.function.name;
          if (tc.function?.arguments) entry.function.arguments += tc.function.arguments;
        }
      }
    }
  }
  tagParser.flush();

  return {
    thinking: fullThinking,
    content: fullContent,
    toolCalls: Array.from(toolCallsByIndex.values()).filter((t) => t.function.name)
  };
}

/**
 * Stream from Google Gemini REST v1beta API (BYOK)
 */
async function streamGemini({ apiKey, model, messages, tools, thinkingEffort, temperature, maxTokens, signal, onThinking, onContent }) {
  if (!apiKey) throw new Error('Google Gemini API key is missing. Add your BYOK key in Settings → Providers.');

  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const contents = nonSystem.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.name || 'tool_result',
            response: { result: m.content }
          }
        }]
      };
    }
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    if (Array.isArray(m.images)) {
      for (const img of m.images) {
        const match = img.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: safeJsonParse(tc.function.arguments, {})
          }
        });
      }
    }
    if (parts.length === 0) parts.push({ text: ' ' });
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts
    };
  });

  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens || 8192
    }
  };

  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemMessages.map((s) => s.content).join('\n\n') }]
    };
  }

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }))
    }];
  }

  if ((model.includes('2.5') || model.includes('3') || model.includes('4') || model.toLowerCase().includes('argon')) && thinkingEffort && thinkingEffort !== 'off') {
    const budgetMap = { low: 1024, medium: 4096, high: 8192 };
    body.generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: budgetMap[thinkingEffort] || 4096
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok && res.status === 400 && body.generationConfig.thinkingConfig) {
    delete body.generationConfig.thinkingConfig;
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  let fullThinking = '';
  let fullContent = '';
  const toolCalls = [];

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const parts = json.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.thought && p.text) {
          fullThinking += p.text;
          onThinking?.(p.text);
        } else if (p.text) {
          fullContent += p.text;
          onContent?.(p.text);
        } else if (p.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args || {})
            }
          });
        }
      }
    }
  }

  return { thinking: fullThinking, content: fullContent, toolCalls };
}

/**
 * Stream from Anthropic Messages API (BYOK)
 */
async function streamAnthropic({ apiKey, model, messages, tools, thinkingEffort, temperature, maxTokens, signal, onThinking, onContent }) {
  if (!apiKey) throw new Error('Anthropic API key is missing. Add your BYOK key in Settings → Providers.');

  const systemPrompt = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const convMessages = [];

  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      convMessages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id || 'toolu_default',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }]
      });
      continue;
    }
    const blocks = [];
    if (Array.isArray(m.images)) {
      for (const img of m.images) {
        const match = img.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] }
          });
        }
      }
    }
    if (m.content) blocks.push({ type: 'text', text: m.content });
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id || `toolu_${Date.now()}`,
          name: tc.function.name,
          input: safeJsonParse(tc.function.arguments, {})
        });
      }
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: ' ' });
    convMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blocks
    });
  }

  const body = {
    model,
    messages: convMessages,
    max_tokens: maxTokens || 8192,
    stream: true
  };
  if (systemPrompt) body.system = systemPrompt;

  if ((model.includes('3-7') || model.includes('3-8') || model.includes('4')) && thinkingEffort && thinkingEffort !== 'off') {
    const budgetMap = { low: 1024, medium: 2048, high: 4096 };
    const budget = budgetMap[thinkingEffort] || 2048;
    body.max_tokens = Math.max(body.max_tokens, budget + 2048);
    body.thinking = { type: 'enabled', budget_tokens: budget };
  } else {
    body.temperature = temperature ?? 0.7;
  }

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  let fullThinking = '';
  let fullContent = '';
  const toolBlocks = new Map();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let ev;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }

      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        toolBlocks.set(ev.index, {
          id: ev.content_block.id,
          type: 'function',
          function: { name: ev.content_block.name, arguments: '' }
        });
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
          fullThinking += ev.delta.thinking;
          onThinking?.(ev.delta.thinking);
        } else if (ev.delta?.type === 'text_delta' && ev.delta.text) {
          fullContent += ev.delta.text;
          onContent?.(ev.delta.text);
        } else if (ev.delta?.type === 'input_json_delta' && toolBlocks.has(ev.index)) {
          toolBlocks.get(ev.index).function.arguments += ev.delta.partial_json || '';
        }
      }
    }
  }

  return {
    thinking: fullThinking,
    content: fullContent,
    toolCalls: Array.from(toolBlocks.values())
  };
}

function safeJsonParse(str, fallback = {}) {
  try {
    return typeof str === 'string' ? JSON.parse(str) : (str || fallback);
  } catch {
    return fallback;
  }
}

async function streamChatCompletion(opts) {
  const { provider, model, settings } = opts;
  const activeProvider = provider || settings.selectedProvider || 'ollama';
  const activeModel = model || settings.selectedModel || 'yokocoder-4b:latest';
  const mergedOpts = {
    ...opts,
    provider: activeProvider,
    model: activeModel,
    thinkingEffort: opts.thinkingEffort ?? settings.thinkingEffort ?? 'high',
    temperature: opts.temperature ?? settings.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? settings.maxTokens ?? 8192
  };

  switch (activeProvider) {
    case 'ollama':
      return streamOllama(mergedOpts);
    case 'lmstudio':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: settings.lmStudioUrl || 'http://localhost:1234/v1',
        apiKey: 'lm-studio'
      });
    case 'llamacpp':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: settings.llamaCppUrl || 'http://localhost:8080/v1',
        apiKey: ''
      });
    case 'custom':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: settings.customOpenAiUrl,
        apiKey: settings.customOpenAiKey
      });
    case 'gemini':
      return streamGemini({
        ...mergedOpts,
        apiKey: settings.geminiApiKey
      });
    case 'openai':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: settings.openaiApiKey
      });
    case 'anthropic':
      return streamAnthropic({
        ...mergedOpts,
        apiKey: settings.anthropicApiKey
      });
    case 'openrouter':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: settings.openrouterApiKey,
        extraHeaders: {
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'OpenGemini'
        }
      });
    case 'groq':
      return streamOpenAICompatible({
        ...mergedOpts,
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: settings.groqApiKey
      });
    default:
      return streamOllama(mergedOpts);
  }
}

module.exports = {
  discoverModels,
  streamChatCompletion,
  formatFriendlyModelName,
  safeJsonParse
};
