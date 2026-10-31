const storage = require('./storage');
const { streamChatCompletion, safeJsonParse } = require('./llm');
const {
  AGENT_TOOLS_SCHEMA,
  executeAgentTool,
  performWebSearch,
  fetchReadableUrl
} = require('./tools');

const pendingApprovals = new Map();
const activeTaskControllers = new Map();

function resolveApproval(approvalId, approved) {
  const entry = pendingApprovals.get(approvalId);
  if (!entry) return false;
  pendingApprovals.delete(approvalId);
  entry.resolve(Boolean(approved));
  return true;
}

function cancelActiveRun(runId) {
  const ctrl = activeTaskControllers.get(runId);
  if (ctrl) {
    ctrl.abort();
    activeTaskControllers.delete(runId);
    return true;
  }
  return false;
}

/**
 * Fallback parser for models that emit <tool_call>{...}</tool_call> or ```tool_call ... ``` in content
 */
function extractInlineToolCalls(text = '') {
  const calls = [];
  let cleanedText = text;

  const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match;
  while ((match = xmlRegex.exec(text)) !== null) {
    const parsed = safeJsonParse(match[1].trim(), null);
    if (parsed && parsed.name) {
      calls.push({
        id: `call_inline_${Date.now()}_${calls.length}`,
        type: 'function',
        function: {
          name: parsed.name,
          arguments: JSON.stringify(parsed.arguments || parsed.args || {})
        }
      });
      cleanedText = cleanedText.replace(match[0], '').trim();
    }
  }

  const fenceRegex = /```tool_call\s*([\s\S]*?)```/gi;
  while ((match = fenceRegex.exec(text)) !== null) {
    const parsed = safeJsonParse(match[1].trim(), null);
    if (parsed && parsed.name) {
      calls.push({
        id: `call_fence_${Date.now()}_${calls.length}`,
        type: 'function',
        function: {
          name: parsed.name,
          arguments: JSON.stringify(parsed.arguments || parsed.args || {})
        }
      });
      cleanedText = cleanedText.replace(match[0], '').trim();
    }
  }

  return { calls, cleanedText };
}

