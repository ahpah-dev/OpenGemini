import { apiPost, apiDelete } from './api.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

export function renderLibraryHub(container, app) {
  const { state, auxPane, toast } = app;
  let activeFilter = 'all';

  function draw() {
    const artifacts = (state.artifacts || []).filter((a) =>
      activeFilter === 'all' ? true : a.type === activeFilter
    );
    const pinnedChats = (state.chats || []).filter((c) => c.pinned);

    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Library</h2>
            <p class="hub-subtitle">Your saved Canvas artifacts, interactive HTML5 apps, research reports, and pinned threads.</p>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${['all', 'html', 'markdown', 'svg', 'code']
              .map(
                (f) =>
                  `<button class="mini-pill lib-filter ${activeFilter === f ? 'active' : ''}" data-f="${f}" style="padding:5px 12px;font-size:12px;">${f.toUpperCase()}</button>`
              )
              .join('')}
            <button id="lib-new-canvas-btn" class="btn-primary">+ New Canvas</button>
          </div>
        </div>

        <div class="card-grid">
          ${
            artifacts.length
              ? artifacts
                  .map(
                    (a) => `
                <div class="hub-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="status-pill">${escapeHtml((a.type || 'file').toUpperCase())}</span>
                    <span style="font-size:11px;color:var(--text-muted);">${new Date(a.createdAt || Date.now()).toLocaleDateString()}</span>
                  </div>
                  <strong style="font-size:15px;">${escapeHtml(a.title)}</strong>
                  <p style="margin:0;font-size:12.5px;color:var(--text-muted);flex:1;">${escapeHtml(a.description || a.filename || 'Saved OpenGemini artifact')}</p>
                  <div style="display:flex;gap:8px;margin-top:6px;">
                    <button class="btn-primary open-art-btn" data-id="${escapeHtml(a.id)}" style="padding:6px 13px;font-size:12px;">Open in Canvas</button>
                    <button class="btn-secondary del-art-btn" data-id="${escapeHtml(a.id)}" style="padding:6px 11px;font-size:12px;">Delete</button>
                  </div>
                </div>`
                  )
                  .join('')
              : `<div class="hub-card"><p style="margin:0;color:var(--text-muted);font-size:13px;">No artifacts match this filter yet. Try asking Task mode to build an app or report!</p></div>`
          }
        </div>

        ${
          pinnedChats.length
            ? `
          <h3 style="margin:28px 0 12px;font-size:16px;">📌 Pinned Conversations &amp; Tasks</h3>
          <div class="card-grid">
            ${pinnedChats
              .map(
                (c) => `
              <div class="hub-card" style="cursor:pointer;" data-openchat="${escapeHtml(c.id)}">
                <div style="display:flex;justify-content:space-between;">
                  <span class="status-pill">${escapeHtml((c.mode || 'chat').toUpperCase())}</span>
                  <span style="font-size:11px;color:var(--text-muted);">${(c.messages || []).length} msgs</span>
                </div>
                <strong>${escapeHtml(c.title)}</strong>
              </div>`
              )
              .join('')}
          </div>`
            : ''
        }
      </div>
    `;

    container.querySelectorAll('.lib-filter').forEach((b) => {
      b.addEventListener('click', () => {
        activeFilter = b.dataset.f;
        draw();
      });
    });

    container.querySelector('#lib-new-canvas-btn')?.addEventListener('click', () => {
      app.showChatStage();
      auxPane.open('canvas');
    });

    container.querySelectorAll('.open-art-btn').forEach((b) => {
      b.addEventListener('click', () => auxPane.openArtifactById(b.dataset.id));
    });

    container.querySelectorAll('.del-art-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        await apiDelete(`/api/artifacts/${encodeURIComponent(b.dataset.id)}`);
        state.artifacts = state.artifacts.filter((x) => x.id !== b.dataset.id);
        toast('Artifact removed');
        draw();
      });
    });

    container.querySelectorAll('[data-openchat]').forEach((card) => {
      card.addEventListener('click', () => app.openChat(card.dataset.openchat));
    });
  }

  draw();
}

export function renderImagesHub(container, app) {
  const { state, toast } = app;
  let selectedRemixSvg = '';

  function draw() {
    const images = state.images || [];
    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Images Studio</h2>
            <p class="hub-subtitle">Generate illustrations &amp; UI graphics locally via your LLM (SVG Studio), Pollinations Flux, OpenAI DALL-E 3, or Local Stable Diffusion.</p>
          </div>
        </div>

        <div class="hub-card" style="margin-bottom:22px;">
          ${
            selectedRemixSvg
              ? `<div class="ctx-chip" style="width:fit-content;">✨ Remixing selected vector artwork <button id="clear-remix-btn">×</button></div>`
              : ''
          }
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="img-prompt-input" class="input-field" style="flex:1;min-width:240px;" placeholder="${selectedRemixSvg ? 'Describe how to modify this artwork (e.g., Change sky to sunset orange)...' : 'Describe an image to create (e.g., Minimalist isometric cyberpunk coffee shop at dusk)...'}" />
            <select id="img-provider-select" class="select-field" style="width:225px;">
              <option value="svg-llm" ${state.settings.imageProvider === 'svg-llm' ? 'selected' : ''}>Local LLM Vector Studio (Offline)</option>
              <option value="pollinations" ${state.settings.imageProvider === 'pollinations' ? 'selected' : ''}>Pollinations Flux (Zero-Key)</option>
              <option value="openai" ${state.settings.imageProvider === 'openai' ? 'selected' : ''}>OpenAI DALL-E 3 (BYOK)</option>
              <option value="sd-webui" ${state.settings.imageProvider === 'sd-webui' ? 'selected' : ''}>Local SD WebUI (127.0.0.1:7860)</option>
            </select>
            <select id="img-style-select" class="select-field" style="width:145px;">
              <option value="vivid">Vivid Modern</option>
              <option value="minimalist geometric">Minimalist</option>
              <option value="cyberpunk neon">Neon Synth</option>
              <option value="blueprint diagram">Blueprint</option>
            </select>
            <button id="img-gen-btn" class="btn-primary">Generate</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">
            <button class="mini-pill img-preset" data-p="Futuristic glass observatory floating above clouds, soft pastel gradients">🏛️ Sky Observatory</button>
            <button class="mini-pill img-preset" data-p="Cozy Japanese ramen stall at night with warm lantern glow">🍜 Night Ramen Stall</button>
            <button class="mini-pill img-preset" data-p="Clean neural network architecture diagram with glowing nodes">🧠 Neural Diagram</button>
          </div>
        </div>

        <div class="card-grid">
          ${images
            .map(
              (img) => `
            <div class="hub-card" style="padding:12px;">
              <div style="border-radius:12px;overflow:hidden;background:var(--bg-subtle);aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;">
                ${
                  img.svgContent
                    ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${img.svgContent}</div>`
                    : `<img src="${escapeHtml(img.imageUrl || '')}" alt="${escapeHtml(img.prompt)}" style="width:100%;height:100%;object-fit:cover;" />`
                }
              </div>
              <div style="font-size:12.5px;font-weight:500;">${escapeHtml(img.prompt)}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;">
                <span class="cap-badge">${escapeHtml(img.provider)}</span>
                <div style="display:flex;gap:6px;">
                  ${img.svgContent ? `<button class="mini-pill remix-svg-btn" data-id="${escapeHtml(img.id)}">Remix</button>` : ''}
                  <button class="mini-pill del-img-btn" data-id="${escapeHtml(img.id)}">Delete</button>
                </div>
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>
    `;

    container.querySelector('#clear-remix-btn')?.addEventListener('click', () => {
      selectedRemixSvg = '';
      draw();
    });

    container.querySelectorAll('.img-preset').forEach((b) => {
      b.addEventListener('click', () => {
        container.querySelector('#img-prompt-input').value = b.dataset.p;
      });
    });

    container.querySelectorAll('.remix-svg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const found = state.images.find((x) => x.id === b.dataset.id);
        if (found?.svgContent) {
          selectedRemixSvg = found.svgContent;
          draw();
          container.querySelector('#img-prompt-input')?.focus();
        }
      });
    });

    container.querySelectorAll('.del-img-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        await apiDelete(`/api/images/${encodeURIComponent(b.dataset.id)}`);
        state.images = state.images.filter((x) => x.id !== b.dataset.id);
        draw();
      });
    });

    const genBtn = container.querySelector('#img-gen-btn');
    const promptInput = container.querySelector('#img-prompt-input');
    const triggerGen = async () => {
      const prompt = promptInput.value.trim();
      if (!prompt) return;
      genBtn.disabled = true;
      genBtn.textContent = 'Creating...';
      try {
        const created = await apiPost('/api/images/generate', {
          prompt,
          provider: container.querySelector('#img-provider-select').value,
          style: container.querySelector('#img-style-select').value,
          previousSvg: selectedRemixSvg
        });
        state.images.unshift(created);
        selectedRemixSvg = '';
        toast('Image generated!');
        draw();
      } catch (err) {
        toast(`Image generation failed: ${err.message}`);
        genBtn.disabled = false;
        genBtn.textContent = 'Generate';
      }
    };
    genBtn?.addEventListener('click', triggerGen);
    promptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') triggerGen();
    });
  }

  draw();
}

