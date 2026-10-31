export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function offlineMarkdownFallback(md = '') {
  let html = escapeHtml(md);
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const enc = encodeURIComponent(code);
    return `<div class="code-block-wrap"><div class="code-block-bar"><span>${lang || 'code'}</span><div class="code-block-actions"><button class="code-btn copy-code-btn" data-code="${enc}">Copy</button><button class="code-btn canvas-code-btn" data-lang="${lang || 'code'}" data-code="${enc}">Open in Canvas</button></div></div><pre><code>${code}</code></pre></div>`;
  });
  html = html
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>');
  return `<p>${html}</p>`;
}

let markedConfigured = false;

function ensureMarkedConfigured() {
  if (markedConfigured || !window.marked) return;
  const renderer = new window.marked.Renderer();

  renderer.code = function (codeArg, infostring) {
    // Support both marked v4 (code, lang) and marked v12+ ({ text, lang })
    const rawCode = typeof codeArg === 'object' ? (codeArg.text || '') : String(codeArg || '');
    const lang = (typeof codeArg === 'object' ? codeArg.lang : infostring || '').trim().split(/\s+/)[0] || 'text';
    let highlighted = escapeHtml(rawCode);
    if (window.hljs) {
      try {
        highlighted = lang && window.hljs.getLanguage(lang)
          ? window.hljs.highlight(rawCode, { language: lang }).value
          : window.hljs.highlightAuto(rawCode).value;
      } catch {}
    }
    const encoded = encodeURIComponent(rawCode);
    const canPreview = ['html', 'svg', 'xml', 'markdown', 'md', 'javascript', 'js', 'css', 'python'].includes(lang.toLowerCase());
    return `
      <div class="code-block-wrap">
        <div class="code-block-bar">
          <span>${escapeHtml(lang)}</span>
          <div class="code-block-actions">
            <button type="button" class="code-btn copy-code-btn" data-code="${encoded}">Copy</button>
            ${canPreview ? `<button type="button" class="code-btn canvas-code-btn" data-lang="${escapeHtml(lang)}" data-code="${encoded}">Open in Canvas</button>` : ''}
          </div>
        </div>
        <pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>
      </div>
    `;
  };

  window.marked.setOptions({
    renderer,
    gfm: true,
    breaks: true
  });
  markedConfigured = true;
}

export function renderMarkdown(md = '') {
  if (!md) return '';
  if (window.marked) {
    try {
      ensureMarkedConfigured();
      return window.marked.parse(md);
    } catch {
      return offlineMarkdownFallback(md);
    }
  }
  return offlineMarkdownFallback(md);
}
