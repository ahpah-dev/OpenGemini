const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const storage = require('./storage');

const AGENT_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Create or update the step-by-step task execution plan checklist shown to the user.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Ordered list of task steps',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short actionable step description' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
              },
              required: ['title', 'status']
            }
          }
        },
        required: ['steps']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories inside the workspace or a subdirectory.',
      parameters: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: 'Relative or absolute directory path (omit for workspace root)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read text contents of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative or absolute path to the file' },
          startLine: { type: 'integer', description: 'Optional 1-based start line' },
          endLine: { type: 'integer', description: 'Optional 1-based end line' }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file in the workspace, recording diffs.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative or absolute path to write' },
          content: { type: 'string', description: 'Complete file content' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace an exact target string in an existing file with replacement text.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative or absolute path to modify' },
          target: { type: 'string', description: 'Exact text snippet to replace' },
          replacement: { type: 'string', description: 'New replacement text' }
        },
        required: ['filePath', 'target', 'replacement']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a keyword or pattern across text files in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regex pattern to search for' },
          subDir: { type: 'string', description: 'Optional subdirectory to scope search' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the workspace terminal and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command string to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web for up-to-date facts, documentation, news, or comparisons.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch and extract clean readable text from a web URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP/HTTPS URL to read' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_artifact',
      description: 'Create an interactive HTML5 app/game/visualization, Markdown report/plan, or SVG graphic in Canvas & Library.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the artifact' },
          type: { type: 'string', enum: ['html', 'markdown', 'svg', 'code'], description: 'Artifact format' },
          description: { type: 'string', description: 'Short summary of what this artifact does' },
          content: { type: 'string', description: 'Full standalone HTML, Markdown, SVG, or code content' }
        },
        required: ['title', 'type', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description: 'Delegate a focused sub-problem (research, code synthesis, or review) to an autonomous subagent.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Subagent role title, e.g. "Code Reviewer" or "Research Specialist"' },
          prompt: { type: 'string', description: 'Detailed task instructions for the subagent' }
        },
        required: ['role', 'prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_task',
      description: 'Schedule a recurring automated background prompt or task.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Name of the scheduled task' },
          prompt: { type: 'string', description: 'Prompt or task objective to execute on schedule' },
          intervalMinutes: { type: 'integer', description: 'Interval in minutes (e.g. 60 for hourly, 1440 for daily)' }
        },
        required: ['title', 'prompt', 'intervalMinutes']
      }
    }
  }
];

function resolveWorkspacePath(targetPath, settings) {
  const wsRoot = path.resolve(settings.workspacePath || process.cwd());
  if (!targetPath || targetPath === '.' || targetPath === './') return wsRoot;
  const resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(wsRoot, targetPath);

  const insideWorkspace = resolved.toLowerCase().startsWith(wsRoot.toLowerCase());
  if (!insideWorkspace && settings.nonWorkspaceAccess === 'deny') {
    throw new Error(`Access outside workspace (${wsRoot}) is blocked by Non-Workspace File Access policy.`);
  }
  return resolved;
}

function computeUnifiedDiff(oldText = '', newText = '', filePath = '') {
  const oldLines = oldText ? oldText.replace(/\r\n/g, '\n').split('\n') : [];
  const newLines = newText ? newText.replace(/\r\n/g, '\n').split('\n') : [];
  const out = [`--- a/${path.basename(filePath)}`, `+++ b/${path.basename(filePath)}`];
  const maxLen = Math.max(oldLines.length, newLines.length);
  let additions = 0;
  let deletions = 0;

  let shown = 0;
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      if (shown < 160 && o !== undefined) {
        out.push(`  ${o}`);
        shown++;
      }
    } else {
      if (o !== undefined) {
        deletions++;
        if (shown < 220) {
          out.push(`- ${o}`);
          shown++;
        }
      }
      if (n !== undefined) {
        additions++;
        if (shown < 220) {
          out.push(`+ ${n}`);
          shown++;
        }
      }
    }
  }
  if (maxLen > 220) out.push(`... (${maxLen - 220} more lines)`);
  return { diff: out.join('\n'), additions, deletions };
}

