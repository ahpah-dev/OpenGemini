const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');

const DEFAULT_SETTINGS = {
  ollamaUrl: 'http://localhost:11434',
  lmStudioUrl: 'http://localhost:1234/v1',
  llamaCppUrl: 'http://localhost:8080/v1',
  customOpenAiUrl: '',
  customOpenAiKey: '',
  selectedProvider: 'ollama',
  selectedModel: 'yokocoder-4b:latest',
  thinkingEffort: 'high', // 'off' | 'low' | 'medium' | 'high'
  temperature: 0.7,
  maxTokens: 8192,
  maxTaskSteps: 12,
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  openrouterApiKey: '',
  groqApiKey: '',
  imageProvider: 'qwen-image-local', // 'qwen-image-local' | 'nano-banana' | 'svg-llm' | 'pollinations' | 'openai' | 'sd-webui'
  qwenQuant: 'auto', // 'auto' | 'Q4_K_M' | 'Q5_K_M' | 'Q6_K' | 'Q8_0'
  sdBackend: 'auto', // 'auto' | 'vulkan' | 'cuda12' | 'cpu'
  imageAspectRatio: '1:1',
  imageResolution: '1K',
  sdWebUiUrl: 'http://127.0.0.1:7860',
  workspacePath: path.resolve(__dirname, '..', '..', '..'),
  approvalPolicy: 'always-proceed', // 'always-proceed' | 'request-review' | 'strict'
  nonWorkspaceAccess: 'ask', // 'allow' | 'ask' | 'deny'
  internetAccess: 'allow', // 'allow' | 'deny'
  terminalShell: process.platform === 'win32' ? 'powershell.exe' : 'bash',
  commandDenylist: ['rm -rf /', 'format ', 'del /s /q c:\\'],
  webSearchEnabled: true,
  streamThinking: true,
  userName: 'Ah Pah',
  userTier: 'Pro',
  userEmoji: '😅',
  theme: 'light'
};

const DEFAULT_GEMS = [
  {
    id: 'gem-antigravity-architect',
    name: 'Antigravity Architect',
    icon: '🚀',
    color: '#dbeafe',
    description: 'Full-stack software architect & autonomous coding pair programmer.',
    instructions: 'You are Antigravity Architect, an elite software engineer. Think systematically, write clean modular production code, verify edge cases, and build interactive artifacts whenever helpful.'
  },
  {
    id: 'gem-coding-partner',
    name: 'Coding Partner',
    icon: '💻',
    color: '#e0e7ff',
    description: 'Level up your coding skills, debug tricky errors, and refactor cleanly.',
    instructions: 'You are a sharp, pragmatic coding partner. Provide concise, idiomatic code with clear explanations, complexity analysis, and practical debugging steps.'
  },
  {
    id: 'gem-brainstormer',
    name: 'Brainstormer',
    icon: '💡',
    color: '#fef3c7',
    description: 'Generate fresh creative angles, product concepts, and plot twists.',
    instructions: 'You are an imaginative creative director and brainstormer. Offer bold, surprising, well-structured options rather than generic clichés.'
  },
  {
    id: 'gem-learning-coach',
    name: 'Learning Coach',
    icon: '🎓',
    color: '#dcfce7',
    description: 'Master complex subjects step-by-step with Socratic questions & analogies.',
    instructions: 'You are a supportive Socratic tutor. Break down complex ideas intuitively, check understanding with quick questions, and adapt to the learner.'
  },
  {
    id: 'gem-writing-editor',
    name: 'Writing Editor',
    icon: '✍️',
    color: '#fce7f3',
    description: 'Polish prose, tighten structure, and elevate clarity and tone.',
    instructions: 'You are an expert developmental and line editor. Offer crisp rewrites and explain why specific word choices and structural edits improve impact.'
  }
];

