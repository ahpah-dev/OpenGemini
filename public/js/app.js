import { apiGet, apiPost, apiDelete, streamSsePost } from './api.js';
import { escapeHtml, renderMarkdown } from './markdown.js';
import { AuxiliaryPane } from './auxiliary.js';
import {
  renderLibraryHub,
  renderImagesHub,
  renderScheduledHub,
  renderStudentsHub,
  renderNotebooksHub,
  renderMoreHub
} from './views.js';

const SLASH_COMMANDS = [
  { cmd: '/task', desc: 'Switch to autonomous multi-step Task Agent mode' },
  { cmd: '/plan', desc: 'Create a step-by-step Implementation Plan artifact first' },
  { cmd: '/goal', desc: 'Run thorough goal-driven verification loop until complete' },
  { cmd: '/research', desc: 'Run Deep Research multi-query web synthesis with citations' },
  { cmd: '/canvas', desc: 'Build or open interactive live preview in Canvas' },
  { cmd: '/image', desc: 'Open AI Images Studio' },
  { cmd: '/schedule', desc: 'Open Scheduled Actions manager' },
  { cmd: '/quiz', desc: 'Open Students Adaptive Quiz & Flashcards hub' },
  { cmd: '/compact', desc: 'Summarize & compact conversation context' },
  { cmd: '/clear', desc: 'Start a fresh conversation' }
];

const CHAT_STARTERS = [
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>`,
    text: 'Suggest a cafe to work from today'
  },
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
    text: 'Draft a high-stakes plot twist'
  },
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="5" r="2"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/></svg>`,
    text: 'Build a fitness plan that fits my week'
  }
];

const TASK_STARTERS = [
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 9h6M9 13h6"/></svg>`,
    text: 'Inspect my workspace files and build a project architecture report'
  },
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    text: 'Create a playable Neon Breakout HTML5 game artifact in Canvas'
  },
  {
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
    text: 'Search the web for top local coding LLMs and compile a cited comparison'
  }
];

const GEMINI_STAR_SVG = `
  <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">
    <defs>
      <linearGradient id="msgStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4285f4" />
        <stop offset="45%" stop-color="#9b72cb" />
        <stop offset="85%" stop-color="#d96570" />
      </linearGradient>
    </defs>
    <path fill="url(#msgStarGrad)" d="M14 2C15.1 10.3 17.7 12.9 26 14C17.7 15.1 15.1 17.7 14 26C12.9 17.7 10.3 15.1 2 14C10.3 12.9 12.9 10.3 14 2Z" />
  </svg>
`;

class OpenGeminiApp {
  constructor() {
    this.state = {
      settings: {},
      models: [],
      providerStatus: {},
      chats: [],
      notebooks: [],
      artifacts: [],
      images: [],
      scheduled: [],
      gems: [],
      customizations: { rules: [], skills: [], mcpServers: [] },
      activeChatId: null,
      activeMode: 'chat', // 'chat' | 'task'
      activeNav: 'new-chat',
      historyFilter: 'all',
      temporaryChat: false,
      activeGemId: null,
      activeNotebookId: null,
      attachments: [], // { type: 'image'|'file', name, content, dataUrl }
      isStreaming: false,
      activeRunId: null,
      abortController: null
    };

    this.auxPane = null;
    this.recognition = null;
    this.isListening = false;
  }

  async init() {
    this.auxPane = new AuxiliaryPane(this.state, (msg) => this.toast(msg));
    this._bindCoreDom();

    try {
      const boot = await apiGet('/api/bootstrap');
      Object.assign(this.state, boot);
      // Auto-select first available local model if configured model isn't found
      if (this.state.models.length > 0) {
        const match = this.state.models.find(
          (m) => m.id === this.state.settings.selectedModel && m.provider === this.state.settings.selectedProvider
        );
        if (!match) {
          const firstAvail = this.state.models.find((m) => m.available);
          if (firstAvail) {
            this.state.settings.selectedModel = firstAvail.id;
            this.state.settings.selectedProvider = firstAvail.provider;
          }
        }
      }
      this.applySettingsToUi();
      this.renderSidebarNotebooks();
      this.renderSidebarHistory();
      this.renderStarterSuggestions();
      this.updateModelButton();
    } catch (err) {
      this.toast(`Startup error: ${err.message}`);
    }
  }

