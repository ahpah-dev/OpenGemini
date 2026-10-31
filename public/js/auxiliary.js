import { apiGet, apiPost } from './api.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

export class AuxiliaryPane {
  constructor(state, toast) {
    this.state = state;
    this.toast = toast;
    this.paneEl = document.getElementById('aux-pane');
    this.bodyEl = document.getElementById('aux-body');
    this.diffsBadgeEl = document.getElementById('diffs-badge');

    this.activeTab = 'canvas';
    this.canvasMode = 'preview'; // 'preview' | 'code'
    this.activeArtifact = {
      id: null,
      title: 'Interactive Canvas',
      type: 'html',
      content: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: radial-gradient(circle at 50% 45%, #dbeafe, #ffffff 72%); color: #1e293b; }
    .card { background: rgba(255,255,255,0.88); padding: 28px 34px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.07); text-align: center; max-width: 380px; }
    h2 { margin: 0 0 8px; font-weight: 600; }
    p { margin: 0; font-size: 14px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>✨ OpenGemini Canvas</h2>
    <p>Ask OpenGemini in Chat or Task mode to build an app, game, diagram, or document—or edit code directly and refine with AI below.</p>
  </div>
</body>
</html>`
    };

    this.taskSnapshot = {
      status: 'idle',
      plan: [],
      steps: [],
      subagents: []
    };
    this.filesChanged = [];
    this.terminalLogs = [];
    this.workspaceBrowserDir = '.';
    this.workspaceItems = [];

    this._bindEvents();
  }

  _bindEvents() {
    document.querySelectorAll('.aux-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.auxtab);
      });
    });

    document.getElementById('close-aux-pane-btn')?.addEventListener('click', () => {
      this.close();
    });
  }

  open(tab) {
    this.paneEl.classList.remove('hidden');
    if (tab) this.switchTab(tab);
    else this.render();
  }

  close() {
    this.paneEl.classList.add('hidden');
  }

  toggle(tab) {
    if (this.paneEl.classList.contains('hidden')) {
      this.open(tab || this.activeTab);
    } else if (tab && tab !== this.activeTab) {
      this.switchTab(tab);
    } else {
      this.close();
    }
  }

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.aux-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.auxtab === tab);
    });
    if (tab === 'diffs' && this.workspaceItems.length === 0) {
      this.loadWorkspaceDir('.');
    }
    this.render();
  }

  async openArtifactById(artifactId) {
    try {
      const full = await apiGet(`/api/artifacts/${encodeURIComponent(artifactId)}`);
      this.setCanvasArtifact(full);
      this.open('canvas');
    } catch (err) {
      this.toast(`Could not load artifact: ${err.message}`);
    }
  }

  setCanvasArtifact(artifact) {
    this.activeArtifact = {
      id: artifact.id || null,
      title: artifact.title || 'Canvas Document',
      type: artifact.type || 'html',
      content: artifact.content || ''
    };
    this.canvasMode = ['html', 'svg', 'markdown', 'md'].includes(this.activeArtifact.type)
      ? 'preview'
      : 'code';
    if (!this.paneEl.classList.contains('hidden') && this.activeTab === 'canvas') {
      this.render();
    }
  }

  setTaskState(taskSnapshot, filesChanged = []) {
    this.taskSnapshot = taskSnapshot || { status: 'idle', plan: [], steps: [], subagents: [] };
    this.filesChanged = filesChanged || [];
    this._updateDiffBadge();
    if (!this.paneEl.classList.contains('hidden')) {
      this.render();
    }
  }

  pushFileChanged(change) {
    const idx = this.filesChanged.findIndex((f) => f.filePath === change.filePath);
    if (idx >= 0) this.filesChanged[idx] = change;
    else this.filesChanged.unshift(change);
    this._updateDiffBadge();
    if (!this.paneEl.classList.contains('hidden') && this.activeTab === 'diffs') {
      this.render();
    }
  }

  pushTerminalLog(entry) {
    this.terminalLogs.push(entry);
    if (!this.paneEl.classList.contains('hidden') && this.activeTab === 'terminal') {
      this.render();
    }
  }

  _updateDiffBadge() {
    if (!this.diffsBadgeEl) return;
    if (this.filesChanged.length > 0) {
      this.diffsBadgeEl.textContent = String(this.filesChanged.length);
      this.diffsBadgeEl.classList.remove('hidden');
    } else {
      this.diffsBadgeEl.classList.add('hidden');
    }
  }

  async loadWorkspaceDir(dir = '.') {
    try {
      const res = await apiGet(`/api/workspace/files?dir=${encodeURIComponent(dir)}`);
      this.workspaceBrowserDir = res.currentDir;
      this.workspaceItems = res.items || [];
      if (!this.paneEl.classList.contains('hidden') && this.activeTab === 'diffs') {
        this.render();
      }
    } catch {}
  }

  render() {
    if (this.activeTab === 'canvas') {
      this._renderCanvas();
    } else if (this.activeTab === 'task') {
      this._renderTaskMonitor();
    } else if (this.activeTab === 'diffs') {
      this._renderDiffsAndFiles();
    } else if (this.activeTab === 'terminal') {
      this._renderTerminal();
    }
  }

  _renderCanvas() {
    const art = this.activeArtifact;
    const isPreview = this.canvasMode === 'preview';

    this.bodyEl.innerHTML = `
      <div class="canvas-toolbar">
        <input id="canvas-title-input" class="input-field" style="max-width: 190px; padding: 5px 9px; font-size: 12.5px; font-weight: 600;" value="${escapeHtml(art.title)}" />
        <div style="display:flex; gap:5px; align-items:center;">
          <button id="cv-preview-btn" class="mini-pill ${isPreview ? 'active' : ''}">Preview</button>
          <button id="cv-code-btn" class="mini-pill ${!isPreview ? 'active' : ''}">Code</button>
          <button id="cv-save-btn" class="mini-pill" title="Save to Library">Save</button>
          <button id="cv-popout-btn" class="mini-pill" title="Open in new window">↗</button>
        </div>
      </div>
      <div id="canvas-stage-area" style="flex:1; display:flex; flex-direction:column; min-height:0; overflow:auto;"></div>
      <div class="canvas-refine-bar">
        <input id="canvas-refine-input" class="input-field" placeholder="Ask AI to refine Canvas (e.g., 'Add dark mode & sound')..." style="font-size:12.5px;" />
        <button id="canvas-refine-btn" class="btn-primary" style="padding:7px 13px; white-space:nowrap;">✨ Refine</button>
      </div>
    `;

    const stage = this.bodyEl.querySelector('#canvas-stage-area');
    if (isPreview) {
      if (art.type === 'html' || art.content.trim().startsWith('<!DOCTYPE') || art.content.trim().startsWith('<html') || art.content.includes('<body')) {
        const iframe = document.createElement('iframe');
        iframe.className = 'canvas-iframe';
        iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms');
        iframe.srcdoc = art.content;
        stage.appendChild(iframe);
      } else if (art.type === 'svg' || art.content.trim().startsWith('<svg')) {
        stage.innerHTML = `<div style="padding:20px; display:grid; place-items:center; flex:1;">${art.content}</div>`;
      } else {
        stage.innerHTML = `<div class="markdown-prose" style="padding:20px;">${renderMarkdown(art.content)}</div>`;
      }
    } else {
      const ta = document.createElement('textarea');
      ta.className = 'canvas-code-editor';
      ta.value = art.content;
      ta.addEventListener('input', () => {
        this.activeArtifact.content = ta.value;
      });
      stage.appendChild(ta);
    }

    this.bodyEl.querySelector('#canvas-title-input')?.addEventListener('change', (e) => {
      this.activeArtifact.title = e.target.value;
    });
    this.bodyEl.querySelector('#cv-preview-btn')?.addEventListener('click', () => {
      this.canvasMode = 'preview';
      this.render();
    });
    this.bodyEl.querySelector('#cv-code-btn')?.addEventListener('click', () => {
      this.canvasMode = 'code';
      this.render();
    });
    this.bodyEl.querySelector('#cv-save-btn')?.addEventListener('click', async () => {
      try {
        const saved = await apiPost('/api/artifacts', this.activeArtifact);
        this.activeArtifact.id = saved.id;
        const exists = this.state.artifacts.findIndex((a) => a.id === saved.id);
        if (exists >= 0) this.state.artifacts[exists] = saved;
        else this.state.artifacts.unshift(saved);
        this.toast('Saved to Library!');
      } catch (e) {
        this.toast(`Save failed: ${e.message}`);
      }
    });
    this.bodyEl.querySelector('#cv-popout-btn')?.addEventListener('click', () => {
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(
          art.type === 'markdown'
            ? `<html><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.6;">${renderMarkdown(art.content)}</body></html>`
            : art.content
        );
        win.document.close();
      }
    });

    const refineBtn = this.bodyEl.querySelector('#canvas-refine-btn');
    const refineInput = this.bodyEl.querySelector('#canvas-refine-input');
    const runRefine = async () => {
      const instruction = refineInput.value.trim();
      if (!instruction) return;
      refineBtn.disabled = true;
      refineBtn.textContent = 'Refining...';
      try {
        const res = await apiPost('/api/canvas/refine', {
          content: this.activeArtifact.content,
          instruction,
          type: this.activeArtifact.type
        });
        if (res.content) {
          this.activeArtifact.content = res.content;
          refineInput.value = '';
          this.canvasMode = 'preview';
          this.render();
          this.toast('Canvas updated!');
        }
      } catch (err) {
        this.toast(`Refine error: ${err.message}`);
      } finally {
        refineBtn.disabled = false;
        refineBtn.textContent = '✨ Refine';
      }
    };
    refineBtn?.addEventListener('click', runRefine);
    refineInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runRefine();
    });
  }

  _renderTaskMonitor() {
    const snap = this.taskSnapshot;
    const planHtml = (snap.plan || []).length
      ? snap.plan
          .map((p) => {
            const icon = p.status === 'completed' ? '✅' : p.status === 'in_progress' ? '🔄' : '⬜';
            return `<div class="plan-step-row ${p.status}"><span>${icon}</span><span>${escapeHtml(p.title)}</span></div>`;
          })
          .join('')
      : `<div style="font-size:12.5px;color:var(--text-muted);">Switch to <strong>Task</strong> mode below the prompt bar and assign a multi-step goal to see live planning, tool calls, and subagent orchestration.</div>`;

    const subagentsHtml = (snap.subagents || []).length
      ? snap.subagents
          .map(
            (s) => `
          <div class="hub-card" style="padding:10px 12px; gap:4px;">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;">
              <span>🤖 ${escapeHtml(s.role)}</span>
              <span class="status-pill ${s.status === 'completed' ? 'done' : ''}">${escapeHtml(s.status)}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(s.prompt)}</div>
            ${s.summary ? `<div style="font-size:12px;margin-top:4px;">${escapeHtml(s.summary.slice(0, 260))}</div>` : ''}
          </div>`
          )
          .join('')
      : `<div style="font-size:12px;color:var(--text-muted);">No subagents spawned in this session yet.</div>`;

    const stepsHtml = (snap.steps || []).length
      ? snap.steps
          .map(
            (st) => `
          <details style="border:1px solid var(--border-subtle);border-radius:10px;padding:7px 10px;background:var(--bg-surface);font-size:12px;">
            <summary style="cursor:pointer;font-family:var(--font-mono);display:flex;justify-content:space-between;">
              <span>🔧 ${escapeHtml(st.name)}</span>
              <span style="color:var(--text-muted);">${st.durationMs || 0}ms</span>
            </summary>
            <pre style="margin:6px 0 0;font-size:11px;overflow-x:auto;color:var(--text-muted);">Args: ${escapeHtml(JSON.stringify(st.args, null, 2))}\n\nResult: ${escapeHtml(JSON.stringify(st.result, null, 2).slice(0, 800))}</pre>
          </details>`
          )
          .join('')
      : `<div style="font-size:12px;color:var(--text-muted);">No tool executions recorded yet.</div>`;

    this.bodyEl.innerHTML = `
      <div style="padding:14px; display:flex; flex-direction:column; gap:16px;">
        <div>
          <div class="field-label">Task Implementation Plan</div>
          <div class="hub-card" style="padding:12px;">${planHtml}</div>
        </div>
        <div>
          <div class="field-label">Subagents (${(snap.subagents || []).length})</div>
          <div style="display:flex;flex-direction:column;gap:8px;">${subagentsHtml}</div>
        </div>
        <div>
          <div class="field-label">Agent Tool Trace (${(snap.steps || []).length})</div>
          <div style="display:flex;flex-direction:column;gap:6px;">${stepsHtml}</div>
        </div>
      </div>
    `;
  }

  _renderDiffsAndFiles() {
    const diffsHtml = this.filesChanged.length
      ? this.filesChanged
          .map((fc) => {
            const coloredLines = (fc.diff || '')
              .split('\n')
              .map((line) => {
                if (line.startsWith('+ ')) return `<span class="diff-add">${escapeHtml(line)}</span>`;
                if (line.startsWith('- ')) return `<span class="diff-del">${escapeHtml(line)}</span>`;
                return escapeHtml(line);
              })
              .join('\n');
            return `
              <div class="hub-card" style="padding:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;">
                  <strong>📄 ${escapeHtml(fc.fileName)}</strong>
                  <span>
                    <span style="color:var(--accent-green);font-weight:600;">+${fc.additions}</span> /
                    <span style="color:var(--accent-red);font-weight:600;">-${fc.deletions}</span>
                  </span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);word-break:break-all;">${escapeHtml(fc.filePath)}</div>
                <pre class="diff-pre">${coloredLines}</pre>
              </div>
            `;
          })
          .join('')
      : `<div style="font-size:12.5px;color:var(--text-muted);">No workspace files modified in the current session yet.</div>`;

    const filesHtml = this.workspaceItems
      .slice(0, 60)
      .map(
        (item) => `
        <button class="nav-subitem ws-entry-btn" data-type="${item.type}" data-path="${escapeHtml(item.path)}">
          <span>${item.type === 'directory' ? '📁' : '📄'}</span>
          <span>${escapeHtml(item.name)}</span>
        </button>`
      )
      .join('');

    this.bodyEl.innerHTML = `
      <div style="padding:14px; display:flex; flex-direction:column; gap:16px;">
        <div>
          <div class="field-label">Session Files Changed (${this.filesChanged.length})</div>
          <div style="display:flex;flex-direction:column;gap:10px;">${diffsHtml}</div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span class="field-label" style="margin:0;">Workspace Explorer</span>
            <button id="ws-up-btn" class="mini-pill">↑ Parent</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;word-break:break-all;">${escapeHtml(this.workspaceBrowserDir)}</div>
          <div class="hub-card" style="padding:8px;max-height:290px;overflow-y:auto;gap:2px;">
            ${filesHtml || '<div style="font-size:12px;color:var(--text-muted);padding:8px;">Empty directory</div>'}
          </div>
        </div>
      </div>
    `;

    this.bodyEl.querySelector('#ws-up-btn')?.addEventListener('click', () => {
      this.loadWorkspaceDir(`${this.workspaceBrowserDir}/..`);
    });

    this.bodyEl.querySelectorAll('.ws-entry-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = btn.dataset.path;
        if (btn.dataset.type === 'directory') {
          this.loadWorkspaceDir(p);
        } else {
          try {
            const file = await apiGet(`/api/workspace/file?path=${encodeURIComponent(p)}`);
            this.setCanvasArtifact({
              title: file.name,
              type: file.name.endsWith('.md') ? 'markdown' : file.name.endsWith('.html') ? 'html' : 'code',
              content: file.content
            });
            this.switchTab('canvas');
          } catch (err) {
            this.toast(`Cannot preview file: ${err.message}`);
          }
        }
      });
    });
  }

  _renderTerminal() {
    const logsHtml = this.terminalLogs.length
      ? this.terminalLogs
          .map(
            (l) => `
          <div style="margin-bottom:12px;border-bottom:1px solid var(--border-subtle);padding-bottom:8px;">
            <div style="color:var(--accent-blue);font-weight:600;">$ ${escapeHtml(l.command)} <span style="color:var(--text-muted);font-weight:400;">(exit ${l.exitCode})</span></div>
            ${l.stdout ? `<pre style="margin:4px 0 0;white-space:pre-wrap;color:var(--text-primary);">${escapeHtml(l.stdout)}</pre>` : ''}
            ${l.stderr ? `<pre style="margin:4px 0 0;white-space:pre-wrap;color:var(--accent-red);">${escapeHtml(l.stderr)}</pre>` : ''}
          </div>`
          )
          .join('')
      : `<div style="color:var(--text-muted);">Workspace Terminal ready (${escapeHtml(this.state.settings.workspacePath || '')}).</div>`;

    this.bodyEl.innerHTML = `
      <div style="flex:1;padding:12px;font-family:var(--font-mono);font-size:12px;overflow-y:auto;background:var(--bg-main);" id="term-scroll-box">
        ${logsHtml}
      </div>
      <div class="canvas-refine-bar">
        <input id="term-cmd-input" class="input-field" style="font-family:var(--font-mono);font-size:12.5px;" placeholder="Run workspace command (e.g. git status, node -v)..." />
        <button id="term-run-btn" class="btn-primary">Run</button>
      </div>
    `;

    const input = this.bodyEl.querySelector('#term-cmd-input');
    const btn = this.bodyEl.querySelector('#term-run-btn');
    const execCmd = async () => {
      const cmd = input.value.trim();
      if (!cmd) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await apiPost('/api/workspace/terminal', { command: cmd });
        this.terminalLogs.push(res);
        this.render();
      } catch (err) {
        this.toast(`Command failed: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Run';
      }
    };
    btn?.addEventListener('click', execCmd);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') execCmd();
    });
  }
}