const DEFAULT_CUSTOMIZATIONS = {
  rules: [
    {
      id: 'rule-clean-code',
      name: 'Clean Code & Verification',
      scope: 'global',
      trigger: 'always_on',
      enabled: true,
      content: 'Write complete, runnable code without placeholders. Preserve existing comments and verify changes carefully.'
    },
    {
      id: 'rule-concise',
      name: 'Concise Markdown Formatting',
      scope: 'global',
      trigger: 'always_on',
      enabled: true,
      content: 'Format responses cleanly using GitHub-flavored Markdown, tables, and fenced code blocks with language tags.'
    }
  ],
  skills: [
    {
      id: 'skill-web-app-builder',
      name: 'interactive-artifact-builder',
      description: 'Creates rich self-contained HTML5/Canvas/SVG interactive apps, games, and visualizations.',
      enabled: true,
      content: '# Interactive Artifact Builder\nWhen asked to build a UI, visualization, calculator, or game, create a complete standalone HTML5 artifact using `create_artifact` with responsive styling and smooth interactivity.'
    },
    {
      id: 'skill-codebase-audit',
      name: 'workspace-code-audit',
      description: 'Audits workspace architecture, dependencies, security, and code quality.',
      enabled: true,
      content: '# Workspace Code Audit\n1. Use `list_files` and `search_files` to map the project.\n2. Inspect entrypoints and configs with `read_file`.\n3. Produce a structured Markdown architecture & recommendations artifact.'
    }
  ],
  mcpServers: [
    {
      id: 'mcp-filesystem',
      name: 'local-workspace-fs',
      command: 'builtin://workspace-fs',
      status: 'connected',
      enabled: true,
      description: 'Built-in sandboxed local filesystem & diff engine'
    },
    {
      id: 'mcp-web-research',
      name: 'duckduckgo-web-reader',
      command: 'builtin://web-search-fetch',
      status: 'connected',
      enabled: true,
      description: 'Zero-key live web search & webpage text reader'
    }
  ]
};

const DEFAULT_IMAGES = [
  {
    id: 'img-seed-gemini-orb',
    prompt: 'Minimalist glassmorphism geometric prism refracting soft sky blue light, studio render',
    provider: 'svg-studio',
    createdAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    svgContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><defs><radialGradient id="bg" cx="50%" cy="50%" r="65%"><stop offset="0%" stop-color="#dbeafe"/><stop offset="55%" stop-color="#eff6ff"/><stop offset="100%" stop-color="#ffffff"/></radialGradient><linearGradient id="star" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4285f4"/><stop offset="45%" stop-color="#9b72cb"/><stop offset="100%" stop-color="#d96570"/></linearGradient></defs><rect width="800" height="500" fill="url(#bg)"/><circle cx="400" cy="250" r="145" fill="none" stroke="#93c5fd" stroke-width="1.5" stroke-dasharray="6 6" opacity="0.7"/><path d="M400 105 C412 205 445 238 545 250 C445 262 412 295 400 395 C388 295 355 262 255 250 C355 238 388 205 400 105 Z" fill="url(#star)" opacity="0.92"/><circle cx="490" cy="155" r="16" fill="#60a5fa" opacity="0.45"/></svg>`
  }
];

function ensureDirsSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function readJson(filename, fallback) {
  ensureDirsSync();
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    await writeJson(filename, fallback);
    return structuredClone(fallback);
  }
}