  toast(message) {
    const stack = document.getElementById('toast-container');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  applySettingsToUi() {
    const s = this.state.settings;
    const theme = s.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const hljsLink = document.getElementById('hljs-theme');
    if (hljsLink) {
      hljsLink.href =
        theme === 'dark'
          ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css'
          : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css';
    }

    document.getElementById('user-name-label').textContent = s.userName || 'Ah Pah';
    document.getElementById('user-tier-label').textContent = s.userTier || 'Pro';
    document.getElementById('user-emoji-span').textContent = s.userEmoji || '😅';

    const ps = this.state.providerStatus || {};
    const anyOnline = ps.ollama?.online || ps.lmstudio?.online || ps.llamacpp?.online || ps.gemini?.configured || ps.openai?.configured || ps.anthropic?.configured;
    const dot = document.getElementById('provider-dot');
    dot?.classList.toggle('online', Boolean(anyOnline));

    const pillLabel = document.getElementById('runtime-pill-label');
    if (pillLabel) {
      if (ps.ollama?.online) pillLabel.textContent = `Ollama · ${ps.ollama.count} local`;
      else if (ps.lmstudio?.online) pillLabel.textContent = `LM Studio · Online`;
      else pillLabel.textContent = `Get app / Local AI`;
    }
  }

  updateModelButton() {
    const s = this.state.settings;
    const current = this.state.models.find(
      (m) => m.id === s.selectedModel && m.provider === s.selectedProvider
    );
    let shortName = current ? current.name : this._shortenModel(s.selectedModel || 'Model');
    if (/argon/i.test(shortName)) shortName = 'Argon';
    const effort = s.thinkingEffort || 'high';
    document.getElementById('active-model-short').textContent = shortName;
    document.getElementById('active-effort-label').textContent =
      effort === 'off' ? 'Fast' : effort.charAt(0).toUpperCase() + effort.slice(1);
  }

  _shortenModel(raw = '') {
    if (!raw) return 'Model';
    if (/argon/i.test(raw)) return 'Argon';
    return raw.split('/').pop().split(':')[0].replace(/[-_]/g, ' ');
  }

  _bindCoreDom() {
    // Sidebar collapse / expand
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('expand-sidebar-btn');
    document.getElementById('toggle-sidebar-btn')?.addEventListener('click', () => {
      sidebar.classList.add('collapsed');
      expandBtn.classList.remove('hidden');
    });
    expandBtn?.addEventListener('click', () => {
      sidebar.classList.remove('collapsed');
      expandBtn.classList.add('hidden');
    });

    // Brand Home & Primary Nav
    document.getElementById('brand-home-btn')?.addEventListener('click', () => this.startNewChat());
    document.querySelectorAll('.nav-item[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => this.navigatePrimary(btn.dataset.nav));
    });

    // Notebooks shortcuts in sidebar
    document.getElementById('new-notebook-sidebar-btn')?.addEventListener('click', async () => {
      const created = await apiPost('/api/notebooks', {
        title: 'New Research Notebook',
        instructions: 'Ground responses in this notebook.',
        sources: []
      });
      this.state.notebooks.unshift(created);
      this.renderSidebarNotebooks();
      this.openHub('notebooks', created.id);
    });
    document.getElementById('all-notebooks-btn')?.addEventListener('click', () => {
      this.openHub('notebooks');
    });

    // History filter funnel
    document.getElementById('filter-history-btn')?.addEventListener('click', () => {
      document.getElementById('history-filter-pills')?.classList.toggle('hidden');
    });
    document.querySelectorAll('[data-hfilter]').forEach((pill) => {
      pill.addEventListener('click', () => {
        this.state.historyFilter = pill.dataset.hfilter;
        document.querySelectorAll('[data-hfilter]').forEach((p) => p.classList.toggle('active', p === pill));
        const labelMap = { all: 'All', chat: 'Chats', task: 'Tasks', pinned: 'Pinned' };
        document.getElementById('history-filter-label').textContent = labelMap[this.state.historyFilter] || 'All';
        this.renderSidebarHistory();
      });
    });

    // Search Ctrl+K
    document.getElementById('search-chats-btn')?.addEventListener('click', () => this.openSearchModal());
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openSearchModal();
      }
      if (e.key === 'Escape') {
        this.closePopovers();
        document.getElementById('modal-backdrop')?.classList.add('hidden');
      }
    });

    // Top-right buttons
    document.getElementById('toggle-aux-pane-btn')?.addEventListener('click', () => {
      this.auxPane.toggle();
    });
    document.getElementById('get-app-status-btn')?.addEventListener('click', () => {
      this.openRuntimeStatusModal();
    });
    document.getElementById('user-profile-btn')?.addEventListener('click', () => {
      this.openSettingsModal();
    });
    document.getElementById('open-settings-btn')?.addEventListener('click', () => {
      this.openSettingsModal();
    });

    // Temporary Chat toggle
    const tempBtn = document.getElementById('temp-chat-btn');
    tempBtn?.addEventListener('click', () => {
      this.state.temporaryChat = !this.state.temporaryChat;
      tempBtn.classList.toggle('active-toggle', this.state.temporaryChat);
      this.renderContextBadges();
      this.toast(
        this.state.temporaryChat
          ? 'Temporary Chat ON — messages will not be saved to history'
          : 'Temporary Chat OFF'
      );
    });

    // Chat | Task Mode Toggle
    document.getElementById('mode-chat-btn')?.addEventListener('click', () => this.setMode('chat'));
    document.getElementById('mode-task-btn')?.addEventListener('click', () => this.setMode('task'));

    // Composer textarea & Send/Voice button
    const input = document.getElementById('prompt-input');
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(180, input.scrollHeight)}px`;
      this.syncComposerActionBtn();
      this.handleSlashOrMentionAutocomplete(input.value);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const slashMenu = document.getElementById('slash-menu');
        if (slashMenu && !slashMenu.classList.contains('hidden')) {
          const first = slashMenu.querySelector('.popover-item');
          if (first) {
            e.preventDefault();
            first.click();
            return;
          }
        }
        e.preventDefault();
        this.handleSubmit();
      }
    });

    // Drag & Drop files onto composer
    const composerBox = document.getElementById('composer-box');
    composerBox?.addEventListener('dragover', (e) => e.preventDefault());
    composerBox?.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) {
        this.handleFilesSelected(e.dataTransfer.files);
      }
    });

    document.getElementById('voice-or-send-btn')?.addEventListener('click', () => {
      if (this.state.isStreaming) {
        this.cancelStreaming();
      } else if (input.value.trim() || this.state.attachments.length > 0) {
        this.handleSubmit();
      } else {
        this.toggleVoiceDictation();
      }
    });

    // Plus (+) Menu
    document.getElementById('plus-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('model-popover')?.classList.add('hidden');
      document.getElementById('plus-menu')?.classList.toggle('hidden');
    });

    const hiddenFile = document.getElementById('hidden-file-input');
    document.getElementById('upload-file-action')?.addEventListener('click', () => {
      this.closePopovers();
      hiddenFile?.click();
    });
    hiddenFile?.addEventListener('change', () => {
      if (hiddenFile.files?.length) this.handleFilesSelected(hiddenFile.files);
      hiddenFile.value = '';
    });

    document.getElementById('attach-workspace-action')?.addEventListener('click', () => {
      this.closePopovers();
      this.openWorkspaceFilePicker();
    });
    document.getElementById('attach-notebook-action')?.addEventListener('click', () => {
      this.closePopovers();
      this.openNotebookPickerModal();
    });
    document.getElementById('open-canvas-action')?.addEventListener('click', () => {
      this.closePopovers();
      this.auxPane.open('canvas');
    });
    document.getElementById('deep-research-action')?.addEventListener('click', () => {
      this.closePopovers();
      const q = input.value.trim();
      if (q) {
        input.value = '';
        this.startDeepResearchInChat(q);
      } else {
        this.setPromptAndFocus('/research ');
      }
    });
    document.getElementById('pick-gem-action')?.addEventListener('click', () => {
      this.closePopovers();
      this.openGemPickerModal();
    });

    // Model Picker Popover
    document.getElementById('model-picker-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('plus-menu')?.classList.add('hidden');
      this.toggleModelPopover();
    });

    // Global click-outside to close popovers & delegate code block buttons
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.plus-popover') && !e.target.closest('#plus-btn')) {
        document.getElementById('plus-menu')?.classList.add('hidden');
      }
      if (!e.target.closest('.model-popover') && !e.target.closest('#model-picker-btn')) {
        document.getElementById('model-popover')?.classList.add('hidden');
      }
      if (!e.target.closest('#slash-menu') && !e.target.closest('#prompt-input')) {
        document.getElementById('slash-menu')?.classList.add('hidden');
      }

      const copyBtn = e.target.closest('.copy-code-btn');
      if (copyBtn) {
        navigator.clipboard.writeText(decodeURIComponent(copyBtn.dataset.code || ''));
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
      }

      const canvasBtn = e.target.closest('.canvas-code-btn');
      if (canvasBtn) {
        const raw = decodeURIComponent(canvasBtn.dataset.code || '');
        const lang = (canvasBtn.dataset.lang || 'html').toLowerCase();
        this.auxPane.setCanvasArtifact({
          title: `Canvas (${lang.toUpperCase()})`,
          type: lang === 'svg' ? 'svg' : lang === 'html' ? 'html' : lang === 'md' || lang === 'markdown' ? 'markdown' : 'code',
          content: raw
        });
        this.auxPane.open('canvas');
      }
    });

    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') {
        e.currentTarget.classList.add('hidden');
      }
    });
  }

  closePopovers() {
    document.getElementById('plus-menu')?.classList.add('hidden');
    document.getElementById('model-popover')?.classList.add('hidden');
    document.getElementById('slash-menu')?.classList.add('hidden');
  }

  setMode(mode) {
    this.state.activeMode = mode === 'task' ? 'task' : 'chat';
    document.getElementById('mode-chat-btn')?.classList.toggle('active', this.state.activeMode === 'chat');
    document.getElementById('mode-task-btn')?.classList.toggle('active', this.state.activeMode === 'task');

    const input = document.getElementById('prompt-input');
    const heading = document.getElementById('hero-heading');
    if (this.state.activeMode === 'task') {
      if (input) input.placeholder = 'Describe a task to plan & execute...';
      if (heading) heading.textContent = 'What task should we tackle?';
    } else {
      if (input) input.placeholder = 'Ask Gemini';
      if (heading) heading.textContent = 'Where should we start?';
    }
    this.renderStarterSuggestions();
  }

  renderStarterSuggestions() {
    const el = document.getElementById('starter-suggestions');
    if (!el) return;
    const list = this.state.activeMode === 'task' ? TASK_STARTERS : CHAT_STARTERS;
    el.innerHTML = list
      .map(
        (item) => `
        <button class="starter-item" data-prompt="${escapeHtml(item.text)}">
          <span class="starter-icon">${item.icon}</span>
          <span>${escapeHtml(item.text)}</span>
        </button>`
      )
      .join('');

    el.querySelectorAll('.starter-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setPromptAndFocus(btn.dataset.prompt);
        this.handleSubmit();
      });
    });
  }

  setPromptAndFocus(text) {
    const input = document.getElementById('prompt-input');
    if (!input) return;
    input.value = text;
    input.style.height = 'auto';
    input.style.height = `${Math.min(180, input.scrollHeight)}px`;
    this.syncComposerActionBtn();
    input.focus();
  }

  syncComposerActionBtn() {
    const input = document.getElementById('prompt-input');
    const hasText = Boolean(input?.value.trim()) || this.state.attachments.length > 0;
    const btn = document.getElementById('voice-or-send-btn');
    const mic = document.getElementById('mic-icon');
    const send = document.getElementById('send-icon');
    const stop = document.getElementById('stop-icon');

    btn?.classList.remove('ready-send', 'streaming-stop');
    mic?.classList.add('hidden');
    send?.classList.add('hidden');
    stop?.classList.add('hidden');

    if (this.state.isStreaming) {
      btn?.classList.add('streaming-stop');
      stop?.classList.remove('hidden');
    } else if (hasText) {
      btn?.classList.add('ready-send');
      send?.classList.remove('hidden');
    } else {
      mic?.classList.remove('hidden');
    }
  }

  navigatePrimary(nav) {
    this.state.activeNav = nav;
    document.querySelectorAll('.nav-item[data-nav]').forEach((b) => {
      b.classList.toggle('active', b.dataset.nav === nav);
    });

    if (nav === 'new-chat') {
      this.startNewChat();
    } else {
      this.openHub(nav);
    }
  }

  openHub(hubName, extraParam = null) {
    document.getElementById('chat-stage')?.classList.add('hidden');
    const hub = document.getElementById('hub-view-container');
    hub.classList.remove('hidden');

    if (hubName === 'library') renderLibraryHub(hub, this);
    else if (hubName === 'images') renderImagesHub(hub, this);
    else if (hubName === 'scheduled') renderScheduledHub(hub, this);
    else if (hubName === 'students') renderStudentsHub(hub, this);
    else if (hubName === 'notebooks') renderNotebooksHub(hub, this, extraParam);
    else if (hubName === 'more') renderMoreHub(hub, this);
  }

  showChatStage(focusInput = false) {
    document.getElementById('hub-view-container')?.classList.add('hidden');
    document.getElementById('chat-stage')?.classList.remove('hidden');
    if (focusInput) {
      document.getElementById('prompt-input')?.focus();
    }
  }

  startNewChat() {
    this.state.activeChatId = null;
    this.state.activeNav = 'new-chat';
    document.querySelectorAll('.nav-item[data-nav]').forEach((b) => {
      b.classList.toggle('active', b.dataset.nav === 'new-chat');
    });
    this.showChatStage(true);
    const stage = document.getElementById('chat-stage');
    stage.classList.add('is-empty');
    document.getElementById('messages-scroll')?.classList.add('hidden');
    document.getElementById('messages-list').innerHTML = '';
    this.renderSidebarHistory();
    this.renderStarterSuggestions();
  }

  renderSidebarNotebooks() {
    const listEl = document.getElementById('sidebar-notebooks-list');
    if (!listEl) return;
    const topNotebooks = (this.state.notebooks || []).slice(0, 4);
    listEl.innerHTML = topNotebooks
      .map(
        (nb) => `
        <button class="nav-subitem ${this.state.activeNotebookId === nb.id ? 'active' : ''}" data-nbid="${escapeHtml(nb.id)}" title="${escapeHtml(nb.title)}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${escapeHtml(nb.title)}</span>
        </button>`
      )
      .join('');

    listEl.querySelectorAll('[data-nbid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openHub('notebooks', btn.dataset.nbid);
      });
    });
  }

  renderSidebarHistory() {
    const listEl = document.getElementById('sidebar-history-list');
    if (!listEl) return;

    const filter = this.state.historyFilter;
    const items = (this.state.chats || []).filter((c) => {
      if (filter === 'chat') return (c.mode || 'chat') === 'chat';
      if (filter === 'task') return c.mode === 'task';
      if (filter === 'pinned') return Boolean(c.pinned);
      return true;
    });

    listEl.innerHTML = items
      .map(
        (c) => `
        <div class="history-row ${c.id === this.state.activeChatId ? 'active' : ''}" data-cid="${escapeHtml(c.id)}">
          <div class="history-title-wrap">
            ${c.pinned ? '<span title="Pinned" style="font-size:11px;">📌</span>' : ''}
            <span class="history-title">${escapeHtml(c.title)}</span>
            ${c.mode === 'task' ? '<span class="task-dot-badge">Task</span>' : ''}
          </div>
          <div class="history-actions">
            <button class="icon-btn-xs pin-chat-btn" data-cid="${escapeHtml(c.id)}" title="${c.pinned ? 'Unpin' : 'Pin'}">📌</button>
            <button class="icon-btn-xs del-chat-btn" data-cid="${escapeHtml(c.id)}" title="Delete">✕</button>
          </div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.history-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.history-actions')) return;
        this.openChat(row.dataset.cid);
      });
    });

    listEl.querySelectorAll('.pin-chat-btn').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chat = this.state.chats.find((c) => c.id === b.dataset.cid);
        if (!chat) return;
        chat.pinned = !chat.pinned;
        await apiPost('/api/chats', chat);
        this.renderSidebarHistory();
      });
    });

    listEl.querySelectorAll('.del-chat-btn').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.cid;
        await apiDelete(`/api/chats/${encodeURIComponent(id)}`);
        this.state.chats = this.state.chats.filter((c) => c.id !== id);
        if (this.state.activeChatId === id) this.startNewChat();
        else this.renderSidebarHistory();
      });
    });
  }

  openChat(chatId) {
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (!chat) return;
    this.state.activeChatId = chat.id;
    this.setMode(chat.mode || 'chat');
    if (chat.gemId) this.state.activeGemId = chat.gemId;
    if (chat.notebookId) this.state.activeNotebookId = chat.notebookId;
    this.renderContextBadges();

    this.showChatStage();
    const stage = document.getElementById('chat-stage');
    const scrollEl = document.getElementById('messages-scroll');
    const listEl = document.getElementById('messages-list');

    if ((chat.messages || []).length === 0) {
      // Seeded history placeholder — let user continue directly in this titled thread!
      stage.classList.remove('is-empty');
      scrollEl.classList.remove('hidden');
      listEl.innerHTML = `
        <div style="text-align:center;padding:36px 20px;color:var(--text-muted);font-size:14px;">
          Thread <strong>"${escapeHtml(chat.title)}"</strong> ready. Send a prompt below to continue with your active model.
        </div>
      `;
    } else {
      stage.classList.remove('is-empty');
      scrollEl.classList.remove('hidden');
      listEl.innerHTML = '';
      for (const m of chat.messages) {
        this._appendStaticMessageDom(m);
      }
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }

    if (chat.taskState || (chat.filesChanged || []).length) {
      this.auxPane.setTaskState(chat.taskState, chat.filesChanged || []);
    }

    this.renderSidebarHistory();
  }

  _appendStaticMessageDom(m) {
    const listEl = document.getElementById('messages-list');
    if (m.role === 'user') {
      const div = document.createElement('div');
      div.className = 'msg-user';
      let imgs = '';
      if (Array.isArray(m.images) && m.images.length) {
        imgs = `<div class="msg-user-images">${m.images.map((src) => `<img src="${escapeHtml(src)}" alt="upload" />`).join('')}</div>`;
      }
      div.innerHTML = `${imgs}${escapeHtml(m.content || '')}`;
      listEl.appendChild(div);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'msg-assistant';

      let taskHtml = '';
      if (m.taskState) {
        const stepsDone = (m.taskState.steps || []).length;
        const planRows = (m.taskState.plan || [])
          .map((p) => `<div class="plan-step-row completed"><span>✅</span><span>${escapeHtml(p.title)}</span></div>`)
          .join('');
        taskHtml = `
          <div class="task-execution-card">
            <div class="task-card-header">
              <div class="task-card-title">⚡ Autonomous Task Execution</div>
              <span class="status-pill done">Completed · ${stepsDone} tool calls</span>
            </div>
            ${planRows ? `<div class="task-plan-list">${planRows}</div>` : ''}
          </div>
        `;
      }

      const thinkingHtml = m.thinking
        ? `
          <details class="thinking-box">
            <summary class="thinking-summary">💭 Show thinking</summary>
            <div class="thinking-content">${escapeHtml(m.thinking)}</div>
          </details>`
        : '';

      const artifactsList = m.artifacts || (m.artifactId ? [{ id: m.artifactId, title: 'Open Artifact in Canvas', type: 'html' }] : []);
      const artChips = artifactsList
        .map(
          (a) =>
            `<button class="artifact-inline-chip" data-artid="${escapeHtml(a.id)}">🎨 ${escapeHtml(a.title)} <span class="cap-badge">${escapeHtml(a.type || 'preview')}</span></button>`
        )
        .join('');

      wrap.innerHTML = `
        <div class="msg-star-avatar">${GEMINI_STAR_SVG}</div>
        <div class="msg-body">
          ${taskHtml}
          ${thinkingHtml}
          <div class="markdown-prose">${renderMarkdown(m.content || '')}</div>
          <div>${artChips}</div>
          <div class="msg-footer-actions">
            <button class="icon-btn-xs speak-msg-btn" title="Listen aloud">🔊</button>
            <button class="icon-btn-xs copy-msg-btn" title="Copy response">📋</button>
          </div>
        </div>
      `;

      wrap.querySelectorAll('[data-artid]').forEach((btn) => {
        btn.addEventListener('click', () => this.auxPane.openArtifactById(btn.dataset.artid));
      });
      wrap.querySelector('.copy-msg-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(m.content || '');
        this.toast('Response copied');
      });
      wrap.querySelector('.speak-msg-btn')?.addEventListener('click', () => {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(m.content || ''));
        }
      });

      listEl.appendChild(wrap);
    }
  }

  activateGem(gemId) {
    this.state.activeGemId = gemId;
    this.renderContextBadges();
  }

  attachNotebook(notebookId) {
    this.state.activeNotebookId = notebookId;
    this.renderSidebarNotebooks();
    this.renderContextBadges();
  }

  renderContextBadges() {
    const el = document.getElementById('active-context-badges');
    if (!el) return;
    const chips = [];

    if (this.state.temporaryChat) {
      chips.push(`<span class="ctx-chip">🕵️ Temporary Chat <button id="rm-temp-chip">×</button></span>`);
    }
    if (this.state.activeGemId) {
      const g = this.state.gems.find((x) => x.id === this.state.activeGemId);
      if (g) chips.push(`<span class="ctx-chip">${escapeHtml(g.icon)} Gem: ${escapeHtml(g.name)} <button id="rm-gem-chip">×</button></span>`);
    }
    if (this.state.activeNotebookId) {
      const nb = this.state.notebooks.find((x) => x.id === this.state.activeNotebookId);
      if (nb) chips.push(`<span class="ctx-chip">📓 Notebook: ${escapeHtml(nb.title)} <button id="rm-nb-chip">×</button></span>`);
    }

    el.innerHTML = chips.join('');
    el.querySelector('#rm-temp-chip')?.addEventListener('click', () => {
      this.state.temporaryChat = false;
      document.getElementById('temp-chat-btn')?.classList.remove('active-toggle');
      this.renderContextBadges();
    });
    el.querySelector('#rm-gem-chip')?.addEventListener('click', () => {
      this.state.activeGemId = null;
      this.renderContextBadges();
    });
    el.querySelector('#rm-nb-chip')?.addEventListener('click', () => {
      this.state.activeNotebookId = null;
      this.renderSidebarNotebooks();
      this.renderContextBadges();
    });
  }

  async handleFilesSelected(fileList) {
    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(file);
        });
        this.state.attachments.push({ type: 'image', name: file.name, dataUrl });
      } else {
        const text = await file.text();
        this.state.attachments.push({ type: 'file', name: file.name, content: text.slice(0, 25000) });
      }
    }
    this.renderComposerAttachments();
    this.syncComposerActionBtn();
  }

  renderComposerAttachments() {
    const el = document.getElementById('composer-attachments');
    if (!el) return;
    if (this.state.attachments.length === 0) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = this.state.attachments
      .map(
        (att, idx) => `
        <div class="attachment-chip">
          ${att.type === 'image' ? `<img src="${escapeHtml(att.dataUrl)}" alt="" />` : '<span>📄</span>'}
          <span>${escapeHtml(att.name)}</span>
          <button data-rmatt="${idx}">×</button>
        </div>`
      )
      .join('');

    el.querySelectorAll('[data-rmatt]').forEach((b) => {
      b.addEventListener('click', () => {
        this.state.attachments.splice(Number(b.dataset.rmatt), 1);
        this.renderComposerAttachments();
        this.syncComposerActionBtn();
      });
    });
  }

  handleSlashOrMentionAutocomplete(val) {
    const menu = document.getElementById('slash-menu');
    if (!menu) return;

    if (val.startsWith('/') && !val.includes(' ')) {
      const q = val.toLowerCase();
      const matches = SLASH_COMMANDS.filter((s) => s.cmd.startsWith(q));
      if (matches.length === 0) {
        menu.classList.add('hidden');
        return;
      }
      menu.classList.remove('hidden');
      menu.innerHTML = matches
        .map(
          (m) => `
          <button class="popover-item" data-cmd="${escapeHtml(m.cmd)}">
            <span class="pop-icon">⚡</span>
            <div>
              <div class="pop-title">${escapeHtml(m.cmd)}</div>
              <div class="pop-sub">${escapeHtml(m.desc)}</div>
            </div>
          </button>`
        )
        .join('');

      menu.querySelectorAll('[data-cmd]').forEach((b) => {
        b.addEventListener('click', () => {
          menu.classList.add('hidden');
          this.executeSlashShortcut(b.dataset.cmd);
        });
      });
      return;
    }

    menu.classList.add('hidden');
  }

  executeSlashShortcut(cmd) {
    const input = document.getElementById('prompt-input');
    input.value = '';
    this.syncComposerActionBtn();

    switch (cmd) {
      case '/task':
        this.setMode('task');
        input.focus();
        break;
      case '/plan':
        this.setMode('task');
        this.setPromptAndFocus('Create a comprehensive Markdown Implementation Plan artifact first, then execute: ');
        break;
      case '/goal':
        this.setMode('task');
        this.setPromptAndFocus('Thoroughly complete and verify this goal end-to-end: ');
        break;
      case '/research':
        this.setPromptAndFocus('/research ');
        break;
      case '/canvas':
        this.auxPane.open('canvas');
        break;
      case '/image':
        this.navigatePrimary('images');
        break;
      case '/schedule':
        this.navigatePrimary('scheduled');
        break;
      case '/quiz':
        this.navigatePrimary('students');
        break;
      case '/clear':
        this.startNewChat();
        break;
      case '/compact':
        this.compactCurrentConversation();
        break;
    }
  }

  async compactCurrentConversation() {
    const chat = this.state.chats.find((c) => c.id === this.state.activeChatId);
    if (!chat || (chat.messages || []).length < 4) {
      return this.toast('Conversation is already compact');
    }
    const summaryText = chat.messages
      .slice(0, -2)
      .map((m) => `${m.role.toUpperCase()}: ${(m.content || '').slice(0, 300)}`)
      .join('\n');
    chat.messages = [
      { role: 'user', content: `[Compacted Context Summary]\n${summaryText}` },
      ...chat.messages.slice(-2)
    ];
    await apiPost('/api/chats', chat);
    this.openChat(chat.id);
    this.toast('Conversation context compacted!');
  }

  async toggleModelPopover() {
    const pop = document.getElementById('model-popover');
    if (!pop.classList.contains('hidden')) {
      pop.classList.add('hidden');
      return;
    }

    pop.classList.remove('hidden');
    const s = this.state.settings;
    const localModels = this.state.models.filter((m) => m.local);
    const cloudModels = this.state.models.filter((m) => !m.local);

    pop.innerHTML = `
      <div class="effort-bar">
        <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Thinking Effort</span>
        <div class="effort-pills">
          ${['off', 'low', 'medium', 'high']
            .map(
              (ef) =>
                `<button class="effort-pill ${(s.thinkingEffort || 'high') === ef ? 'active' : ''}" data-ef="${ef}">${ef === 'off' ? 'Off' : ef.charAt(0).toUpperCase() + ef.slice(1)}</button>`
            )
            .join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="model-group-label">Local AI Models</div>
        <button id="refresh-models-btn" class="mini-pill" style="margin-right:6px;">↻ Refresh</button>
      </div>
      ${
        localModels.length
          ? localModels
              .map(
                (m) => `
              <button class="model-option ${m.id === s.selectedModel && m.provider === s.selectedProvider ? 'active' : ''}" data-mid="${escapeHtml(m.id)}" data-prov="${escapeHtml(m.provider)}">
                <div>
                  <div style="font-size:13px;font-weight:600;">${escapeHtml(m.name)}</div>
                  <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(m.providerLabel)} ${m.parameterSize ? `· ${escapeHtml(m.parameterSize)}` : ''}</div>
                </div>
                <div class="model-badges">
                  ${(m.capabilities || []).includes('tools') ? '<span class="cap-badge green">Tools</span>' : ''}
                  ${(m.capabilities || []).includes('thinking') ? '<span class="cap-badge">Think</span>' : ''}
                </div>
              </button>`
              )
              .join('')
          : `<div style="padding:8px 10px;font-size:12px;color:var(--text-muted);">No local Ollama / LM Studio server detected. Start Ollama or configure URL in Settings.</div>`
      }

      <div class="popover-divider"></div>
      <div class="model-group-label">BYOK Cloud Models</div>
      ${cloudModels
        .map(
          (m) => `
          <button class="model-option ${m.id === s.selectedModel && m.provider === s.selectedProvider ? 'active' : ''}" data-mid="${escapeHtml(m.id)}" data-prov="${escapeHtml(m.provider)}" data-avail="${m.available ? '1' : '0'}">
            <div>
              <div style="font-size:13px;font-weight:500;">${escapeHtml(m.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(m.providerLabel)}</div>
            </div>
            <span class="cap-badge ${m.available ? 'green' : ''}">${m.available ? 'Ready' : '+ Add Key'}</span>
          </button>`
        )
        .join('')}
    `;

    pop.querySelectorAll('.effort-pill').forEach((b) => {
      b.addEventListener('click', async () => {
        this.state.settings.thinkingEffort = b.dataset.ef;
        this.updateModelButton();
        await apiPost('/api/settings', { thinkingEffort: b.dataset.ef });
        pop.classList.add('hidden');
      });
    });

    pop.querySelector('#refresh-models-btn')?.addEventListener('click', async () => {
      const disc = await apiGet('/api/models');
      this.state.models = disc.models;
      this.state.providerStatus = disc.providerStatus;
      this.applySettingsToUi();
      pop.classList.add('hidden');
      this.toggleModelPopover();
    });

    pop.querySelectorAll('.model-option').forEach((opt) => {
      opt.addEventListener('click', async () => {
        const prov = opt.dataset.prov;
        const mid = opt.dataset.mid;
        if (opt.dataset.avail === '0') {
          pop.classList.add('hidden');
          this.openSettingsModal();
          this.toast('Enter your BYOK API key to unlock this provider');
          return;
        }
        this.state.settings.selectedProvider = prov;
        this.state.settings.selectedModel = mid;
        this.updateModelButton();
        pop.classList.add('hidden');
        await apiPost('/api/settings', { selectedProvider: prov, selectedModel: mid });
      });
    });
  }

  toggleVoiceDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      return this.toast('Speech recognition is not supported in this browser.');
    }
    const btn = document.getElementById('voice-or-send-btn');
    if (this.isListening && this.recognition) {
      this.recognition.stop();
      this.isListening = false;
      btn?.classList.remove('listening');
      return;
    }

    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.isListening = true;
    btn?.classList.add('listening');

    const input = document.getElementById('prompt-input');
    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('');
      input.value = transcript;
      this.syncComposerActionBtn();
    };
    this.recognition.onend = () => {
      this.isListening = false;
      btn?.classList.remove('listening');
      this.syncComposerActionBtn();
    };
    this.recognition.start();
  }

  async cancelStreaming() {
    if (this.state.activeRunId) {
      await apiPost('/api/task/cancel', { runId: this.state.activeRunId }).catch(() => {});
    }
    this.state.abortController?.abort();
    this.state.isStreaming = false;
    this.syncComposerActionBtn();
    this.toast('Generation stopped');
  }

  async handleSubmit() {
    const input = document.getElementById('prompt-input');
    let rawText = (input?.value || '').trim();
    if (!rawText && this.state.attachments.length === 0) return;
    if (this.state.isStreaming) return;

    // Intercept /research prefix
    if (rawText.toLowerCase().startsWith('/research ')) {
      const rq = rawText.slice(10).trim();
      input.value = '';
      input.style.height = 'auto';
      this.syncComposerActionBtn();
      if (rq) return this.startDeepResearchInChat(rq);
    }

    // Build message with file attachments & images
    const images = this.state.attachments.filter((a) => a.type === 'image').map((a) => a.dataUrl);
    const fileContexts = this.state.attachments
      .filter((a) => a.type === 'file')
      .map((a) => `\n\n[Attached File: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``)
      .join('');

    const fullUserContent = `${rawText}${fileContexts}`.trim();
    input.value = '';
    input.style.height = 'auto';
    this.state.attachments = [];
    this.renderComposerAttachments();

    this.showChatStage();
    const stage = document.getElementById('chat-stage');
    const scrollEl = document.getElementById('messages-scroll');
    const listEl = document.getElementById('messages-list');
    stage.classList.remove('is-empty');
    scrollEl.classList.remove('hidden');

    // Ensure chat container in state
    let currentChat = this.state.chats.find((c) => c.id === this.state.activeChatId);
    if (!currentChat) {
      const newId = `chat-${Date.now()}`;
      currentChat = {
        id: newId,
        title: rawText.slice(0, 48) || 'New conversation',
        mode: this.state.activeMode,
        pinned: false,
        gemId: this.state.activeGemId,
        notebookId: this.state.activeNotebookId,
        messages: [],
        filesChanged: [],
        updatedAt: new Date().toISOString()
      };
      this.state.activeChatId = newId;
      if (!this.state.temporaryChat) {
        this.state.chats.unshift(currentChat);
        this.renderSidebarHistory();
      }
      listEl.innerHTML = '';
    } else if (currentChat.messages.length === 0) {
      listEl.innerHTML = '';
    }

    const userMsg = {
      role: 'user',
      content: fullUserContent,
      images: images.length ? images : undefined,
      createdAt: new Date().toISOString()
    };
    currentChat.messages.push(userMsg);
    this._appendStaticMessageDom(userMsg);
    scrollEl.scrollTop = scrollEl.scrollHeight;

    if (this.state.activeMode === 'task') {
      await this._streamTaskTurn(currentChat);
    } else {
      await this._streamChatTurn(currentChat);
    }
  }

  async _streamChatTurn(chat) {
    const scrollEl = document.getElementById('messages-scroll');
    const listEl = document.getElementById('messages-list');

    const runId = `run-${Date.now()}`;
    this.state.isStreaming = true;
    this.state.activeRunId = runId;
    this.state.abortController = new AbortController();
    this.syncComposerActionBtn();

    const wrap = document.createElement('div');
    wrap.className = 'msg-assistant';
    wrap.innerHTML = `
      <div class="msg-star-avatar spinning">${GEMINI_STAR_SVG}</div>
      <div class="msg-body">
        <details class="thinking-box hidden" open>
          <summary class="thinking-summary">💭 Thinking...</summary>
          <div class="thinking-content"></div>
        </details>
        <div class="markdown-prose"><span style="color:var(--text-muted);">Generating...</span></div>
      </div>
    `;
    listEl.appendChild(wrap);
    scrollEl.scrollTop = scrollEl.scrollHeight;

    const starEl = wrap.querySelector('.msg-star-avatar');
    const thinkBox = wrap.querySelector('.thinking-box');
    const thinkSummary = wrap.querySelector('.thinking-summary');
    const thinkContent = wrap.querySelector('.thinking-content');
    const proseEl = wrap.querySelector('.markdown-prose');

    let thinkingAcc = '';
    let contentAcc = '';

    try {
      await streamSsePost(
        '/api/chat/stream',
        {
          runId,
          chatId: chat.id,
          messages: chat.messages,
          provider: this.state.settings.selectedProvider,
          model: this.state.settings.selectedModel,
          thinkingEffort: this.state.settings.thinkingEffort,
          gemId: this.state.activeGemId,
          notebookId: this.state.activeNotebookId,
          temporary: this.state.temporaryChat
        },
        {
          thinking_delta: ({ delta }) => {
            thinkingAcc += delta;
            thinkBox.classList.remove('hidden');
            thinkContent.textContent = thinkingAcc;
            scrollEl.scrollTop = scrollEl.scrollHeight;
          },
          content_delta: ({ delta }) => {
            contentAcc += delta;
            proseEl.innerHTML = renderMarkdown(contentAcc);
            scrollEl.scrollTop = scrollEl.scrollHeight;
          },
          chat_complete: () => {
            thinkSummary.textContent = '💭 Show thinking';
            thinkBox.removeAttribute('open');
          },
          error: ({ message }) => {
            proseEl.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${escapeHtml(message)}</div>`;
          }
        },
        this.state.abortController.signal
      );

      chat.messages.push({
        role: 'assistant',
        content: contentAcc,
        thinking: thinkingAcc,
        createdAt: new Date().toISOString()
      });
      chat.updatedAt = new Date().toISOString();
      this.renderSidebarHistory();
    } catch (err) {
      if (err.name !== 'AbortError') {
        proseEl.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    } finally {
      starEl.classList.remove('spinning');
      this.state.isStreaming = false;
      this.state.activeRunId = null;
      this.syncComposerActionBtn();
    }
  }

  async _streamTaskTurn(chat) {
    const scrollEl = document.getElementById('messages-scroll');
    const listEl = document.getElementById('messages-list');

    const runId = `task-${Date.now()}`;
    this.state.isStreaming = true;
    this.state.activeRunId = runId;
    this.state.abortController = new AbortController();
    this.syncComposerActionBtn();

    const liveTaskState = { status: 'running', plan: [], steps: [], subagents: [] };
    this.auxPane.setTaskState(liveTaskState, chat.filesChanged || []);

    const wrap = document.createElement('div');
    wrap.className = 'msg-assistant';
    wrap.innerHTML = `
      <div class="msg-star-avatar spinning">${GEMINI_STAR_SVG}</div>
      <div class="msg-body">
        <div class="task-execution-card">
          <div class="task-card-header">
            <div class="task-card-title">⚡ OpenGemini Task Agent</div>
            <span class="status-pill" id="live-task-status">Planning...</span>
          </div>
          <div class="task-plan-list hidden" id="live-plan-list"></div>
          <div id="live-approval-slot"></div>
          <div class="task-tools-log" id="live-tools-log"></div>
        </div>
        <details class="thinking-box hidden" open>
          <summary class="thinking-summary">💭 Agent Reasoning...</summary>
          <div class="thinking-content"></div>
        </details>
        <div class="markdown-prose"></div>
        <div id="live-artifact-chips"></div>
      </div>
    `;
    listEl.appendChild(wrap);
    scrollEl.scrollTop = scrollEl.scrollHeight;

    const starEl = wrap.querySelector('.msg-star-avatar');
    const statusBadge = wrap.querySelector('#live-task-status');
    const planListEl = wrap.querySelector('#live-plan-list');
    const approvalSlot = wrap.querySelector('#live-approval-slot');
    const toolsLogEl = wrap.querySelector('#live-tools-log');
    const thinkBox = wrap.querySelector('.thinking-box');
    const thinkSummary = wrap.querySelector('.thinking-summary');
    const thinkContent = wrap.querySelector('.thinking-content');
    const proseEl = wrap.querySelector('.markdown-prose');
    const artChipsEl = wrap.querySelector('#live-artifact-chips');

    let thinkingAcc = '';
    let stepContentAcc = '';
    const createdArtifacts = [];

    try {
      await streamSsePost(
        '/api/task/stream',
        {
          runId,
          chatId: chat.id,
          messages: chat.messages,
          provider: this.state.settings.selectedProvider,
          model: this.state.settings.selectedModel,
          thinkingEffort: this.state.settings.thinkingEffort,
          gemId: this.state.activeGemId,
          notebookId: this.state.activeNotebookId,
          temporary: this.state.temporaryChat
        },
        {
          step_start: ({ step }) => {
            statusBadge.textContent = `Step ${step} · Reasoning`;
            stepContentAcc = '';
          },
          plan_update: ({ steps }) => {
            liveTaskState.plan = steps || [];
            if (liveTaskState.plan.length > 0) {
              planListEl.classList.remove('hidden');
              planListEl.innerHTML = liveTaskState.plan
                .map((p) => {
                  const ic = p.status === 'completed' ? '✅' : p.status === 'in_progress' ? '🔄' : '⬜';
                  return `<div class="plan-step-row ${p.status}"><span>${ic}</span><span>${escapeHtml(p.title)}</span></div>`;
                })
                .join('');
            }
            this.auxPane.setTaskState(liveTaskState, chat.filesChanged || []);
          },
          thinking_delta: ({ delta }) => {
            thinkingAcc += delta;
            thinkBox.classList.remove('hidden');
            thinkContent.textContent = thinkingAcc;
          },
          content_delta: ({ delta }) => {
            stepContentAcc += delta;
            proseEl.innerHTML = renderMarkdown(stepContentAcc);
            scrollEl.scrollTop = scrollEl.scrollHeight;
          },
          tool_call: ({ callId, name, args }) => {
            statusBadge.textContent = `Running ${name}...`;
            const pill = document.createElement('div');
            pill.className = 'tool-call-pill';
            pill.id = `tc-${callId}`;
            pill.innerHTML = `<span>🔧 <strong>${escapeHtml(name)}</strong>(${escapeHtml(JSON.stringify(args).slice(0, 65))})</span><span class="tc-dur" style="color:var(--text-muted);">running...</span>`;
            toolsLogEl.appendChild(pill);
            scrollEl.scrollTop = scrollEl.scrollHeight;
          },
          approval_required: ({ approvalId, command }) => {
            statusBadge.textContent = 'Awaiting Approval';
            approvalSlot.innerHTML = `
              <div class="approval-banner">
                <div><strong>⚠️ Approve command?</strong> <code>${escapeHtml(command)}</code></div>
                <div style="display:flex;gap:6px;">
                  <button class="btn-primary" id="apr-yes-${approvalId}" style="padding:4px 12px;font-size:12px;">Approve</button>
                  <button class="btn-secondary" id="apr-no-${approvalId}" style="padding:4px 12px;font-size:12px;">Deny</button>
                </div>
              </div>
            `;
            approvalSlot.querySelector(`#apr-yes-${approvalId}`)?.addEventListener('click', async () => {
              approvalSlot.innerHTML = '';
              await apiPost('/api/task/approve', { approvalId, approved: true });
            });
            approvalSlot.querySelector(`#apr-no-${approvalId}`)?.addEventListener('click', async () => {
              approvalSlot.innerHTML = '';
              await apiPost('/api/task/approve', { approvalId, approved: false });
            });
          },
          tool_result: (entry) => {
            liveTaskState.steps.push(entry);
            const pill = toolsLogEl.querySelector(`#tc-${CSS.escape(entry.callId)}`);
            if (pill) {
              const dur = pill.querySelector('.tc-dur');
              if (dur) dur.textContent = entry.result?.error ? '⚠️ error' : `✓ ${entry.durationMs}ms`;
            }
            this.auxPane.setTaskState(liveTaskState, chat.filesChanged || []);
          },
          subagent_update: (sub) => {
            const idx = liveTaskState.subagents.findIndex((s) => s.id === sub.id);
            if (idx >= 0) liveTaskState.subagents[idx] = sub;
            else liveTaskState.subagents.push(sub);
            this.auxPane.setTaskState(liveTaskState, chat.filesChanged || []);
          },
          file_changed: (change) => {
            chat.filesChanged = chat.filesChanged || [];
            const idx = chat.filesChanged.findIndex((f) => f.filePath === change.filePath);
            if (idx >= 0) chat.filesChanged[idx] = change;
            else chat.filesChanged.push(change);
            this.auxPane.pushFileChanged(change);
          },
          terminal_output: (termEntry) => {
            this.auxPane.pushTerminalLog(termEntry);
          },
          artifact_created: (artifact) => {
            createdArtifacts.push(artifact);
            this.state.artifacts.unshift(artifact);
            this.auxPane.setCanvasArtifact(artifact);
            this.auxPane.open('canvas');

            const chip = document.createElement('button');
            chip.className = 'artifact-inline-chip';
            chip.innerHTML = `🎨 ${escapeHtml(artifact.title)} <span class="cap-badge">${escapeHtml(artifact.type)}</span>`;
            chip.addEventListener('click', () => this.auxPane.openArtifactById(artifact.id));
            artChipsEl.appendChild(chip);
          },
          task_complete: ({ finalAnswer, taskState }) => {
            statusBadge.textContent = `Completed · ${(taskState?.steps || []).length} actions`;
            statusBadge.classList.add('done');
            thinkSummary.textContent = '💭 Show agent reasoning';
            thinkBox.removeAttribute('open');
            if (finalAnswer) {
              proseEl.innerHTML = renderMarkdown(finalAnswer);
            }
            chat.messages.push({
              role: 'assistant',
              mode: 'task',
              content: finalAnswer || stepContentAcc,
              thinking: thinkingAcc,
              taskState,
              artifacts: createdArtifacts.map((a) => ({ id: a.id, title: a.title, type: a.type })),
              createdAt: new Date().toISOString()
            });
            chat.taskState = taskState;
            this.renderSidebarHistory();
          },
          error: ({ message }) => {
            statusBadge.textContent = 'Error';
            proseEl.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${escapeHtml(message)}</div>`;
          }
        },
        this.state.abortController.signal
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        proseEl.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    } finally {
      starEl.classList.remove('spinning');
      this.state.isStreaming = false;
      this.state.activeRunId = null;
      this.syncComposerActionBtn();
    }
  }

  async startDeepResearchInChat(query) {
    this.showChatStage();
    const stage = document.getElementById('chat-stage');
    const scrollEl = document.getElementById('messages-scroll');
    const listEl = document.getElementById('messages-list');
    stage.classList.remove('is-empty');
    scrollEl.classList.remove('hidden');

    const chatId = `chat-${Date.now()}`;
    const chat = {
      id: chatId,
      title: `Deep Research: ${query.slice(0, 36)}`,
      mode: 'task',
      pinned: false,
      messages: [{ role: 'user', content: `🌐 Deep Research: ${query}`, createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString()
    };
    this.state.activeChatId = chatId;
    this.state.chats.unshift(chat);
    this.renderSidebarHistory();

    listEl.innerHTML = '';
    this._appendStaticMessageDom(chat.messages[0]);

    const runId = `res-${Date.now()}`;
    this.state.isStreaming = true;
    this.state.activeRunId = runId;
    this.state.abortController = new AbortController();
    this.syncComposerActionBtn();

    const wrap = document.createElement('div');
    wrap.className = 'msg-assistant';
    wrap.innerHTML = `
      <div class="msg-star-avatar spinning">${GEMINI_STAR_SVG}</div>
      <div class="msg-body">
        <div class="task-execution-card">
          <div class="task-card-header">
            <div class="task-card-title">🌐 Deep Research Agent</div>
            <span class="status-pill" id="dr-status">Initializing...</span>
          </div>
          <div class="task-tools-log" id="dr-log"></div>
        </div>
        <div class="markdown-prose"></div>
      </div>
    `;
    listEl.appendChild(wrap);

    const statusEl = wrap.querySelector('#dr-status');
    const logEl = wrap.querySelector('#dr-log');
    const proseEl = wrap.querySelector('.markdown-prose');
    let reportAcc = '';

    try {
      await streamSsePost(
        '/api/research/stream',
        { runId, query, chatId },
        {
          research_progress: ({ phase, message }) => {
            statusEl.textContent = phase.toUpperCase();
            const row = document.createElement('div');
            row.className = 'tool-call-pill';
            row.textContent = `🔎 ${message}`;
            logEl.appendChild(row);
          },
          content_delta: ({ delta }) => {
            reportAcc += delta;
            proseEl.innerHTML = renderMarkdown(reportAcc);
            scrollEl.scrollTop = scrollEl.scrollHeight;
          },
          artifact_created: (art) => {
            this.state.artifacts.unshift(art);
            this.auxPane.setCanvasArtifact(art);
            this.auxPane.open('canvas');
          },
          research_complete: ({ report }) => {
            statusEl.textContent = 'Completed';
            statusEl.classList.add('done');
            chat.messages.push({ role: 'assistant', content: report || reportAcc });
            apiPost('/api/chats', chat).catch(() => {});
          },
          error: ({ message }) => {
            proseEl.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${escapeHtml(message)}</div>`;
          }
        },
        this.state.abortController.signal
      );
    } finally {
      wrap.querySelector('.msg-star-avatar')?.classList.remove('spinning');
      this.state.isStreaming = false;
      this.syncComposerActionBtn();
    }
  }

  openSimpleModal(title, bodyHtml, onMount) {
    const backdrop = document.getElementById('modal-backdrop');
    const card = document.getElementById('modal-card');
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:18px;">${escapeHtml(title)}</h3>
        <button id="modal-close-x" class="icon-btn-sm">✕</button>
      </div>
      <div>${bodyHtml}</div>
    `;
    backdrop.classList.remove('hidden');
    const close = () => backdrop.classList.add('hidden');
    card.querySelector('#modal-close-x')?.addEventListener('click', close);
    onMount?.(card, close);
  }

  openSearchModal() {
    this.openSimpleModal(
      'Search Chats, Tasks & Commands',
      `
      <input id="cmd-k-input" class="input-field" placeholder="Type to search history or jump to a hub..." style="margin-bottom:12px;" />
      <div id="cmd-k-results" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
    `,
      (card, close) => {
        const inp = card.querySelector('#cmd-k-input');
        const resEl = card.querySelector('#cmd-k-results');
        const renderList = (q = '') => {
          const ql = q.toLowerCase();
          const matchedChats = this.state.chats
            .filter((c) => c.title.toLowerCase().includes(ql))
            .slice(0, 15);
          resEl.innerHTML = matchedChats
            .map(
              (c) => `
              <button class="popover-item" data-cid="${escapeHtml(c.id)}">
                <span class="pop-icon">${c.mode === 'task' ? '⚡' : '💬'}</span>
                <div>
                  <div class="pop-title">${escapeHtml(c.title)}</div>
                  <div class="pop-sub">${c.mode === 'task' ? 'Task thread' : 'Chat thread'}</div>
                </div>
              </button>`
            )
            .join('');
          resEl.querySelectorAll('[data-cid]').forEach((b) => {
            b.addEventListener('click', () => {
              close();
              this.openChat(b.dataset.cid);
            });
          });
        };
        renderList('');
        inp.focus();
        inp.addEventListener('input', () => renderList(inp.value));
      }
    );
  }

  async openWorkspaceFilePicker() {
    const res = await apiGet('/api/workspace/files?dir=.').catch(() => ({ items: [] }));
    const files = (res.items || []).filter((i) => i.type === 'file');
    this.openSimpleModal(
      `Attach Workspace File (${this.state.settings.workspacePath || ''})`,
      `
      <div style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
        ${
          files.length
            ? files
                .map(
                  (f) => `
              <button class="popover-item" data-fpath="${escapeHtml(f.path)}" data-fname="${escapeHtml(f.name)}">
                <span class="pop-icon">📄</span>
                <div class="pop-title">${escapeHtml(f.name)}</div>
              </button>`
                )
                .join('')
            : '<div style="color:var(--text-muted);font-size:13px;">No top-level files found in workspace root. Use Task Mode to explore nested subdirectories!</div>'
        }
      </div>
    `,
      (card, close) => {
        card.querySelectorAll('[data-fpath]').forEach((b) => {
          b.addEventListener('click', async () => {
            const file = await apiGet(`/api/workspace/file?path=${encodeURIComponent(b.dataset.fpath)}`);
            this.state.attachments.push({ type: 'file', name: file.name, content: file.content.slice(0, 20000) });
            this.renderComposerAttachments();
            this.syncComposerActionBtn();
            close();
          });
        });
      }
    );
  }

  openNotebookPickerModal() {
    this.openSimpleModal(
      'Ground Conversation with Notebook',
      `<div style="display:flex;flex-direction:column;gap:4px;">
        ${(this.state.notebooks || [])
          .map(
            (n) => `
          <button class="popover-item" data-nb="${escapeHtml(n.id)}">
            <span class="pop-icon">📓</span>
            <div>
              <div class="pop-title">${escapeHtml(n.title)}</div>
              <div class="pop-sub">${(n.sources || []).length} grounded sources</div>
            </div>
          </button>`
          )
          .join('')}
      </div>`,
      (card, close) => {
        card.querySelectorAll('[data-nb]').forEach((b) => {
          b.addEventListener('click', () => {
            this.attachNotebook(b.dataset.nb);
            close();
          });
        });
      }
    );
  }

  openGemPickerModal() {
    this.openSimpleModal(
      'Select Gem Persona',
      `<div style="display:flex;flex-direction:column;gap:4px;">
        ${(this.state.gems || [])
          .map(
            (g) => `
          <button class="popover-item" data-gid="${escapeHtml(g.id)}">
            <span class="pop-icon">${escapeHtml(g.icon)}</span>
            <div>
              <div class="pop-title">${escapeHtml(g.name)}</div>
              <div class="pop-sub">${escapeHtml(g.description)}</div>
            </div>
          </button>`
          )
          .join('')}
      </div>`,
      (card, close) => {
        card.querySelectorAll('[data-gid]').forEach((b) => {
          b.addEventListener('click', () => {
            this.activateGem(b.dataset.gid);
            close();
          });
        });
      }
    );
  }

  openRuntimeStatusModal() {
    const ps = this.state.providerStatus || {};
    this.openSimpleModal(
      'OpenGemini Local & Desktop Runtime',
      `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13.5px;">
        <div class="hub-card" style="padding:14px;">
          <strong>🟢 Local Inference Servers</strong>
          <div>Ollama (${escapeHtml(this.state.settings.ollamaUrl)}): <strong>${ps.ollama?.online ? `Online (${ps.ollama.count} models)` : 'Offline'}</strong></div>
          <div>LM Studio (${escapeHtml(this.state.settings.lmStudioUrl)}): <strong>${ps.lmstudio?.online ? 'Online' : 'Not running'}</strong></div>
          <div>llama.cpp (${escapeHtml(this.state.settings.llamaCppUrl)}): <strong>${ps.llamacpp?.online ? 'Online' : 'Not running'}</strong></div>
        </div>
        <div class="hub-card" style="padding:14px;">
          <strong>💻 One-Click Windows Desktop Launch</strong>
          <div style="color:var(--text-muted);font-size:12.5px;">Double-click <code>start-opengemini.bat</code> inside your OpenGemini folder anytime, or install this page as a standalone Desktop App from your browser's address bar.</div>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button id="open-full-settings" class="btn-primary">Configure Models &amp; BYOK Keys</button>
        </div>
      </div>
    `,
      (card) => {
        card.querySelector('#open-full-settings')?.addEventListener('click', () => this.openSettingsModal());
      }
    );
  }

  openSettingsModal() {
    const s = this.state.settings;
    this.openSimpleModal(
      'OpenGemini Settings — Local AI, BYOK & Antigravity Policies',
      `
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div>
          <h4 style="margin:0 0 10px;font-size:14px;">🎨 Appearance &amp; Profile</h4>
          <div class="settings-grid">
            <div>
              <label class="field-label">Theme</label>
              <select id="st-theme" class="select-field">
                <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Google Gemini Light (Default)</option>
                <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Google Gemini Dark</option>
              </select>
            </div>
            <div>
              <label class="field-label">Display Name &amp; Emoji</label>
              <div style="display:flex;gap:6px;">
                <input id="st-emoji" class="input-field" style="width:58px;" value="${escapeHtml(s.userEmoji || '😅')}" />
                <input id="st-name" class="input-field" value="${escapeHtml(s.userName || 'Ah Pah')}" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 style="margin:0 0 10px;font-size:14px;">🏠 Local AI Model Servers</h4>
          <div class="settings-grid">
            <div>
              <label class="field-label">Ollama URL</label>
              <input id="st-ollama" class="input-field" value="${escapeHtml(s.ollamaUrl || 'http://localhost:11434')}" />
            </div>
            <div>
              <label class="field-label">LM Studio OpenAI URL</label>
              <input id="st-lmstudio" class="input-field" value="${escapeHtml(s.lmStudioUrl || 'http://localhost:1234/v1')}" />
            </div>
            <div>
              <label class="field-label">llama.cpp / LocalAI URL</label>
              <input id="st-llamacpp" class="input-field" value="${escapeHtml(s.llamaCppUrl || 'http://localhost:8080/v1')}" />
            </div>
            <div>
              <label class="field-label">Custom OpenAI-Compatible URL</label>
              <input id="st-custom-url" class="input-field" placeholder="http://localhost:8000/v1" value="${escapeHtml(s.customOpenAiUrl || '')}" />
            </div>
          </div>
        </div>

        <div>
          <h4 style="margin:0 0 10px;font-size:14px;">🔑 BYOK Cloud API Keys (Stored Locally Only)</h4>
          <div class="settings-grid">
            <div>
              <label class="field-label">Google Gemini API Key</label>
              <input id="st-gemini-key" type="password" class="input-field" placeholder="AIza..." value="${escapeHtml(s.geminiApiKey || '')}" />
            </div>
            <div>
              <label class="field-label">OpenAI API Key</label>
              <input id="st-openai-key" type="password" class="input-field" placeholder="sk-..." value="${escapeHtml(s.openaiApiKey || '')}" />
            </div>
            <div>
              <label class="field-label">Anthropic Claude API Key</label>
              <input id="st-anthropic-key" type="password" class="input-field" placeholder="sk-ant-..." value="${escapeHtml(s.anthropicApiKey || '')}" />
            </div>
            <div>
              <label class="field-label">OpenRouter API Key</label>
              <input id="st-openrouter-key" type="password" class="input-field" placeholder="sk-or-..." value="${escapeHtml(s.openrouterApiKey || '')}" />
            </div>
            <div>
              <label class="field-label">Groq API Key</label>
              <input id="st-groq-key" type="password" class="input-field" placeholder="gsk_..." value="${escapeHtml(s.groqApiKey || '')}" />
            </div>
            <div>
              <label class="field-label">Default Image Provider</label>
              <select id="st-img-prov" class="select-field">
                <option value="qwen-image-local" ${s.imageProvider === 'qwen-image-local' ? 'selected' : ''}>⚡ Qwen 2.1 Image Uncensored (Local GGUF)</option>
                <option value="nano-banana" ${s.imageProvider === 'nano-banana' ? 'selected' : ''}>🍌 Nano Banana 2.1 (Google Gemini API)</option>
                <option value="svg-llm" ${s.imageProvider === 'svg-llm' ? 'selected' : ''}>🎨 Local LLM Vector Studio (SVG)</option>
                <option value="pollinations" ${s.imageProvider === 'pollinations' ? 'selected' : ''}>Pollinations Flux (Zero-Key)</option>
                <option value="openai" ${s.imageProvider === 'openai' ? 'selected' : ''}>OpenAI DALL-E 3 (BYOK)</option>
                <option value="sd-webui" ${s.imageProvider === 'sd-webui' ? 'selected' : ''}>Local SD WebUI (127.0.0.1:7860)</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <h4 style="margin:0 0 10px;font-size:14px;">🛡️ Antigravity 2.0 Agent &amp; Workspace Permissions</h4>
          <div class="settings-grid">
            <div>
              <label class="field-label">Active Workspace Directory</label>
              <input id="st-workspace" class="input-field" value="${escapeHtml(s.workspacePath || '')}" />
            </div>
            <div>
              <label class="field-label">Terminal Command Approval Policy</label>
              <select id="st-approval" class="select-field">
                <option value="always-proceed" ${s.approvalPolicy === 'always-proceed' ? 'selected' : ''}>Always Proceed (Autonomous)</option>
                <option value="request-review" ${s.approvalPolicy === 'request-review' ? 'selected' : ''}>Request Review (Human-in-the-Loop)</option>
                <option value="strict" ${s.approvalPolicy === 'strict' ? 'selected' : ''}>Strict Approval</option>
              </select>
            </div>
            <div>
              <label class="field-label">Non-Workspace File Access</label>
              <select id="st-nonws" class="select-field">
                <option value="allow" ${s.nonWorkspaceAccess === 'allow' ? 'selected' : ''}>Allow</option>
                <option value="deny" ${s.nonWorkspaceAccess === 'deny' ? 'selected' : ''}>Deny (Sandbox to Workspace)</option>
              </select>
            </div>
            <div>
              <label class="field-label">Max Autonomous Task Steps</label>
              <input id="st-maxsteps" type="number" min="2" max="20" class="input-field" value="${Number(s.maxTaskSteps) || 12}" />
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:6px;">
          <button id="st-save-btn" class="btn-primary">Save &amp; Refresh Models</button>
        </div>
      </div>
    `,
      (card, close) => {
        card.querySelector('#st-save-btn')?.addEventListener('click', async () => {
          const patch = {
            theme: card.querySelector('#st-theme').value,
            userEmoji: card.querySelector('#st-emoji').value.trim() || '😅',
            userName: card.querySelector('#st-name').value.trim() || 'User',
            ollamaUrl: card.querySelector('#st-ollama').value.trim(),
            lmStudioUrl: card.querySelector('#st-lmstudio').value.trim(),
            llamaCppUrl: card.querySelector('#st-llamacpp').value.trim(),
            customOpenAiUrl: card.querySelector('#st-custom-url').value.trim(),
            geminiApiKey: card.querySelector('#st-gemini-key').value.trim(),
            openaiApiKey: card.querySelector('#st-openai-key').value.trim(),
            anthropicApiKey: card.querySelector('#st-anthropic-key').value.trim(),
            openrouterApiKey: card.querySelector('#st-openrouter-key').value.trim(),
            groqApiKey: card.querySelector('#st-groq-key').value.trim(),
            imageProvider: card.querySelector('#st-img-prov').value,
            workspacePath: card.querySelector('#st-workspace').value.trim(),
            approvalPolicy: card.querySelector('#st-approval').value,
            nonWorkspaceAccess: card.querySelector('#st-nonws').value,
            maxTaskSteps: Number(card.querySelector('#st-maxsteps').value) || 12
          };
          const res = await apiPost('/api/settings', patch);
          this.state.settings = res.settings;
          this.state.models = res.models;
          this.state.providerStatus = res.providerStatus;
          this.applySettingsToUi();
          this.updateModelButton();
          close();
          this.toast('Settings saved & providers refreshed!');
        });
      }
    );
  }
}

const app = new OpenGeminiApp();
window.addEventListener('DOMContentLoaded', () => app.init());