async function performWebSearch(query) {
  const results = [];
  // 1. DuckDuckGo HTML endpoint (no API key needed)
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const html = await res.text();
      const blockRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = blockRegex.exec(html)) !== null && results.length < 8) {
        let rawHref = match[1];
        const uddg = rawHref.match(/[?&]uddg=([^&]+)/);
        if (uddg) rawHref = decodeURIComponent(uddg[1]);
        const title = stripHtml(match[2]);
        const snippet = stripHtml(match[3]);
        if (title && rawHref.startsWith('http')) {
          results.push({ title, url: rawHref, snippet });
        }
      }
    }
  } catch {}

  // 2. Fallback to Wikipedia OpenSearch / Search API if DuckDuckGo was rate-limited
  if (results.length === 0) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=6`;
      const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'OpenGemini/2.0 (Local AI Assistant)' } });
      if (res.ok) {
        const data = await res.json();
        for (const item of data?.query?.search || []) {
          results.push({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            snippet: stripHtml(item.snippet || '')
          });
        }
      }
    } catch {}
  }

  return results;
}

async function fetchReadableUrl(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const raw = await res.text();
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : url;
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  const text = stripHtml(cleaned).replace(/\s+/g, ' ').trim().slice(0, 8000);
  return { title, url, text };
}

function stripHtml(str = '') {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function runShellCommand(command, cwd, shell) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        shell: shell || undefined,
        timeout: 20000,
        maxBuffer: 1024 * 1024 * 2
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (error.code ?? 1) : 0,
          stdout: (stdout || '').slice(0, 6000),
          stderr: (stderr || (error && !stderr ? error.message : '') || '').slice(0, 4000)
        });
      }
    );
  });
}

async function executeAgentTool(name, args, context) {
  const {
    settings,
    chatId,
    onPlanUpdate,
    onFileChanged,
    onArtifactCreated,
    onTerminalOutput,
    onSubagentAction,
    requestApproval
  } = context;

  switch (name) {
    case 'update_plan': {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      onPlanUpdate?.(steps);
      return { ok: true, updatedSteps: steps.length };
    }

    case 'list_files': {
      const target = resolveWorkspacePath(args.dirPath, settings);
      const entries = await fsp.readdir(target, { withFileTypes: true });
      const items = entries
        .filter((e) => !['node_modules', '.git', '.venv', '__pycache__'].includes(e.name))
        .slice(0, 120)
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file'
        }));
      return { directory: target, count: items.length, items };
    }

    case 'read_file': {
      const target = resolveWorkspacePath(args.filePath, settings);
      const raw = await fsp.readFile(target, 'utf8');
      const allLines = raw.replace(/\r\n/g, '\n').split('\n');
      const start = Math.max(1, Number(args.startLine) || 1);
      const end = Math.min(allLines.length, Number(args.endLine) || Math.min(allLines.length, start + 199));
      const numbered = allLines
        .slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join('\n');
      return {
        filePath: target,
        totalLines: allLines.length,
        showing: `${start}-${end}`,
        content: numbered.slice(0, 12000)
      };
    }

    case 'write_file': {
      const target = resolveWorkspacePath(args.filePath, settings);
      let before = '';
      let existed = false;
      try {
        before = await fsp.readFile(target, 'utf8');
        existed = true;
      } catch {}
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, args.content ?? '', 'utf8');
      const { diff, additions, deletions } = computeUnifiedDiff(before, args.content ?? '', target);
      const changeRecord = {
        filePath: target,
        fileName: path.basename(target),
        action: existed ? 'modified' : 'created',
        additions,
        deletions,
        diff,
        updatedAt: new Date().toISOString()
      };
      onFileChanged?.(changeRecord);
      return { ok: true, filePath: target, action: changeRecord.action, additions, deletions };
    }

    case 'edit_file': {
      const target = resolveWorkspacePath(args.filePath, settings);
      const before = await fsp.readFile(target, 'utf8');
      if (!before.includes(args.target)) {
        return { error: `Target snippet was not found in ${target}. Read the file first to verify exact text.` };
      }
      const after = before.split(args.target).join(args.replacement ?? '');
      await fsp.writeFile(target, after, 'utf8');
      const { diff, additions, deletions } = computeUnifiedDiff(before, after, target);
      const changeRecord = {
        filePath: target,
        fileName: path.basename(target),
        action: 'modified',
        additions,
        deletions,
        diff,
        updatedAt: new Date().toISOString()
      };
      onFileChanged?.(changeRecord);
      return { ok: true, filePath: target, additions, deletions };
    }

    case 'search_files': {
      const root = resolveWorkspacePath(args.subDir, settings);
      const matches = [];
      const q = String(args.query || '').toLowerCase();

      async function walk(dir, depth = 0) {
        if (depth > 4 || matches.length >= 40) return;
        let entries = [];
        try {
          entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (matches.length >= 40) break;
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full, depth + 1);
          } else if (/\.(js|ts|jsx|tsx|py|md|json|html|css|txt|yaml|yml|rs|go|c|cpp|h)$/i.test(e.name)) {
            try {
              const stat = await fsp.stat(full);
              if (stat.size > 300_000) continue;
              const txt = await fsp.readFile(full, 'utf8');
              const lines = txt.split(/\r?\n/);
              for (let idx = 0; idx < lines.length; idx++) {
                if (lines[idx].toLowerCase().includes(q)) {
                  matches.push({
                    file: path.relative(root, full),
                    line: idx + 1,
                    preview: lines[idx].trim().slice(0, 160)
                  });
                  if (matches.length >= 40) break;
                }
              }
            } catch {}
          }
        }
      }

      if (q) await walk(root, 0);
      return { query: args.query, matchCount: matches.length, matches };
    }

    case 'run_command': {
      const cmd = String(args.command || '').trim();
      if (!cmd) return { error: 'Empty command' };

      const denied = (settings.commandDenylist || []).find((d) => d && cmd.toLowerCase().includes(d.toLowerCase()));
      if (denied) {
        return { error: `Blocked by command denylist rule: "${denied}"` };
      }

      if (settings.approvalPolicy === 'strict' || settings.approvalPolicy === 'request-review') {
        if (requestApproval) {
          const approved = await requestApproval({
            tool: 'run_command',
            command: cmd,
            cwd: settings.workspacePath
          });
          if (!approved) {
            return { denied: true, message: 'User declined command execution.' };
          }
        }
      }

      const cwd = resolveWorkspacePath('.', settings);
      const res = await runShellCommand(cmd, cwd, settings.terminalShell);
      onTerminalOutput?.({
        command: cmd,
        cwd,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        timestamp: new Date().toISOString()
      });
      return res;
    }

    case 'web_search': {
      if (settings.internetAccess === 'deny' || !settings.webSearchEnabled) {
        return { error: 'Internet access / Web Search is disabled in Settings.' };
      }
      const results = await performWebSearch(args.query || '');
      return { query: args.query, results };
    }

    case 'fetch_url': {
      if (settings.internetAccess === 'deny') {
        return { error: 'Internet access is disabled in Settings.' };
      }
      return fetchReadableUrl(args.url);
    }

    case 'create_artifact': {
      const saved = await storage.saveArtifact({
        title: args.title || 'Generated Artifact',
        type: args.type || 'html',
        description: args.description || '',
        content: args.content || '',
        chatId
      });
      onArtifactCreated?.(saved);
      return {
        ok: true,
        artifactId: saved.id,
        title: saved.title,
        type: saved.type,
        message: 'Artifact saved to Library and opened in live Canvas preview.'
      };
    }

    case 'spawn_subagent': {
      if (!onSubagentAction) {
        return { error: 'Subagent runner unavailable in this context.' };
      }
      return onSubagentAction(args.role || 'Specialist Subagent', args.prompt || '');
    }

    case 'schedule_task': {
      const list = await storage.getScheduled();
      const interval = Math.max(1, Number(args.intervalMinutes) || 60);
      const item = {
        id: `sched-${Date.now()}`,
        title: args.title || 'Scheduled Task',
        prompt: args.prompt || '',
        mode: 'task',
        intervalMinutes: interval,
        cronExpression: interval === 60 ? '0 * * * *' : interval === 1440 ? '0 9 * * *' : `*/${Math.min(interval, 59)} * * * *`,
        enabled: true,
        lastRun: null,
        lastStatus: 'scheduled',
        logs: [`[${new Date().toISOString()}] Created by OpenGemini Task Agent.`]
      };
      list.unshift(item);
      await storage.saveScheduled(list);
      return { ok: true, scheduledTask: item };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = {
  AGENT_TOOLS_SCHEMA,
  executeAgentTool,
  performWebSearch,
  fetchReadableUrl,
  resolveWorkspacePath,
  runShellCommand
};