async function writeJson(filename, data) {
  ensureDirsSync();
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = `${filePath}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmpPath, filePath);
  return data;
}

async function getSettings() {
  const saved = await readJson('settings.json', DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  return merged;
}

async function saveSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  await writeJson('settings.json', updated);
  return updated;
}

async function getChats() {
  const chats = await readJson('chats.json', []);
  // Ensure every chat has normalized fields and filter out accidental empty failed chats
  let mutated = false;
  const cleaned = chats.filter((c) => {
    if (
      c.title === 'hi' &&
      Array.isArray(c.messages) &&
      c.messages.length === 2 &&
      c.messages[1].role === 'assistant' &&
      !c.messages[1].content
    ) {
      mutated = true;
      return false;
    }
    return true;
  }).map((c) => ({
    id: c.id,
    title: c.title || 'Untitled chat',
    mode: c.mode || 'chat',
    pinned: Boolean(c.pinned),
    notebookId: c.notebookId || null,
    gemId: c.gemId || null,
    messages: Array.isArray(c.messages) ? c.messages : [],
    taskState: c.taskState || null,
    filesChanged: Array.isArray(c.filesChanged) ? c.filesChanged : [],
    createdAt: c.createdAt || c.updatedAt || new Date().toISOString(),
    updatedAt: c.updatedAt || new Date().toISOString()
  }));
  if (mutated) {
    await writeJson('chats.json', cleaned);
  }
  return cleaned;
}

async function saveChats(chats) {
  return writeJson('chats.json', chats);
}

async function upsertChat(chat) {
  const chats = await getChats();
  const idx = chats.findIndex((c) => c.id === chat.id);
  const now = new Date().toISOString();
  const record = {
    ...chat,
    updatedAt: chat.updatedAt || now,
    createdAt: chat.createdAt || now
  };
  if (idx >= 0) {
    chats[idx] = { ...chats[idx], ...record };
  } else {
    chats.unshift(record);
  }
  await saveChats(chats);
  return idx >= 0 ? chats[idx] : record;
}

async function deleteChat(id) {
  const chats = await getChats();
  const filtered = chats.filter((c) => c.id !== id);
  await saveChats(filtered);
  return true;
}

async function getNotebooks() {
  const notebooks = await readJson('notebooks.json', []);
  return notebooks.map((nb) => ({
    ...nb,
    sources: Array.isArray(nb.sources)
      ? nb.sources
      : nb.notes
        ? [{ id: `src-${nb.id}-notes`, title: 'Research Notes', type: 'text', content: `${nb.description || ''}\n\n${nb.notes}` }]
        : [],
    instructions: nb.instructions || nb.description || '',
    studyGuide: nb.studyGuide || '',
    flashcards: Array.isArray(nb.flashcards) ? nb.flashcards : [],
    audioScript: Array.isArray(nb.audioScript) ? nb.audioScript : []
  }));
}

async function saveNotebooks(notebooks) {
  return writeJson('notebooks.json', notebooks);
}

async function getArtifacts() {
  return readJson('artifacts.json', []);
}

async function saveArtifact({ id, title, type = 'html', content = '', description = '', chatId = null }) {
  ensureDirsSync();
  const artifacts = await getArtifacts();
  const artifactId = id || `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const extMap = { html: '.html', markdown: '.md', svg: '.svg', mermaid: '.mmd', code: '.txt', javascript: '.js', python: '.py' };
  const ext = extMap[type] || '.txt';
  const safeSlug = (title || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const filename = `${safeSlug}_${Date.now()}${ext}`;
  const filePath = path.join(ARTIFACTS_DIR, filename);
  await fsp.writeFile(filePath, content, 'utf8');

  const record = {
    id: artifactId,
    title: title || 'Untitled Artifact',
    type,
    filename,
    filePath,
    description,
    chatId,
    createdAt: new Date().toISOString()
  };

  const existingIdx = artifacts.findIndex((a) => a.id === artifactId);
  if (existingIdx >= 0) {
    artifacts[existingIdx] = { ...artifacts[existingIdx], ...record };
  } else {
    artifacts.unshift(record);
  }
  await writeJson('artifacts.json', artifacts);
  return { ...record, content };
}

async function getArtifactWithContent(id) {
  const artifacts = await getArtifacts();
  const item = artifacts.find((a) => a.id === id);
  if (!item) return null;
  let content = '';
  const candidatePath = item.filePath || path.join(ARTIFACTS_DIR, item.filename || '');
  try {
    content = await fsp.readFile(candidatePath, 'utf8');
  } catch {
    try {
      content = await fsp.readFile(path.join(ARTIFACTS_DIR, item.filename || ''), 'utf8');
    } catch {
      content = '';
    }
  }
  return { ...item, content };
}

async function deleteArtifact(id) {
  const artifacts = await getArtifacts();
  const target = artifacts.find((a) => a.id === id);
  if (target) {
    const p = target.filePath || path.join(ARTIFACTS_DIR, target.filename || '');
    await fsp.unlink(p).catch(() => {});
  }
  await writeJson('artifacts.json', artifacts.filter((a) => a.id !== id));
  return true;
}

async function getScheduled() {
  return readJson('scheduled.json', []);
}

async function saveScheduled(items) {
  return writeJson('scheduled.json', items);
}

async function getGems() {
  return readJson('gems.json', DEFAULT_GEMS);
}

async function saveGems(gems) {
  return writeJson('gems.json', gems);
}

async function getImages() {
  return readJson('images.json', DEFAULT_IMAGES);
}

async function saveImages(images) {
  return writeJson('images.json', images);
}

async function getCustomizations(workspacePath) {
  const saved = await readJson('customizations.json', DEFAULT_CUSTOMIZATIONS);
  // Also auto-discover GEMINI.md / AGENTS.md / .agents/skills/*/SKILL.md from workspacePath!
  const discoveredRules = [];
  const discoveredSkills = [];

  if (workspacePath) {
    for (const ruleFile of ['GEMINI.md', 'AGENTS.md']) {
      const p = path.join(workspacePath, ruleFile);
      try {
        const stat = await fsp.stat(p);
        if (stat.isFile() && stat.size < 100_000) {
          const content = await fsp.readFile(p, 'utf8');
          discoveredRules.push({
            id: `ws-rule-${ruleFile}`,
            name: `${ruleFile} (Workspace)`,
            scope: 'workspace',
            trigger: 'always_on',
            enabled: true,
            filePath: p,
            content
          });
        }
      } catch {}
    }

    for (const dirName of ['.agents', '.agent']) {
      const skillsRoot = path.join(workspacePath, dirName, 'skills');
      try {
        const entries = await fsp.readdir(skillsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillMd = path.join(skillsRoot, entry.name, 'SKILL.md');
            try {
              const content = await fsp.readFile(skillMd, 'utf8');
              discoveredSkills.push({
                id: `ws-skill-${entry.name}`,
                name: entry.name,
                description: `Workspace skill from ${dirName}/skills/${entry.name}`,
                scope: 'workspace',
                enabled: true,
                filePath: skillMd,
                content
              });
            } catch {}
          }
        }
      } catch {}
    }
  }

  return {
    rules: [...discoveredRules, ...(saved.rules || [])],
    skills: [...discoveredSkills, ...(saved.skills || [])],
    mcpServers: saved.mcpServers || DEFAULT_CUSTOMIZATIONS.mcpServers
  };
}

async function saveCustomizations(data) {
  // Only persist non-workspace-discovered items
  const clean = {
    rules: (data.rules || []).filter((r) => r.scope !== 'workspace'),
    skills: (data.skills || []).filter((s) => s.scope !== 'workspace'),
    mcpServers: data.mcpServers || []
  };
  return writeJson('customizations.json', clean);
}

module.exports = {
  DATA_DIR,
  ARTIFACTS_DIR,
  getSettings,
  saveSettings,
  getChats,
  saveChats,
  upsertChat,
  deleteChat,
  getNotebooks,
  saveNotebooks,
  getArtifacts,
  saveArtifact,
  getArtifactWithContent,
  deleteArtifact,
  getScheduled,
  saveScheduled,
  getGems,
  saveGems,
  getImages,
  saveImages,
  getCustomizations,
  saveCustomizations
};