async function buildSystemContext({ mode, settings, gemId, notebookId }) {
  const sections = [];

  if (mode === 'task') {
    sections.push(
      `You are OpenGemini operating in autonomous **Task Mode** (combining Google Gemini Task Mode and Google Antigravity 2.0 agentic execution).`,
      `Workspace Root: ${settings.workspacePath}`,
      `Operating System: ${process.platform}`,
      `Current Time: ${new Date().toISOString()}`,
      `\n### Task Mode Guidelines:
1. Break complex goals into clear steps using \`update_plan\` right away and update step statuses (\`in_progress\` -> \`completed\`) as you progress.
2. Actively use workspace tools (\`list_files\`, \`read_file\`, \`write_file\`, \`edit_file\`, \`search_files\`, \`run_command\`), web tools (\`web_search\`, \`fetch_url\`), subagents (\`spawn_subagent\`), and \`create_artifact\` to accomplish the user's goal thoroughly.
3. Whenever the user asks for an interactive app, game, dashboard, diagram, or structured report/plan, call \`create_artifact\` with complete, self-contained HTML/CSS/JS, SVG, or Markdown so it renders live in the Canvas pane.
4. If a tool fails, inspect the error and adapt rather than giving up. Once all steps are verified complete, present a concise, well-formatted summary.`
    );
  } else {
    sections.push(
      `You are OpenGemini, a fast, thoughtful AI assistant with Google Gemini's clarity and Antigravity's engineering depth.`,
      `Format responses cleanly in GitHub-flavored Markdown. Use code blocks with language tags for code.`
    );
  }

  // Active Gem persona
  if (gemId) {
    const gems = await storage.getGems();
    const gem = gems.find((g) => g.id === gemId);
    if (gem) {
      sections.push(`\n### Active Gem Persona: ${gem.name}\n${gem.instructions}`);
    }
  }

  // Active Notebook grounded sources
  if (notebookId) {
    const notebooks = await storage.getNotebooks();
    const nb = notebooks.find((n) => n.id === notebookId);
    if (nb) {
      const sourceText = (nb.sources || [])
        .map((s, idx) => `[Source ${idx + 1}: ${s.title}]\n${(s.content || '').slice(0, 6000)}`)
        .join('\n\n');
      sections.push(
        `\n### Active Notebook Context: "${nb.title}"`,
        nb.instructions ? `Notebook Instructions: ${nb.instructions}` : '',
        sourceText ? `Grounded Sources:\n${sourceText}` : ''
      );
    }
  }

  // Active Rules & Skills (Antigravity Customizations)
  const customizations = await storage.getCustomizations(settings.workspacePath);
  const enabledRules = (customizations.rules || []).filter((r) => r.enabled);
  if (enabledRules.length > 0) {
    sections.push(
      `\n### Active Rules:\n` +
        enabledRules.map((r) => `- **${r.name}**: ${r.content}`).join('\n')
    );
  }

  const enabledSkills = (customizations.skills || []).filter((s) => s.enabled);
  if (enabledSkills.length > 0 && mode === 'task') {
    sections.push(
      `\n### Available Skills:\n` +
        enabledSkills.map((s) => `- **${s.name}**: ${s.description}\n  ${s.content}`).join('\n')
    );
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Run Autonomous Multi-Step Task Loop and emit granular SSE events
 */
async function runAutonomousTask({
  runId,
  chatId,
  messages,
  provider,
  model,
  thinkingEffort,
  gemId,
  notebookId,
  settings,
  emit
}) {
  const controller = new AbortController();
  activeTaskControllers.set(runId, controller);

  const systemPrompt = await buildSystemContext({
    mode: 'task',
    settings,
    gemId,
    notebookId
  });

  const workingMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content || '',
      images: m.images
    }))
  ];

  const maxSteps = Math.min(20, Math.max(2, Number(settings.maxTaskSteps) || 10));
  let plan = [];
  const stepLogs = [];
  const filesChanged = [];
  const artifactsCreated = [];
  const subagents = [];
  let aggregatedThinking = '';
  let finalAnswer = '';

  emit('task_init', {
    runId,
    chatId,
    maxSteps,
    workspacePath: settings.workspacePath
  });

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (controller.signal.aborted) throw new Error('Task cancelled by user.');

      emit('step_start', { step, maxSteps });

      let stepThinking = '';
      let stepContent = '';

      const result = await streamChatCompletion({
        provider,
        model,
        messages: workingMessages,
        tools: AGENT_TOOLS_SCHEMA,
        thinkingEffort,
        settings,
        signal: controller.signal,
        onThinking: (delta) => {
          stepThinking += delta;
          aggregatedThinking += delta;
          emit('thinking_delta', { step, delta });
        },
        onContent: (delta) => {
          stepContent += delta;
          emit('content_delta', { step, delta });
        }
      });

      let toolCalls = result.toolCalls || [];
      let cleanedContent = result.content || '';

      if (toolCalls.length === 0 && cleanedContent) {
        const inline = extractInlineToolCalls(cleanedContent);
        if (inline.calls.length > 0) {
          toolCalls = inline.calls;
          cleanedContent = inline.cleanedText;
        }
      }

      // If no tool calls were made, the agent has finished its final answer!
      if (toolCalls.length === 0) {
        finalAnswer = cleanedContent;

        // Auto-promote standalone HTML or SVG code block into an interactive Artifact if none created yet
        if (artifactsCreated.length === 0 && finalAnswer) {
          const htmlFence = finalAnswer.match(/```html\s*([\s\S]*?)```/i);
          const svgFence = finalAnswer.match(/```svg\s*([\s\S]*?)```/i);
          if (htmlFence && htmlFence[1].includes('<')) {
            const autoArtifact = await storage.saveArtifact({
              title: extractArtifactTitle(messages) || 'Interactive HTML Preview',
              type: 'html',
              description: 'Auto-extracted interactive HTML5 Canvas preview',
              content: htmlFence[1].trim(),
              chatId
            });
            artifactsCreated.push(autoArtifact);
            emit('artifact_created', autoArtifact);
          } else if (svgFence && svgFence[1].includes('<svg')) {
            const autoArtifact = await storage.saveArtifact({
              title: extractArtifactTitle(messages) || 'Generated SVG Graphic',
              type: 'svg',
              description: 'Auto-extracted vector graphic',
              content: svgFence[1].trim(),
              chatId
            });
            artifactsCreated.push(autoArtifact);
            emit('artifact_created', autoArtifact);
          }
        }

        // Mark any remaining in-progress plan steps as completed
        if (plan.length > 0) {
          plan = plan.map((p) => (p.status === 'in_progress' ? { ...p, status: 'completed' } : p));
          emit('plan_update', { steps: plan });
        }
        break;
      }

      // Record assistant message with tool calls into conversation history for next iteration
      workingMessages.push({
        role: 'assistant',
        content: cleanedContent || '',
        tool_calls: toolCalls
      });

      if (stepThinking) {
        aggregatedThinking += '\n\n';
      }

      // Execute each tool call sequentially or cleanly
      for (const tc of toolCalls) {
        if (controller.signal.aborted) throw new Error('Task cancelled by user.');

        const toolName = tc.function.name;
        const toolArgs = safeJsonParse(tc.function.arguments, {});
        const callId = tc.id || `call_${Date.now()}`;

        emit('tool_call', {
          step,
          callId,
          name: toolName,
          args: toolArgs
        });

        const startedAt = Date.now();
        let toolOutput;
        try {
          toolOutput = await executeAgentTool(toolName, toolArgs, {
            settings,
            chatId,
            onPlanUpdate: (steps) => {
              plan = steps;
              emit('plan_update', { steps });
            },
            onFileChanged: (change) => {
              const existingIdx = filesChanged.findIndex((f) => f.filePath === change.filePath);
              if (existingIdx >= 0) filesChanged[existingIdx] = change;
              else filesChanged.push(change);
              emit('file_changed', change);
            },
            onArtifactCreated: (artifact) => {
              artifactsCreated.push(artifact);
              emit('artifact_created', artifact);
            },
            onTerminalOutput: (termEntry) => {
              emit('terminal_output', termEntry);
            },
            onSubagentAction: async (role, subPrompt) => {
              const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
              const subRecord = { id: subId, role, prompt: subPrompt, status: 'running', summary: '' };
              subagents.push(subRecord);
              emit('subagent_update', subRecord);

              const subRes = await streamChatCompletion({
                provider,
                model,
                thinkingEffort: 'low',
                settings,
                signal: controller.signal,
                messages: [
                  {
                    role: 'system',
                    content: `You are an autonomous subagent with role: "${role}". Fulfill the delegated prompt concisely and accurately.`
                  },
                  { role: 'user', content: subPrompt }
                ]
              });
              subRecord.status = 'completed';
              subRecord.summary = (subRes.content || '').slice(0, 3000);
              emit('subagent_update', subRecord);
              return { role, status: 'completed', findings: subRecord.summary };
            },
            requestApproval: async (details) => {
              const approvalId = `apr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              emit('approval_required', { approvalId, ...details });
              return new Promise((resolve) => {
                pendingApprovals.set(approvalId, { resolve });
                controller.signal.addEventListener('abort', () => {
                  if (pendingApprovals.has(approvalId)) {
                    pendingApprovals.delete(approvalId);
                    resolve(false);
                  }
                });
              });
            }
          });
        } catch (err) {
          toolOutput = { error: err.message || String(err) };
        }

        const durationMs = Date.now() - startedAt;
        const stepEntry = {
          step,
          callId,
          name: toolName,
          args: toolArgs,
          result: toolOutput,
          durationMs
        };
        stepLogs.push(stepEntry);

        emit('tool_result', stepEntry);

        workingMessages.push({
          role: 'tool',
          tool_call_id: callId,
          name: toolName,
          content: JSON.stringify(toolOutput).slice(0, 10000)
        });
      }

      // If we hit maxSteps and haven't synthesized final answer yet, run a final synthesis turn without tools
      if (step === maxSteps) {
        emit('step_start', { step: step + 1, maxSteps: step + 1, synthesizing: true });
        workingMessages.push({
          role: 'user',
          content: 'Synthesize a clear final summary of everything accomplished and findings so far.'
        });
        const synth = await streamChatCompletion({
          provider,
          model,
          messages: workingMessages,
          thinkingEffort: 'low',
          settings,
          signal: controller.signal,
          onContent: (delta) => emit('content_delta', { step: step + 1, delta, finalSynthesis: true })
        });
        finalAnswer = synth.content || 'Task execution completed.';
      }
    }

    const taskState = {
      status: 'completed',
      plan,
      steps: stepLogs,
      subagents,
      filesChangedCount: filesChanged.length,
      artifactsIds: artifactsCreated.map((a) => a.id)
    };

    emit('task_complete', {
      runId,
      finalAnswer,
      thinking: aggregatedThinking.trim(),
      taskState,
      filesChanged,
      artifacts: artifactsCreated
    });

    return {
      finalAnswer,
      thinking: aggregatedThinking.trim(),
      taskState,
      filesChanged,
      artifacts: artifactsCreated
    };
  } finally {
    activeTaskControllers.delete(runId);
  }
}

/**
 * Deep Research Autonomous Pipeline (Decompose -> Multi-Search -> Fetch Pages -> Cited Report Artifact)
 */
async function runDeepResearch({ runId, query, chatId, provider, model, settings, emit }) {
  const controller = new AbortController();
  activeTaskControllers.set(runId, controller);

  try {
    emit('research_progress', { phase: 'planning', message: 'Decomposing research question into targeted search vectors...' });

    const planResp = await streamChatCompletion({
      provider,
      model,
      thinkingEffort: 'low',
      settings,
      signal: controller.signal,
      messages: [
        {
          role: 'system',
          content: 'Return ONLY a JSON array of 3 concise web search queries to thoroughly research the user topic. Example: ["query 1", "query 2", "query 3"]'
        },
        { role: 'user', content: query }
      ]
    });

    let queries = [query];
    const jsonMatch = (planResp.content || '').match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = safeJsonParse(jsonMatch[0], null);
      if (Array.isArray(parsed) && parsed.length > 0) {
        queries = parsed.slice(0, 4).map(String);
      }
    }

    emit('research_progress', { phase: 'searching', queries, message: `Searching across ${queries.length} angles...` });

    const allSources = [];
    const seenUrls = new Set();
    for (const q of queries) {
      if (controller.signal.aborted) throw new Error('Research cancelled.');
      const found = await performWebSearch(q);
      for (const item of found) {
        if (!seenUrls.has(item.url) && allSources.length < 10) {
          seenUrls.add(item.url);
          allSources.push(item);
        }
      }
    }

    emit('research_progress', {
      phase: 'reading',
      sourceCount: allSources.length,
      sources: allSources,
      message: `Reading and extracting insights from ${Math.min(4, allSources.length)} top web pages...`
    });

    // Deep-read top 3 pages in parallel for grounded quotes/facts
    await Promise.all(
      allSources.slice(0, 3).map(async (src) => {
        try {
          const full = await fetchReadableUrl(src.url);
          src.extractedText = full.text.slice(0, 3000);
        } catch {
          src.extractedText = src.snippet;
        }
      })
    );

    emit('research_progress', { phase: 'synthesizing', message: 'Synthesizing cited Deep Research report...' });

    const sourcesContext = allSources
      .map(
        (s, i) =>
          `[${i + 1}] ${s.title}\nURL: ${s.url}\nExcerpt: ${s.extractedText || s.snippet}`
      )
      .join('\n\n');

    let reportMarkdown = '';
    const synthResp = await streamChatCompletion({
      provider,
      model,
      thinkingEffort: settings.thinkingEffort || 'high',
      settings,
      signal: controller.signal,
      messages: [
        {
          role: 'system',
          content: `You are OpenGemini Deep Research. Write a comprehensive, well-structured Markdown research report answering the user's topic using the provided web sources.
- Include an Executive Summary, detailed analytical sections, comparison tables where useful, and Key Takeaways.
- Cite sources inline using numbered brackets like [1], [2].
- End with a "## Sources" section listing every cited source as clickable Markdown links.`
        },
        {
          role: 'user',
          content: `Research Topic: ${query}\n\nCollected Web Sources:\n${sourcesContext || 'No live web results returned; synthesize from expert domain knowledge and note offline status.'}`
        }
      ],
      onThinking: (delta) => emit('thinking_delta', { delta }),
      onContent: (delta) => {
        reportMarkdown += delta;
        emit('content_delta', { delta });
      }
    });

    reportMarkdown = synthResp.content || reportMarkdown;

    const savedArtifact = await storage.saveArtifact({
      title: `Deep Research: ${query.slice(0, 48)}`,
      type: 'markdown',
      description: `Multi-source Deep Research report (${allSources.length} web sources analyzed)`,
      content: reportMarkdown,
      chatId
    });

    emit('artifact_created', savedArtifact);
    emit('research_complete', {
      report: reportMarkdown,
      thinking: synthResp.thinking || '',
      sources: allSources,
      artifact: savedArtifact
    });
  } finally {
    activeTaskControllers.delete(runId);
  }
}

function extractArtifactTitle(messages = []) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser?.content) return 'Interactive Canvas App';
  return lastUser.content.slice(0, 44).trim();
}

/**
 * Background Cron / Interval Scheduler Loop
 */
let schedulerTimer = null;
let schedulerBusy = false;

function startBackgroundScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      const items = await storage.getScheduled();
      const now = Date.now();
      let changed = false;

      for (const task of items) {
        if (!task.enabled) continue;
        const intervalMs = Math.max(1, Number(task.intervalMinutes) || 60) * 60 * 1000;
        const lastMs = task.lastRun ? new Date(task.lastRun).getTime() : 0;
        if (now - lastMs >= intervalMs) {
          await executeScheduledItem(task);
          changed = true;
        }
      }

      if (changed) {
        await storage.saveScheduled(items);
      }
    } catch {} finally {
      schedulerBusy = false;
    }
  }, 30000);
}

async function executeScheduledItem(task) {
  const started = Date.now();
  const settings = await storage.getSettings();
  try {
    const resp = await streamChatCompletion({
      provider: settings.selectedProvider,
      model: settings.selectedModel,
      thinkingEffort: 'low',
      settings,
      messages: [
        {
          role: 'system',
          content: `You are running a scheduled OpenGemini background check. Workspace: ${settings.workspacePath}. Provide a concise 2-3 sentence status update.`
        },
        { role: 'user', content: task.prompt }
      ]
    });
    const summary = (resp.content || 'Executed cleanly.').replace(/\s+/g, ' ').trim().slice(0, 260);
    task.lastRun = new Date().toISOString();
    task.lastStatus = 'success';
    task.logs = task.logs || [];
    task.logs.unshift(`[${new Date().toLocaleString()}] Success (${Date.now() - started}ms): ${summary}`);
    task.logs = task.logs.slice(0, 25);
  } catch (err) {
    task.lastRun = new Date().toISOString();
    task.lastStatus = 'error';
    task.logs = task.logs || [];
    task.logs.unshift(`[${new Date().toLocaleString()}] Error: ${err.message}`);
    task.logs = task.logs.slice(0, 25);
  }
  return task;
}

module.exports = {
  buildSystemContext,
  runAutonomousTask,
  runDeepResearch,
  resolveApproval,
  cancelActiveRun,
  startBackgroundScheduler,
  executeScheduledItem,
  extractInlineToolCalls
};