export function renderScheduledHub(container, app) {
  const { state, toast } = app;

  function draw() {
    const items = state.scheduled || [];
    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Scheduled Actions</h2>
            <p class="hub-subtitle">Automate recurring prompts, daily briefings, and workspace health checks on a local background timer.</p>
          </div>
        </div>

        <div class="hub-card" style="margin-bottom:22px;">
          <strong style="font-size:14px;">+ Create Scheduled Task</strong>
          <div style="display:grid;grid-template-columns:1fr 160px;gap:10px;">
            <input id="sched-title" class="input-field" placeholder="Task title (e.g., Morning Tech Digest or Git Repo Check)" />
            <select id="sched-interval" class="select-field">
              <option value="15">Every 15 mins</option>
              <option value="60" selected>Hourly (60m)</option>
              <option value="360">Every 6 hours</option>
              <option value="1440">Daily (24h)</option>
            </select>
          </div>
          <textarea id="sched-prompt" class="textarea-field" rows="2" placeholder="Prompt or check to execute automatically..."></textarea>
          <div><button id="add-sched-btn" class="btn-primary">Save Schedule</button></div>
        </div>

        <div style="display:flex;flex-direction:column;gap:14px;">
          ${items
            .map(
              (s) => `
            <div class="hub-card">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <strong style="font-size:15px;">⏰ ${escapeHtml(s.title)}</strong>
                  <span class="status-pill ${s.enabled ? 'done' : ''}">${s.enabled ? 'Active' : 'Paused'} · Every ${s.intervalMinutes}m</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn-secondary run-sched-btn" data-id="${escapeHtml(s.id)}" style="padding:5px 12px;font-size:12px;">▶ Run Now</button>
                  <button class="btn-secondary toggle-sched-btn" data-id="${escapeHtml(s.id)}" style="padding:5px 12px;font-size:12px;">${s.enabled ? 'Pause' : 'Enable'}</button>
                  <button class="btn-secondary del-sched-btn" data-id="${escapeHtml(s.id)}" style="padding:5px 12px;font-size:12px;">Delete</button>
                </div>
              </div>
              <div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(s.prompt)}</div>
              ${
                (s.logs || []).length
                  ? `<div style="background:var(--bg-subtle);padding:8px 12px;border-radius:10px;font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);max-height:110px;overflow-y:auto;">
                      ${s.logs.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
                    </div>`
                  : ''
              }
            </div>`
            )
            .join('')}
        </div>
      </div>
    `;

    container.querySelector('#add-sched-btn')?.addEventListener('click', async () => {
      const title = container.querySelector('#sched-title').value.trim();
      const prompt = container.querySelector('#sched-prompt').value.trim();
      const intervalMinutes = Number(container.querySelector('#sched-interval').value) || 60;
      if (!title || !prompt) return toast('Enter both a title and prompt');
      const saved = await apiPost('/api/scheduled', { title, prompt, intervalMinutes, enabled: true });
      state.scheduled.unshift(saved);
      toast('Scheduled task created!');
      draw();
    });

    container.querySelectorAll('.run-sched-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Running...';
        try {
          const updated = await apiPost(`/api/scheduled/${encodeURIComponent(b.dataset.id)}/run`);
          const idx = state.scheduled.findIndex((x) => x.id === updated.id);
          if (idx >= 0) state.scheduled[idx] = updated;
          toast('Scheduled task executed!');
          draw();
        } catch (err) {
          toast(`Run failed: ${err.message}`);
          b.disabled = false;
          b.textContent = '▶ Run Now';
        }
      });
    });

    container.querySelectorAll('.toggle-sched-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        const item = state.scheduled.find((x) => x.id === b.dataset.id);
        if (!item) return;
        const updated = await apiPost('/api/scheduled', { ...item, enabled: !item.enabled });
        const idx = state.scheduled.findIndex((x) => x.id === updated.id);
        if (idx >= 0) state.scheduled[idx] = updated;
        draw();
      });
    });

    container.querySelectorAll('.del-sched-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        await apiDelete(`/api/scheduled/${encodeURIComponent(b.dataset.id)}`);
        state.scheduled = state.scheduled.filter((x) => x.id !== b.dataset.id);
        draw();
      });
    });
  }

  draw();
}

export function renderStudentsHub(container, app) {
  const { toast } = app;
  let studyResult = null;
  let score = 0;
  let answeredCount = 0;

  function draw() {
    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Students &amp; Guided Learning</h2>
            <p class="hub-subtitle">Generate adaptive practice exams, interactive 3D flashcards, and Socratic study breakdowns using your active AI model.</p>
          </div>
        </div>

        <div class="hub-card" style="margin-bottom:22px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input id="stu-topic" class="input-field" style="flex:1;min-width:240px;" placeholder="Enter any subject or exam topic (e.g., Transformer Attention Mechanisms, Organic Chemistry, Rust Ownership)..." />
            <select id="stu-type" class="select-field" style="width:190px;">
              <option value="quiz">Adaptive Practice Quiz</option>
              <option value="flashcards">Study Flashcards</option>
              <option value="guide">Exam Study Breakdown</option>
            </select>
            <select id="stu-diff" class="select-field" style="width:145px;">
              <option value="beginner">Beginner</option>
              <option value="intermediate" selected>Intermediate</option>
              <option value="advanced exam">Advanced Exam</option>
            </select>
            <button id="stu-gen-btn" class="btn-primary">Generate</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="mini-pill stu-preset" data-t="Transformer Self-Attention & KV Caching">🤖 LLM Architecture</button>
            <button class="mini-pill stu-preset" data-t="Dynamic Programming & Graph Algorithms">💻 Algorithms Prep</button>
            <button class="mini-pill stu-preset" data-t="Linear Algebra Eigenvalues & SVD">📐 Linear Algebra</button>
            <button id="stu-socratic-btn" class="mini-pill">🎓 Start Socratic Tutor in Chat</button>
          </div>
        </div>

        <div id="stu-output-zone"></div>
      </div>
    `;

    const outZone = container.querySelector('#stu-output-zone');
    if (studyResult) {
      if (studyResult.toolType === 'quiz' && Array.isArray(studyResult.items)) {
        outZone.innerHTML = `
          <div style="margin-bottom:12px;font-weight:600;" id="quiz-score-banner">Practice Test: ${escapeHtml(studyResult.topic)}</div>
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${studyResult.items
              .map(
                (q, qi) => `
              <div class="hub-card" data-qidx="${qi}">
                <strong>Q${qi + 1}. ${escapeHtml(q.question)}</strong>
                <div>
                  ${(q.options || [])
                    .map(
                      (opt, oi) =>
                        `<button class="quiz-option" data-qi="${qi}" data-oi="${oi}">${escapeHtml(opt)}</button>`
                    )
                    .join('')}
                </div>
                ${q.hint ? `<details style="font-size:12px;color:var(--text-muted);"><summary style="cursor:pointer;">💡 Show Hint</summary><div style="margin-top:4px;">${escapeHtml(q.hint)}</div></details>` : ''}
                <div class="quiz-exp hidden" id="qexp-${qi}" style="font-size:13px;padding:8px 12px;border-radius:10px;background:var(--bg-subtle);"></div>
              </div>`
              )
              .join('')}
          </div>
        `;

        outZone.querySelectorAll('.quiz-option').forEach((btn) => {
          btn.addEventListener('click', () => {
            const qi = Number(btn.dataset.qi);
            const oi = Number(btn.dataset.oi);
            const card = btn.closest('.hub-card');
            if (card.dataset.answered) return;
            card.dataset.answered = '1';
            const q = studyResult.items[qi];
            const correct = Number(q.correctIndex) || 0;
            answeredCount++;
            if (oi === correct) {
              btn.classList.add('correct');
              score++;
            } else {
              btn.classList.add('wrong');
              card.querySelectorAll('.quiz-option')[correct]?.classList.add('correct');
            }
            const expEl = card.querySelector(`#qexp-${qi}`);
            if (expEl) {
              expEl.textContent = q.explanation || 'Review the highlighted answer above.';
              expEl.classList.remove('hidden');
            }
            const banner = outZone.querySelector('#quiz-score-banner');
            if (banner) {
              banner.textContent = `Practice Test: ${studyResult.topic} — Score: ${score}/${answeredCount}`;
            }
          });
        });
      } else if (studyResult.toolType === 'flashcards' && Array.isArray(studyResult.items)) {
        outZone.innerHTML = `
          <div style="margin-bottom:12px;font-weight:600;">Click any card to flip (${studyResult.items.length} cards)</div>
          <div class="flashcard-grid">
            ${studyResult.items
              .map(
                (c) => `
              <div class="flashcard" data-front="${escapeHtml(c.front)}" data-back="${escapeHtml(c.back)}">
                <span class="cap-badge" style="width:fit-content;">PROMPT</span>
                <div class="fc-body" style="font-size:14.5px;font-weight:500;margin-top:8px;">${escapeHtml(c.front)}</div>
                <span style="font-size:11px;color:var(--text-muted);margin-top:12px;">Click to flip ↻</span>
              </div>`
              )
              .join('')}
          </div>
        `;
        outZone.querySelectorAll('.flashcard').forEach((card) => {
          card.addEventListener('click', () => {
            const flipped = card.classList.toggle('flipped');
            card.querySelector('.cap-badge').textContent = flipped ? 'ANSWER' : 'PROMPT';
            card.querySelector('.fc-body').textContent = flipped ? card.dataset.back : card.dataset.front;
          });
        });
      } else {
        outZone.innerHTML = `<div class="hub-card markdown-prose">${renderMarkdown(studyResult.markdown || studyResult.raw || '')}</div>`;
      }
    }

    container.querySelectorAll('.stu-preset').forEach((b) => {
      b.addEventListener('click', () => {
        container.querySelector('#stu-topic').value = b.dataset.t;
      });
    });

    container.querySelector('#stu-socratic-btn')?.addEventListener('click', () => {
      const topic = container.querySelector('#stu-topic').value.trim() || 'Computer Science fundamentals';
      app.activateGem('gem-learning-coach');
      app.showChatStage();
      app.setPromptAndFocus(`Teach me "${topic}" step-by-step using the Socratic method. Start with an intuitive analogy and ask me one check question.`);
    });

    const genBtn = container.querySelector('#stu-gen-btn');
    genBtn?.addEventListener('click', async () => {
      const topic = container.querySelector('#stu-topic').value.trim();
      if (!topic) return toast('Enter a topic to study');
      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
      score = 0;
      answeredCount = 0;
      try {
        studyResult = await apiPost('/api/students/generate', {
          topic,
          toolType: container.querySelector('#stu-type').value,
          difficulty: container.querySelector('#stu-diff').value
        });
        draw();
      } catch (err) {
        toast(`Failed: ${err.message}`);
        genBtn.disabled = false;
        genBtn.textContent = 'Generate';
      }
    });
  }

  draw();
}

export function renderNotebooksHub(container, app, selectedNotebookId = null) {
  const { state, toast } = app;
  let activeId = selectedNotebookId || state.notebooks?.[0]?.id || null;
  let speaking = false;

  function stopAudio() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speaking = false;
  }

  function draw() {
    const notebooks = state.notebooks || [];
    const activeNb = notebooks.find((n) => n.id === activeId) || null;

    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Notebooks</h2>
            <p class="hub-subtitle">NotebookLM-style grounded project workspaces with source files, Study Guides, Flashcards, and 2-Host Audio Overviews.</p>
          </div>
          <button id="nb-create-btn" class="btn-primary">+ New Notebook</button>
        </div>

        <div style="display:grid;grid-template-columns:250px 1fr;gap:18px;align-items:start;">
          <div class="hub-card" style="padding:10px;gap:4px;">
            ${notebooks
              .map(
                (n) => `
              <button class="nav-subitem nb-pick-btn ${n.id === activeId ? 'active' : ''}" data-id="${escapeHtml(n.id)}">
                <span>📓</span>
                <span>${escapeHtml(n.title)}</span>
              </button>`
              )
              .join('')}
          </div>

          <div>
            ${
              activeNb
                ? `
              <div class="hub-card" style="gap:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                  <input id="nb-title-edit" class="input-field" style="font-size:17px;font-weight:600;max-width:380px;" value="${escapeHtml(activeNb.title)}" />
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button id="nb-chat-btn" class="btn-primary">💬 Chat with Notebook</button>
                    <button id="nb-task-btn" class="btn-secondary">⚡ Run Task with Notebook</button>
                    <button id="nb-del-btn" class="btn-secondary">Delete</button>
                  </div>
                </div>

                <div>
                  <label class="field-label">Notebook System Instructions</label>
                  <textarea id="nb-inst-edit" class="textarea-field" rows="2" placeholder="Custom instructions for chats inside this notebook...">${escapeHtml(activeNb.instructions || '')}</textarea>
                  <button id="nb-save-meta-btn" class="mini-pill" style="margin-top:6px;">Save Instructions</button>
                </div>

                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <label class="field-label" style="margin:0;">Grounded Sources (${(activeNb.sources || []).length})</label>
                    <div style="display:flex;gap:6px;">
                      <button id="nb-add-text-btn" class="mini-pill">+ Paste Note</button>
                      <button id="nb-add-url-btn" class="mini-pill">+ Web URL</button>
                      <button id="nb-add-file-btn" class="mini-pill">+ Upload File</button>
                      <input type="file" id="nb-file-input" class="hidden" />
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:6px;">
                    ${
                      (activeNb.sources || []).length
                        ? activeNb.sources
                            .map(
                              (s, idx) => `
                          <div class="tool-call-pill">
                            <span>📄 <strong>${escapeHtml(s.title)}</strong> <span style="color:var(--text-muted);">(${(s.content || '').length} chars)</span></span>
                            <button class="icon-btn-xs del-src-btn" data-idx="${idx}">×</button>
                          </div>`
                            )
                            .join('')
                        : `<div style="font-size:12.5px;color:var(--text-muted);">Add text notes, code files, markdown docs, or URLs to ground this notebook.</div>`
                    }
                  </div>
                </div>

                <div style="border-top:1px solid var(--border-subtle);padding-top:12px;">
                  <label class="field-label">NotebookLM Studio Actions</label>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn-secondary nb-gen-btn" data-act="studyGuide">📑 Generate Study Guide</button>
                    <button class="btn-secondary nb-gen-btn" data-act="flashcards">🗂️ Generate Flashcards</button>
                    <button class="btn-secondary nb-gen-btn" data-act="audioOverview">🎙️ Generate 2-Host Audio Overview</button>
                  </div>
                </div>

                ${
                  (activeNb.audioScript || []).length
                    ? `
                  <div class="hub-card" style="background:var(--bg-subtle);">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <strong>🎧 Deep Dive Audio Overview (Alex &amp; Maya)</strong>
                      <button id="nb-play-audio-btn" class="btn-primary" style="padding:5px 14px;">${speaking ? '⏹ Stop Audio' : '▶ Listen Now'}</button>
                    </div>
                    <div style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;font-size:13px;">
                      ${activeNb.audioScript.map((turn) => `<div><strong>${escapeHtml(turn.speaker)}:</strong> ${escapeHtml(turn.text)}</div>`).join('')}
                    </div>
                  </div>`
                    : ''
                }

                ${
                  (activeNb.flashcards || []).length
                    ? `
                  <div>
                    <label class="field-label">Notebook Flashcards</label>
                    <div class="flashcard-grid">
                      ${activeNb.flashcards
                        .map(
                          (f) => `<div class="hub-card" style="padding:12px;"><strong>${escapeHtml(f.front)}</strong><div style="font-size:12.5px;color:var(--text-muted);">${escapeHtml(f.back)}</div></div>`
                        )
                        .join('')}
                    </div>
                  </div>`
                    : ''
                }

                ${
                  activeNb.studyGuide
                    ? `<div><label class="field-label">Executive Briefing &amp; Study Guide</label><div class="hub-card markdown-prose">${renderMarkdown(activeNb.studyGuide)}</div></div>`
                    : ''
                }
              </div>`
                : `<div class="hub-card">Create or select a Notebook on the left.</div>`
            }
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('.nb-pick-btn').forEach((b) => {
      b.addEventListener('click', () => {
        stopAudio();
        activeId = b.dataset.id;
        draw();
      });
    });

    container.querySelector('#nb-create-btn')?.addEventListener('click', async () => {
      const created = await apiPost('/api/notebooks', {
        title: 'Untitled Research Notebook',
        instructions: 'Ground answers in the attached notebook sources.',
        sources: []
      });
      state.notebooks.unshift(created);
      activeId = created.id;
      app.renderSidebarNotebooks();
      draw();
    });

    if (!activeNb) return;

    const persistNb = async (patch) => {
      const saved = await apiPost('/api/notebooks', { ...activeNb, ...patch });
      const i = state.notebooks.findIndex((x) => x.id === saved.id);
      if (i >= 0) state.notebooks[i] = saved;
      app.renderSidebarNotebooks();
      draw();
    };

    container.querySelector('#nb-save-meta-btn')?.addEventListener('click', () => {
      persistNb({
        title: container.querySelector('#nb-title-edit').value.trim() || activeNb.title,
        instructions: container.querySelector('#nb-inst-edit').value
      });
      toast('Notebook saved!');
    });

    container.querySelector('#nb-add-text-btn')?.addEventListener('click', () => {
      app.openSimpleModal('Add Text Source', `
        <label class="field-label">Source Title</label>
        <input id="m-src-title" class="input-field" placeholder="e.g. Architecture Notes" style="margin-bottom:10px;" />
        <label class="field-label">Content</label>
        <textarea id="m-src-body" class="textarea-field" rows="6" placeholder="Paste documentation, notes, or article text..."></textarea>
        <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
          <button id="m-src-save" class="btn-primary">Add Source</button>
        </div>
      `, (modalEl, close) => {
        modalEl.querySelector('#m-src-save')?.addEventListener('click', () => {
          const title = modalEl.querySelector('#m-src-title').value.trim() || 'Note';
          const content = modalEl.querySelector('#m-src-body').value;
          if (!content.trim()) return;
          const sources = [...(activeNb.sources || []), { id: `src-${Date.now()}`, type: 'text', title, content }];
          close();
          persistNb({ sources });
        });
      });
    });

    container.querySelector('#nb-add-url-btn')?.addEventListener('click', () => {
      app.openSimpleModal('Add Web URL Source', `
        <label class="field-label">Webpage URL</label>
        <input id="m-url-val" class="input-field" placeholder="https://en.wikipedia.org/wiki/..." />
        <div style="margin-top:14px;display:flex;justify-content:flex-end;">
          <button id="m-url-save" class="btn-primary">Fetch &amp; Add</button>
        </div>
      `, (modalEl, close) => {
        modalEl.querySelector('#m-url-save')?.addEventListener('click', async () => {
          const url = modalEl.querySelector('#m-url-val').value.trim();
          if (!url) return;
          close();
          toast('Fetching webpage content...');
          const sources = [...(activeNb.sources || []), { id: `src-${Date.now()}`, type: 'url', url, title: url, content: '' }];
          await persistNb({ sources });
        });
      });
    });

    const fileInput = container.querySelector('#nb-file-input');
    container.querySelector('#nb-add-file-btn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const text = await f.text();
      const sources = [...(activeNb.sources || []), { id: `src-${Date.now()}`, type: 'file', title: f.name, content: text.slice(0, 30000) }];
      persistNb({ sources });
    });

    container.querySelectorAll('.del-src-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.idx);
        const sources = (activeNb.sources || []).filter((_, i) => i !== idx);
        persistNb({ sources });
      });
    });

    container.querySelectorAll('.nb-gen-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        const action = b.dataset.act;
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = 'Generating...';
        try {
          const updated = await apiPost(`/api/notebooks/${encodeURIComponent(activeNb.id)}/generate`, { action });
          const idx = state.notebooks.findIndex((x) => x.id === updated.id);
          if (idx >= 0) state.notebooks[idx] = updated;
          toast('Notebook studio output ready!');
          draw();
        } catch (err) {
          toast(`Generation failed: ${err.message}`);
          b.disabled = false;
          b.textContent = orig;
        }
      });
    });

    container.querySelector('#nb-play-audio-btn')?.addEventListener('click', () => {
      if (!('speechSynthesis' in window)) return toast('Browser Speech Synthesis not supported');
      if (speaking) {
        stopAudio();
        draw();
        return;
      }
      speaking = true;
      draw();
      const voices = window.speechSynthesis.getVoices();
      const turns = activeNb.audioScript || [];
      let i = 0;
      const speakNext = () => {
        if (!speaking || i >= turns.length) {
          speaking = false;
          draw();
          return;
        }
        const turn = turns[i++];
        const utter = new SpeechSynthesisUtterance(turn.text);
        if (voices.length > 1) {
          utter.voice = turn.speaker === 'Maya' ? voices[1 % voices.length] : voices[0];
        }
        utter.pitch = turn.speaker === 'Maya' ? 1.12 : 0.96;
        utter.onend = speakNext;
        window.speechSynthesis.speak(utter);
      };
      speakNext();
    });

    container.querySelector('#nb-chat-btn')?.addEventListener('click', () => {
      stopAudio();
      app.attachNotebook(activeNb.id);
      app.setMode('chat');
      app.showChatStage(true);
    });

    container.querySelector('#nb-task-btn')?.addEventListener('click', () => {
      stopAudio();
      app.attachNotebook(activeNb.id);
      app.setMode('task');
      app.showChatStage(true);
    });

    container.querySelector('#nb-del-btn')?.addEventListener('click', async () => {
      stopAudio();
      await apiDelete(`/api/notebooks/${encodeURIComponent(activeNb.id)}`);
      state.notebooks = state.notebooks.filter((x) => x.id !== activeNb.id);
      activeId = state.notebooks[0]?.id || null;
      app.renderSidebarNotebooks();
      draw();
    });
  }

  draw();
}

