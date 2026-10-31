const express = require('express');
const cors = require('cors');
const path = require('path');
const fsp = require('fs/promises');

const storage = require('./services/storage');
const { discoverModels, streamChatCompletion, safeJsonParse } = require('./services/llm');
const {
  buildSystemContext,
  runAutonomousTask,
  runDeepResearch,
  resolveApproval,
  cancelActiveRun,
  startBackgroundScheduler,
  executeScheduledItem
} = require('./services/agent');
const {
  resolveWorkspacePath,
  runShellCommand,
  fetchReadableUrl
} = require('./services/tools');
const {
  getImageStatus,
  setupQwen,
  generateQwenLocal,
  generateNanoBanana,
  GENERATED_DIR
} = require('./services/imagegen');
const { CLOUD_CATALOG, RECOMMENDED_LOCAL } = require('./services/catalog');

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/generated', express.static(GENERATED_DIR));

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  return (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
}

// 1. Bootstrap endpoint for fast single-roundtrip initial load
app.get('/api/bootstrap', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    const [
      discovery,
      chats,
      notebooks,
      artifacts,
      images,
      scheduled,
      gems,
      customizations,
      imageStatus
    ] = await Promise.all([
      discoverModels(settings),
      storage.getChats(),
      storage.getNotebooks(),
      storage.getArtifacts(),
      storage.getImages(),
      storage.getScheduled(),
      storage.getGems(),
      storage.getCustomizations(settings.workspacePath),
      getImageStatus(settings).catch(() => null)
    ]);

    res.json({
      settings,
      models: discovery.models,
      providerStatus: discovery.providerStatus,
      imageStatus,
      chats,
      notebooks,
      artifacts,
      images,
      scheduled,
      gems,
      customizations
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Models discovery
app.get('/api/models', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    const discovery = await discoverModels(settings);
    res.json(discovery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Settings
app.get('/api/settings', async (req, res) => {
  res.json(await storage.getSettings());
});

app.post('/api/settings', async (req, res) => {
  try {
    const updated = await storage.saveSettings(req.body || {});
    const discovery = await discoverModels(updated);
    res.json({ settings: updated, ...discovery });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Chats CRUD
app.get('/api/chats', async (req, res) => {
  res.json(await storage.getChats());
});

app.post('/api/chats', async (req, res) => {
  try {
    const saved = await storage.upsertChat(req.body);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats/:id', async (req, res) => {
  await storage.deleteChat(req.params.id);
  res.json({ ok: true });
});

// 5. Chat Mode SSE Streaming
app.post('/api/chat/stream', async (req, res) => {
  const send = initSse(res);
  const {
    runId = `run-${Date.now()}`,
    chatId,
    messages = [],
    provider,
    model,
    thinkingEffort,
    gemId,
    notebookId,
    temporary = false
  } = req.body || {};

  try {
    const settings = await storage.getSettings();
    const systemPrompt = await buildSystemContext({
      mode: 'chat',
      settings,
      gemId,
      notebookId
    });

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content || '',
        images: m.images
      }))
    ];

    send('chat_start', { runId, chatId });

    let thinking = '';
    let content = '';

    const out = await streamChatCompletion({
      provider: provider || settings.selectedProvider,
      model: model || settings.selectedModel,
      thinkingEffort: thinkingEffort ?? settings.thinkingEffort,
      messages: fullMessages,
      settings,
      onThinking: (delta) => {
        thinking += delta;
        send('thinking_delta', { delta });
      },
      onContent: (delta) => {
        content += delta;
        send('content_delta', { delta });
      }
    });

    thinking = out.thinking || thinking;
    content = out.content || content;

    if (!temporary && chatId) {
      const chats = await storage.getChats();
      const existing = chats.find((c) => c.id === chatId);
      const firstUser = messages.find((m) => m.role === 'user')?.content || 'New chat';
      const title = existing?.title && existing.title !== 'New chat'
        ? existing.title
        : firstUser.replace(/\s+/g, ' ').trim().slice(0, 48);

      const updatedMessages = [
        ...messages,
        {
          role: 'assistant',
          content,
          thinking,
          createdAt: new Date().toISOString()
        }
      ];

      await storage.upsertChat({
        id: chatId,
        title,
        mode: 'chat',
        pinned: existing?.pinned || false,
        gemId: gemId || existing?.gemId || null,
        notebookId: notebookId || existing?.notebookId || null,
        messages: updatedMessages,
        updatedAt: new Date().toISOString()
      });
    }

    send('chat_complete', { runId, chatId, content, thinking });
    res.end();
  } catch (err) {
    send('error', { message: err.message || String(err) });
    res.end();
  }
});

// 6. Autonomous Task Mode SSE Streaming
app.post('/api/task/stream', async (req, res) => {
  const send = initSse(res);
  const {
    runId = `task-${Date.now()}`,
    chatId,
    messages = [],
    provider,
    model,
    thinkingEffort,
    gemId,
    notebookId,
    temporary = false
  } = req.body || {};

  try {
    const settings = await storage.getSettings();
    const result = await runAutonomousTask({
      runId,
      chatId,
      messages,
      provider: provider || settings.selectedProvider,
      model: model || settings.selectedModel,
      thinkingEffort: thinkingEffort ?? settings.thinkingEffort,
      gemId,
      notebookId,
      settings,
      emit: (event, payload) => send(event, payload)
    });

    if (!temporary && chatId) {
      const chats = await storage.getChats();
      const existing = chats.find((c) => c.id === chatId);
      const firstUser = messages.find((m) => m.role === 'user')?.content || 'New task';
      const title = existing?.title && existing.title !== 'New chat'
        ? existing.title
        : firstUser.replace(/\s+/g, ' ').trim().slice(0, 48);

      const updatedMessages = [
        ...messages,
        {
          role: 'assistant',
          mode: 'task',
          content: result.finalAnswer,
          thinking: result.thinking,
          taskState: result.taskState,
          artifactId: result.artifacts?.[0]?.id || null,
          artifacts: (result.artifacts || []).map((a) => ({ id: a.id, title: a.title, type: a.type })),
          createdAt: new Date().toISOString()
        }
      ];

      await storage.upsertChat({
        id: chatId,
        title,
        mode: 'task',
        pinned: existing?.pinned || false,
        gemId: gemId || existing?.gemId || null,
        notebookId: notebookId || existing?.notebookId || null,
        messages: updatedMessages,
        taskState: result.taskState,
        filesChanged: result.filesChanged,
        updatedAt: new Date().toISOString()
      });
    }

    res.end();
  } catch (err) {
    send('error', { message: err.message || String(err) });
    res.end();
  }
});

// 7. Task Approval & Cancellation
app.post('/api/task/approve', (req, res) => {
  const { approvalId, approved } = req.body || {};
  const ok = resolveApproval(approvalId, approved);
  res.json({ ok });
});

app.post('/api/task/cancel', (req, res) => {
  const { runId } = req.body || {};
  const ok = cancelActiveRun(runId);
  res.json({ ok });
});

// 8. Deep Research SSE Streaming
app.post('/api/research/stream', async (req, res) => {
  const send = initSse(res);
  const {
    runId = `res-${Date.now()}`,
    query,
    chatId,
    provider,
    model
  } = req.body || {};

  try {
    const settings = await storage.getSettings();
    await runDeepResearch({
      runId,
      query,
      chatId,
      provider: provider || settings.selectedProvider,
      model: model || settings.selectedModel,
      settings,
      emit: (ev, payload) => send(ev, payload)
    });
    res.end();
  } catch (err) {
    send('error', { message: err.message || String(err) });
    res.end();
  }
});

// 9. Artifacts & Canvas Refinement
app.get('/api/artifacts', async (req, res) => {
  res.json(await storage.getArtifacts());
});

app.get('/api/artifacts/:id', async (req, res) => {
  const item = await storage.getArtifactWithContent(req.params.id);
  if (!item) return res.status(404).json({ error: 'Artifact not found' });
  res.json(item);
});

app.post('/api/artifacts', async (req, res) => {
  try {
    const saved = await storage.saveArtifact(req.body || {});
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/artifacts/:id', async (req, res) => {
  await storage.deleteArtifact(req.params.id);
  res.json({ ok: true });
});

app.post('/api/canvas/refine', async (req, res) => {
  try {
    const { content, instruction, type = 'html' } = req.body || {};
    const settings = await storage.getSettings();
    const out = await streamChatCompletion({
      provider: settings.selectedProvider,
      model: settings.selectedModel,
      thinkingEffort: 'low',
      settings,
      messages: [
        {
          role: 'system',
          content: `You are OpenGemini Canvas Editor. Modify the provided ${type} document/code according to the user's instruction. Return ONLY the complete updated ${type} content without surrounding commentary or markdown code fences.`
        },
        {
          role: 'user',
          content: `Instruction: ${instruction}\n\nCurrent Content:\n${content}`
        }
      ]
    });

    let updated = (out.content || '').trim();
    const fence = updated.match(/^```[a-z]*\s*([\s\S]*?)```$/i);
    if (fence) updated = fence[1].trim();
    res.json({ content: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Notebooks (NotebookLM in Gemini)
app.get('/api/notebooks', async (req, res) => {
  res.json(await storage.getNotebooks());
});

app.post('/api/notebooks', async (req, res) => {
  try {
    const notebooks = await storage.getNotebooks();
    const body = req.body || {};
    const id = body.id || `nb-${Date.now()}`;
    const idx = notebooks.findIndex((n) => n.id === id);

    // If adding a URL source, fetch its readable content automatically
    if (Array.isArray(body.sources)) {
      for (const src of body.sources) {
        if (src.type === 'url' && src.url && !src.content) {
          try {
            const page = await fetchReadableUrl(src.url);
            src.title = src.title || page.title;
            src.content = page.text;
          } catch (e) {
            src.content = `Could not fetch URL automatically (${e.message}).`;
          }
        }
      }
    }

    const record = {
      ...(idx >= 0 ? notebooks[idx] : {}),
      ...body,
      id,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) notebooks[idx] = record;
    else notebooks.unshift(record);
    await storage.saveNotebooks(notebooks);
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notebooks/:id', async (req, res) => {
  const notebooks = await storage.getNotebooks();
  await storage.saveNotebooks(notebooks.filter((n) => n.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/notebooks/:id/generate', async (req, res) => {
  try {
    const { action = 'studyGuide' } = req.body || {};
    const notebooks = await storage.getNotebooks();
    const nb = notebooks.find((n) => n.id === req.params.id);
    if (!nb) return res.status(404).json({ error: 'Notebook not found' });

    const settings = await storage.getSettings();
    const sourcesText = (nb.sources || [])
      .map((s, i) => `Source ${i + 1} (${s.title}):\n${(s.content || '').slice(0, 4500)}`)
      .join('\n\n');

    let systemPrompt = '';
    if (action === 'studyGuide') {
      systemPrompt = 'Create a comprehensive Markdown Study Guide & Executive Briefing grounded strictly in the provided notebook sources. Include Key Concepts, Detailed Breakdown, Glossary, and Critical Questions.';
    } else if (action === 'flashcards') {
      systemPrompt = 'Return ONLY a JSON array of 6 study flashcards grounded in the sources. Format: [{"front": "Question or term", "back": "Concise answer"}]';
    } else if (action === 'audioOverview') {
      systemPrompt = 'Write a lively, natural 2-host Deep Dive Podcast script (Host A "Alex" and Host B "Maya", 8-10 dialogue turns) unpacking the most fascinating insights in these notebook sources. Return ONLY a JSON array: [{"speaker": "Alex", "text": "..."}, {"speaker": "Maya", "text": "..."}]';
    }

    const resp = await streamChatCompletion({
      provider: settings.selectedProvider,
      model: settings.selectedModel,
      thinkingEffort: 'low',
      settings,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Notebook Title: ${nb.title}\nInstructions: ${nb.instructions || ''}\n\n${sourcesText || nb.notes || nb.description || 'General topic: ' + nb.title}` }
      ]
    });

    const raw = (resp.content || '').trim();
    if (action === 'studyGuide') {
      nb.studyGuide = raw;
    } else if (action === 'flashcards') {
      const m = raw.match(/\[[\s\S]*\]/);
      nb.flashcards = m ? safeJsonParse(m[0], []) : [];
    } else if (action === 'audioOverview') {
      const m = raw.match(/\[[\s\S]*\]/);
      nb.audioScript = m ? safeJsonParse(m[0], []) : [
        { speaker: 'Alex', text: raw.slice(0, 500) }
      ];
    }

    nb.updatedAt = new Date().toISOString();
    await storage.saveNotebooks(notebooks);
    res.json(nb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Images Studio (Qwen 2.1 Image Uncensored local, Nano Banana 2.1 API, SVG-LLM fallback)
app.get('/api/images', async (req, res) => {
  res.json(await storage.getImages());
});

app.get('/api/images/status', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    const status = await getImageStatus(settings);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/images/setup', async (req, res) => {
  const send = initSse(res);
  try {
    const settings = await storage.getSettings();
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    await setupQwen(settings, (progress) => {
      send('progress', progress);
    }, abortController.signal);

    const finalStatus = await getImageStatus(settings);
    send('done', { ok: true, status: finalStatus });
    res.end();
  } catch (err) {
    send('error', { error: err.message });
    res.end();
  }
});

app.post('/api/images/generate', async (req, res) => {
  try {
    const {
      prompt,
      provider: reqProvider,
      aspectRatio = '1:1',
      imageSize = '1K',
      style = 'vivid',
      referenceImage,
      previousSvg = '',
      seed
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const settings = await storage.getSettings();
    const imgProvider = reqProvider || settings.imageProvider || 'qwen-image-local';

    let imageRecord;

    if (imgProvider === 'qwen-image-local') {
      imageRecord = await generateQwenLocal({
        prompt,
        aspectRatio,
        style,
        seed
      }, settings);
    } else if (imgProvider === 'nano-banana') {
      imageRecord = await generateNanoBanana({
        prompt,
        aspectRatio,
        imageSize,
        referenceImage
      }, settings);
    } else if (imgProvider === 'pollinations') {
      const rndSeed = seed || Math.floor(Math.random() * 1000000);
      const dims = {
        '1:1': [1024, 1024],
        '16:9': [1280, 720],
        '9:16': [720, 1280],
        '4:3': [1024, 768],
        '3:4': [768, 1024]
      }[aspectRatio] || [1024, 1024];
      imageRecord = {
        id: `img-${Date.now()}`,
        prompt,
        provider: 'pollinations',
        model: 'Pollinations Flux',
        imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', ' + style)}?width=${dims[0]}&height=${dims[1]}&seed=${rndSeed}&nologo=true`,
        aspectRatio,
        createdAt: new Date().toISOString()
      };
    } else if (imgProvider === 'openai' && settings.openaiApiKey) {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: aspectRatio === '16:9' ? '1792x1024' : aspectRatio === '9:16' ? '1024x1792' : '1024x1024'
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'OpenAI image generation failed');
      imageRecord = {
        id: `img-${Date.now()}`,
        prompt,
        provider: 'openai',
        model: 'DALL-E 3',
        imageUrl: data.data?.[0]?.url,
        caption: data.data?.[0]?.revised_prompt,
        aspectRatio,
        createdAt: new Date().toISOString()
      };
    } else if (imgProvider === 'sd-webui') {
      const sdBase = (settings.sdWebUiUrl || 'http://127.0.0.1:7860').replace(/\/+$/, '');
      const r = await fetch(`${sdBase}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, steps: 22, width: 768, height: 512 })
      });
      if (!r.ok) throw new Error('Local Stable Diffusion WebUI not reachable at ' + sdBase);
      const data = await r.json();
      imageRecord = {
        id: `img-${Date.now()}`,
        prompt,
        provider: 'sd-webui',
        model: 'Local SD WebUI',
        imageUrl: `data:image/png;base64,${data.images[0]}`,
        aspectRatio,
        createdAt: new Date().toISOString()
      };
    } else {
      // Local AI Vector Art Studio fallback
      const resp = await streamChatCompletion({
        provider: settings.selectedProvider,
        model: settings.selectedModel,
        thinkingEffort: 'low',
        settings,
        messages: [
          {
            role: 'system',
            content: `You are an expert digital illustrator & SVG artist. Generate ONLY a rich, artistic, layered <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">...</svg> artwork with smooth gradients, lighting, composition, and detail matching the prompt (${style} aesthetic). Output ONLY valid <svg>...</svg> markup with no markdown commentary.`
          },
          {
            role: 'user',
            content: previousSvg
              ? `Modify this existing SVG according to: "${prompt}"\n\nExisting SVG:\n${previousSvg}`
              : `Create an illustration for: ${prompt}`
          }
        ]
      });

      const svgMatch = (resp.content || '').match(/<svg[\s\S]*?<\/svg>/i);
      imageRecord = {
        id: `img-${Date.now()}`,
        prompt,
        provider: 'svg-llm',
        model: settings.selectedModel || 'Local LLM SVG',
        svgContent: svgMatch
          ? svgMatch[0]
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#eff6ff"/><text x="400" y="250" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#1e3a8a">${prompt.replace(/[<>&]/g, '')}</text></svg>`,
        aspectRatio,
        createdAt: new Date().toISOString()
      };
    }

    const images = await storage.getImages();
    images.unshift(imageRecord);
    await storage.saveImages(images);
    res.json(imageRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/images/:id', async (req, res) => {
  const images = await storage.getImages();
  await storage.saveImages(images.filter((i) => i.id !== req.params.id));
  res.json({ ok: true });
});

// 12. Scheduled Tasks Hub
app.get('/api/scheduled', async (req, res) => {
  res.json(await storage.getScheduled());
});

app.post('/api/scheduled', async (req, res) => {
  const items = await storage.getScheduled();
  const body = req.body || {};
  const id = body.id || `sched-${Date.now()}`;
  const idx = items.findIndex((i) => i.id === id);
  const record = {
    id,
    title: body.title || 'Scheduled Check',
    prompt: body.prompt || '',
    intervalMinutes: Math.max(1, Number(body.intervalMinutes) || 60),
    cronExpression: body.cronExpression || '0 * * * *',
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
    lastRun: idx >= 0 ? items[idx].lastRun : null,
    lastStatus: idx >= 0 ? items[idx].lastStatus : 'pending',
    logs: idx >= 0 ? items[idx].logs : []
  };
  if (idx >= 0) items[idx] = record;
  else items.unshift(record);
  await storage.saveScheduled(items);
  res.json(record);
});

app.post('/api/scheduled/:id/run', async (req, res) => {
  try {
    const items = await storage.getScheduled();
    const task = items.find((i) => i.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Scheduled task not found' });
    await executeScheduledItem(task);
    await storage.saveScheduled(items);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scheduled/:id', async (req, res) => {
  const items = await storage.getScheduled();
  await storage.saveScheduled(items.filter((i) => i.id !== req.params.id));
  res.json({ ok: true });
});

// 13. Students Hub (Adaptive Quizzes, Flashcards, Guided Study Plan)
app.post('/api/students/generate', async (req, res) => {
  try {
    const { topic, toolType = 'quiz', difficulty = 'intermediate' } = req.body || {};
    const settings = await storage.getSettings();

    let systemPrompt = '';
    if (toolType === 'quiz') {
      systemPrompt = `Generate a 5-question multiple-choice practice quiz on the user's topic (${difficulty} level). Return ONLY valid JSON:
[{"question": "...", "options": ["Option A", "Option B", "Option C", "Option D"], "correctIndex": 0, "hint": "...", "explanation": "..."}]`;
    } else if (toolType === 'flashcards') {
      systemPrompt = `Generate 8 high-yield study flashcards on the user's topic (${difficulty} level). Return ONLY valid JSON:
[{"front": "Concept or question", "back": "Clear memorable answer"}]`;
    } else {
      systemPrompt = `Create an interactive, structured Markdown Exam Prep & Guided Study Breakdown for the topic (${difficulty} level), including mental models, worked examples, common pitfalls, and self-check exercises.`;
    }

    const resp = await streamChatCompletion({
      provider: settings.selectedProvider,
      model: settings.selectedModel,
      thinkingEffort: 'low',
      settings,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: topic }
      ]
    });

    const raw = (resp.content || '').trim();
    if (toolType === 'quiz' || toolType === 'flashcards') {
      const m = raw.match(/\[[\s\S]*\]/);
      const items = m ? safeJsonParse(m[0], []) : [];
      res.json({ toolType, topic, items, raw });
    } else {
      res.json({ toolType, topic, markdown: raw });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Gems & Antigravity Customizations
app.get('/api/gems', async (req, res) => {
  res.json(await storage.getGems());
});

app.post('/api/gems', async (req, res) => {
  const gems = await storage.getGems();
  const body = req.body || {};
  const id = body.id || `gem-${Date.now()}`;
  const idx = gems.findIndex((g) => g.id === id);
  const record = {
    id,
    name: body.name || 'Custom Gem',
    icon: body.icon || '✨',
    color: body.color || '#dbeafe',
    description: body.description || '',
    instructions: body.instructions || ''
  };
  if (idx >= 0) gems[idx] = record;
  else gems.unshift(record);
  await storage.saveGems(gems);
  res.json(record);
});

app.delete('/api/gems/:id', async (req, res) => {
  const gems = await storage.getGems();
  await storage.saveGems(gems.filter((g) => g.id !== req.params.id));
  res.json({ ok: true });
});

app.get('/api/customizations', async (req, res) => {
  const settings = await storage.getSettings();
  res.json(await storage.getCustomizations(settings.workspacePath));
});

app.post('/api/customizations', async (req, res) => {
  const settings = await storage.getSettings();
  await storage.saveCustomizations(req.body || {});
  res.json(await storage.getCustomizations(settings.workspacePath));
});

// 15. Workspace Explorer & Interactive Auxiliary Terminal
app.get('/api/workspace/files', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    const target = resolveWorkspacePath(req.query.dir || '.', settings);
    const entries = await fsp.readdir(target, { withFileTypes: true });
    const list = entries
      .filter((e) => !['node_modules', '.git'].includes(e.name))
      .slice(0, 150)
      .map((e) => ({
        name: e.name,
        path: path.join(target, e.name),
        relativePath: path.relative(settings.workspacePath, path.join(target, e.name)),
        type: e.isDirectory() ? 'directory' : 'file'
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    res.json({ workspacePath: settings.workspacePath, currentDir: target, items: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspace/file', async (req, res) => {
  try {
    const settings = await storage.getSettings();
    const target = resolveWorkspacePath(req.query.path, settings);
    const content = await fsp.readFile(target, 'utf8');
    res.json({ path: target, name: path.basename(target), content: content.slice(0, 50000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspace/terminal', async (req, res) => {
  try {
    const { command } = req.body || {};
    const settings = await storage.getSettings();
    const cwd = resolveWorkspacePath('.', settings);
    const out = await runShellCommand(command, cwd, settings.terminalShell);
    res.json({ ...out, cwd, command, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const DEFAULT_PORT = Number(process.env.PORT) || 3456;

function startServer(port, attempts = 0) {
  const srv = app.listen(port, () => {
    console.log(`\n✨ OpenGemini 2.0 running at http://localhost:${port}`);
    startBackgroundScheduler();
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 15) {
      startServer(port + 1, attempts + 1);
    } else {
      console.error(err);
    }
  });
}

startServer(DEFAULT_PORT);
