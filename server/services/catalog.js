/**
 * Model catalog — the single place to update when new models ship.
 *
 * IDs were verified on 2026-10-31 against:
 *  - Gemini API docs (ai.google.dev/gemini-api/docs/models)
 *  - OpenRouter's public model list (openrouter.ai/api/v1/models)
 *  - Anthropic / OpenAI / Groq model docs
 *  - Ollama library tags (ollama.com/library)
 */

const G = { provider: 'gemini', providerLabel: 'Google Gemini (BYOK)', keyField: 'geminiApiKey' };
const O = { provider: 'openai', providerLabel: 'OpenAI (BYOK)', keyField: 'openaiApiKey' };
const A = { provider: 'anthropic', providerLabel: 'Anthropic (BYOK)', keyField: 'anthropicApiKey' };
const R = { provider: 'openrouter', providerLabel: 'OpenRouter (BYOK)', keyField: 'openrouterApiKey' };
const Q = { provider: 'groq', providerLabel: 'Groq (BYOK)', keyField: 'groqApiKey' };

const FULL = ['tools', 'thinking', 'vision'];
const TT = ['tools', 'thinking'];

const CLOUD_CATALOG = [
  // Google Gemini
  { ...G, id: 'gemini-4-argon', name: 'Gemini 4 Argon', capabilities: FULL },
  { ...G, id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', capabilities: FULL },
  { ...G, id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', capabilities: FULL },
  { ...G, id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', capabilities: ['tools', 'vision'] },
  { ...G, id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', capabilities: FULL },

  // OpenAI
  { ...O, id: 'gpt-6-astra', name: 'GPT-6 Astra', capabilities: FULL },
  { ...O, id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', capabilities: FULL },
  { ...O, id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', capabilities: FULL },
  { ...O, id: 'gpt-6-luna', name: 'GPT-6 Luna', capabilities: FULL },

  // Anthropic (dateless IDs)
  { ...A, id: 'claude-opus-5-5', name: 'Claude Opus 5.5', capabilities: FULL },
  { ...A, id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', capabilities: FULL },
  { ...A, id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', capabilities: FULL },
  { ...A, id: 'claude-fable-5-1', name: 'Claude Fable 5.1', capabilities: FULL },

  // OpenRouter (any model on openrouter.ai works — these are shortcuts)
  { ...R, id: 'deepseek/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro', capabilities: TT },
  { ...R, id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', capabilities: TT },
  { ...R, id: 'qwen/qwen3.8-max-0902', name: 'Qwen 3.8 Max', capabilities: TT },
  { ...R, id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', capabilities: TT },
  { ...R, id: 'moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro', capabilities: TT },
  { ...R, id: 'z-ai/glm-5.3', name: 'GLM 5.3', capabilities: TT },
  { ...R, id: 'x-ai/grok-4.7', name: 'Grok 4.7', capabilities: TT },
  { ...R, id: 'mistralai/mistral-large-4-0', name: 'Mistral Large 4', capabilities: TT },

  // Groq
  { ...Q, id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (Groq)', capabilities: TT },
  { ...Q, id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (Groq)', capabilities: TT },
  { ...Q, id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick (Groq)', capabilities: ['tools', 'vision'] },
  { ...Q, id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', capabilities: ['tools'] },
  { ...Q, id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2 (Groq)', capabilities: ['tools'] }
];

/** One-click `ollama pull` suggestions shown in the setup panel. */
const RECOMMENDED_LOCAL = [
  { id: 'qwen3.5:4b', name: 'Qwen 3.5 4B', tier: 'Light', note: 'Fast on any laptop. Great first model.' },
  { id: 'qwen3.5:9b', name: 'Qwen 3.5 9B', tier: 'Balanced', note: 'Strong all-rounder for 8 GB+ GPUs.' },
  { id: 'gemma4:12b', name: 'Gemma 4 12B', tier: 'Balanced', note: "Google's open model. Good for 12 GB GPUs." },
  { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', tier: 'Heavy', note: 'Reasoning and tool use. Wants 16 GB.' },
  { id: 'qwen3-coder:30b', name: 'Qwen3-Coder 30B', tier: 'Heavy', note: 'Best local coding agent. Wants 24 GB.' },
  { id: 'qwen3.8:27b', name: 'Qwen 3.8 27B', tier: 'Heavy', note: 'Newest dense Qwen. Wants 24 GB.' }
];

module.exports = { CLOUD_CATALOG, RECOMMENDED_LOCAL };