export function renderMoreHub(container, app) {
  const { state, toast } = app;
  let subTab = 'gems'; // 'gems' | 'research' | 'customizations'

  function draw() {
    const gems = state.gems || [];
    const cust = state.customizations || { rules: [], skills: [], mcpServers: [] };

    container.innerHTML = `
      <div class="hub-inner">
        <div class="hub-header">
          <div>
            <h2 class="hub-title">Gems, Deep Research &amp; Antigravity Skills</h2>
            <p class="hub-subtitle">Customize AI personas (Gems), launch autonomous multi-source web research, and configure Antigravity Rules, Skills &amp; MCP.</p>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="mini-pill more-tab ${subTab === 'gems' ? 'active' : ''}" data-t="gems" style="padding:6px 14px;font-size:12.5px;">💎 Gems</button>
            <button class="mini-pill more-tab ${subTab === 'research' ? 'active' : ''}" data-t="research" style="padding:6px 14px;font-size:12.5px;">🌐 Deep Research</button>
            <button class="mini-pill more-tab ${subTab === 'customizations' ? 'active' : ''}" data-t="customizations" style="padding:6px 14px;font-size:12.5px;">⚙️ Skills, Rules &amp; MCP</button>
          </div>
        </div>

        <div id="more-subcontent"></div>
      </div>
    `;

    const sub = container.querySelector('#more-subcontent');
    container.querySelectorAll('.more-tab').forEach((b) => {
      b.addEventListener('click', () => {
        subTab = b.dataset.t;
        draw();
      });
    });

    if (subTab === 'gems') {
      sub.innerHTML = `
        <div class="hub-card" style="margin-bottom:20px;">
          <strong>+ Create Custom Gem</strong>
          <div style="display:grid;grid-template-columns:70px 1fr 1fr;gap:10px;">
            <input id="gem-icon" class="input-field" value="✨" placeholder="Emoji" />
            <input id="gem-name" class="input-field" placeholder="Gem Name (e.g. Rust Systems Guru)" />
            <input id="gem-desc" class="input-field" placeholder="Short description" />
          </div>
          <textarea id="gem-inst" class="textarea-field" rows="2" placeholder="System persona instructions..."></textarea>
          <div><button id="save-gem-btn" class="btn-primary">Create Gem</button></div>
        </div>

        <div class="card-grid">
          ${gems
            .map(
              (g) => `
            <div class="hub-card">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:24px;width:40px;height:40px;border-radius:12px;background:${escapeHtml(g.color || '#dbeafe')};display:inline-flex;align-items:center;justify-content:center;">${escapeHtml(g.icon)}</span>
                <div>
                  <strong style="font-size:15px;">${escapeHtml(g.name)}</strong>
                  <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(g.description)}</div>
                </div>
              </div>
              <div style="font-size:12px;color:var(--text-secondary);flex:1;">${escapeHtml((g.instructions || '').slice(0, 140))}...</div>
              <div style="display:flex;gap:8px;">
                <button class="btn-primary use-gem-btn" data-id="${escapeHtml(g.id)}" style="padding:6px 14px;font-size:12px;">Use Gem</button>
                ${g.id.startsWith('gem-') && !['gem-antigravity-architect', 'gem-coding-partner', 'gem-brainstormer', 'gem-learning-coach', 'gem-writing-editor'].includes(g.id)
                  ? `<button class="btn-secondary del-gem-btn" data-id="${escapeHtml(g.id)}" style="padding:6px 12px;font-size:12px;">Delete</button>`
                  : ''}
              </div>
            </div>`
            )
            .join('')}
        </div>
      `;

      sub.querySelector('#save-gem-btn')?.addEventListener('click', async () => {
        const name = sub.querySelector('#gem-name').value.trim();
        const instructions = sub.querySelector('#gem-inst').value.trim();
        if (!name || !instructions) return toast('Provide Gem name and instructions');
        const created = await apiPost('/api/gems', {
          icon: sub.querySelector('#gem-icon').value.trim() || '✨',
          name,
          description: sub.querySelector('#gem-desc').value.trim(),
          instructions
        });
        state.gems.unshift(created);
        toast(`Gem "${name}" created!`);
        draw();
      });

      sub.querySelectorAll('.use-gem-btn').forEach((b) => {
        b.addEventListener('click', () => {
          app.activateGem(b.dataset.id);
          app.showChatStage(true);
        });
      });

      sub.querySelectorAll('.del-gem-btn').forEach((b) => {
        b.addEventListener('click', async () => {
          await apiDelete(`/api/gems/${encodeURIComponent(b.dataset.id)}`);
          state.gems = state.gems.filter((x) => x.id !== b.dataset.id);
          draw();
        });
      });
    } else if (subTab === 'research') {
      sub.innerHTML = `
        <div class="hub-card" style="padding:24px;">
          <h3 style="margin:0 0 6px;">🌐 Autonomous Deep Research</h3>
          <p style="margin:0 0 14px;font-size:13.5px;color:var(--text-muted);">OpenGemini decomposes your topic into multiple search angles, browses live web sources, extracts full page text, and synthesizes a comprehensive cited Markdown report into Canvas &amp; Library.</p>
          <textarea id="dr-query-input" class="textarea-field" rows="3" placeholder="e.g., Compare Qwen 3, Gemma 3, and Llama 4 architectures for local coding agents on consumer GPUs..."></textarea>
          <div style="margin-top:10px;">
            <button id="dr-launch-btn" class="btn-primary">Start Deep Research</button>
          </div>
        </div>
      `;
      sub.querySelector('#dr-launch-btn')?.addEventListener('click', () => {
        const q = sub.querySelector('#dr-query-input').value.trim();
        if (!q) return toast('Enter a research question');
        app.startDeepResearchInChat(q);
      });
    } else {
      sub.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="hub-card">
            <strong>📏 Rules (GEMINI.md &amp; Global Guidelines)</strong>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(cust.rules || [])
                .map(
                  (r) => `
                <div style="padding:8px 10px;border:1px solid var(--border-subtle);border-radius:10px;">
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;">
                    <span>${escapeHtml(r.name)}</span>
                    <span class="cap-badge">${escapeHtml(r.scope)}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${escapeHtml(r.content.slice(0, 160))}</div>
                </div>`
                )
                .join('')}
            </div>
            <input id="new-rule-name" class="input-field" placeholder="New Rule Title" />
            <textarea id="new-rule-body" class="textarea-field" rows="2" placeholder="Always-on rule instructions..."></textarea>
            <button id="add-rule-btn" class="btn-secondary">Add Global Rule</button>
          </div>

          <div class="hub-card">
            <strong>🛠️ Antigravity Skills (SKILL.md) &amp; MCP</strong>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${(cust.skills || [])
                .map(
                  (s) => `
                <div style="padding:8px 10px;border:1px solid var(--border-subtle);border-radius:10px;">
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;">
                    <span>⚡ ${escapeHtml(s.name)}</span>
                    <span class="cap-badge green">Active</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${escapeHtml(s.description)}</div>
                </div>`
                )
                .join('')}
              ${(cust.mcpServers || [])
                .map(
                  (m) => `
                <div style="padding:8px 10px;border:1px solid var(--border-subtle);border-radius:10px;">
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;">
                    <span>🔌 MCP: ${escapeHtml(m.name)}</span>
                    <span class="cap-badge green">${escapeHtml(m.status)}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(m.description)}</div>
                </div>`
                )
                .join('')}
            </div>
            <input id="new-skill-name" class="input-field" placeholder="New Skill Name (e.g. unit-test-writer)" />
            <textarea id="new-skill-body" class="textarea-field" rows="2" placeholder="Skill workflow procedure..."></textarea>
            <button id="add-skill-btn" class="btn-secondary">Add Skill</button>
          </div>
        </div>
      `;

      sub.querySelector('#add-rule-btn')?.addEventListener('click', async () => {
        const name = sub.querySelector('#new-rule-name').value.trim();
        const content = sub.querySelector('#new-rule-body').value.trim();
        if (!name || !content) return;
        const rules = [...(cust.rules || []), { id: `rule-${Date.now()}`, name, scope: 'global', trigger: 'always_on', enabled: true, content }];
        state.customizations = await apiPost('/api/customizations', { ...cust, rules });
        toast('Rule added!');
        draw();
      });

      sub.querySelector('#add-skill-btn')?.addEventListener('click', async () => {
        const name = sub.querySelector('#new-skill-name').value.trim();
        const content = sub.querySelector('#new-skill-body').value.trim();
        if (!name || !content) return;
        const skills = [...(cust.skills || []), { id: `skill-${Date.now()}`, name, description: content.slice(0, 75), enabled: true, content }];
        state.customizations = await apiPost('/api/customizations', { ...cust, skills });
        toast('Skill added!');
        draw();
      });
    }
  }

  draw();
}
