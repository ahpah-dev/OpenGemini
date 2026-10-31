/**
 * Image generation for OpenGemini.
 *
 *  - Qwen-Image 2.1 Uncensored  (local, via stable-diffusion.cpp, auto-installed)
 *  - Nano Banana 2.1            (Gemini API, bring your own key)
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { once } = require('events');

const storage = require('./storage');

const IMAGEGEN_DIR = path.join(storage.DATA_DIR, 'imagegen');
const RUNNER_DIR = path.join(IMAGEGEN_DIR, 'runner');
const MODELS_DIR = path.join(IMAGEGEN_DIR, 'models', 'qwen-image-2.1');
const GENERATED_DIR = path.join(storage.DATA_DIR, 'generated');

const PROVIDERS = ['qwen-image-local', 'nano-banana'];
const NANO_BANANA_MODEL = 'gemini-nano-banana-2.1';

const QWEN = {
  denoiserRepo: 'abenzerps/Qwen-Image-2.1-Uncensored-Quantized',
  encoderRepo: 'AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF',
  encoderFile: 'Qwen-Image-2.1-Turbo-Uncensored-AD-Q4_K.gguf',
  vaeFile: 'vae/qwen_image_2.1_vae_bf16.safetensors'
};

const ASPECTS = {
  '1:1': [1024, 1024],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '4:3': [1152, 864],
  '3:4': [864, 1152]
};

const GITHUB_HEADERS = { 'User-Agent': 'OpenGemini', Accept: 'application/vnd.github+json' };
const hfHeaders = () => (process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {});

/* ------------------------------------------------------------------ helpers */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
    });
  });
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findFile(dir, name) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = await findFile(path.join(dir, e.name), name);
      if (hit) return hit;
    }
  }
  return null;
}

async function detectVramMb() {
  const r = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits']);
  if (!r.ok) return null;
  const n = parseInt(r.stdout.split('\n')[0], 10);
  return Number.isFinite(n) ? n : null;
}

function pickQuant(settings, vramMb) {
  const wanted = settings.qwenQuant;
  if (wanted && wanted !== 'auto') return wanted;
  if (vramMb == null) return 'Q4_K_M';
  if (vramMb >= 20000) return 'Q8_0';
  if (vramMb >= 14000) return 'Q6_K';
  if (vramMb >= 10000) return 'Q5_K_M';
  return 'Q4_K_M';
}

function resolveBackend(settings) {
  const b = settings.sdBackend;
  if (b && b !== 'auto') return b;
  if (process.platform === 'darwin') return 'metal';
  return 'vulkan';
}

function assetPattern(backend) {
  if (process.platform === 'win32') {
    if (backend === 'cuda') return /win-cuda12-x64\.zip$/;
    if (backend === 'cpu') return /win-cpu-x64\.zip$/;
    return /win-vulkan-x64\.zip$/;
  }
  if (process.platform === 'darwin') return /Darwin-macOS-.*-arm64\.zip$/;
  if (backend === 'cpu') return /Linux-Ubuntu-[\d.]+-x86_64\.zip$/;
  return /Linux-Ubuntu-[\d.]+-x86_64-vulkan\.zip$/;
}

/* ------------------------------------------------------------------- status */

const sizeCache = new Map();

async function hfFileInfo(repo, file) {
  if (!sizeCache.has(repo)) {
    const res = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`, { headers: hfHeaders() });
    if (!res.ok) throw new Error(`Hugging Face lookup failed for ${repo} (${res.status})`);
    sizeCache.set(repo, await res.json());
  }
  const sib = (sizeCache.get(repo).siblings || []).find((s) => s.rfilename === file);
  if (!sib) throw new Error(`File ${file} not found in ${repo}`);
  return { size: sib.size, sha256: sib.lfs?.sha256 || null };
}

function modelPlan(quant) {
  return [
    {
      id: 'diffusion',
      label: `Qwen-Image 2.1 Uncensored (${quant})`,
      repo: QWEN.denoiserRepo,
      file: `qwen-image-2.1-UC-${quant}.gguf`
    },
    { id: 'llm', label: 'Uncensored Qwen3-VL text encoder', repo: QWEN.encoderRepo, file: QWEN.encoderFile },
    { id: 'vae', label: 'Qwen-Image 2.1 VAE', repo: QWEN.denoiserRepo, file: QWEN.vaeFile }
  ].map((m) => ({ ...m, dest: path.join(MODELS_DIR, path.basename(m.file)) }));
}

async function readRunnerInfo() {
  try {
    const info = JSON.parse(await fsp.readFile(path.join(RUNNER_DIR, 'info.json'), 'utf8'));
    if (info.exe && (await exists(info.exe))) return info;
  } catch {}
  return null;
}

async function getImageStatus(settings) {
  const vramMb = await detectVramMb();
  const quant = pickQuant(settings, vramMb);
  const runner = await readRunnerInfo();
  const plan = modelPlan(quant);
  const files = [];
  for (const m of plan) {
    let size = 0;
    try {
      size = (await fsp.stat(m.dest)).size;
    } catch {}
    files.push({ id: m.id, label: m.label, file: path.basename(m.file), present: size > 0, size });
  }
  const partial = await Promise.all(
    plan.map(async (m) => {
      try {
        return (await fsp.stat(`${m.dest}.part`)).size;
      } catch {
        return 0;
      }
    })
  );
  return {
    defaultProvider: PROVIDERS.includes(settings.imageProvider) ? settings.imageProvider : 'qwen-image-local',
    qwen: {
      name: 'Qwen-Image 2.1 Uncensored',
      ready: Boolean(runner) && files.every((f) => f.present),
      runnerInstalled: Boolean(runner),
      runnerTag: runner?.tag || null,
      backend: runner?.backend || resolveBackend(settings),
      quant,
      vramMb,
      files,
      partialBytes: partial.reduce((a, b) => a + b, 0)
    },
    nanoBanana: {
      name: 'Nano Banana 2.1',
      model: settings.nanoBananaModel || NANO_BANANA_MODEL,
      ready: Boolean(settings.geminiApiKey)
    }
  };
}

/* ----------------------------------------------------------------- download */

async function downloadFile({ url, dest, expectedSize, expectedSha, signal, onProgress, headers = {} }) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });

  if (expectedSize && (await exists(dest))) {
    const st = await fsp.stat(dest);
    if (st.size === expectedSize) return { skipped: true };
  }

  const part = `${dest}.part`;
  let start = 0;
  try {
    start = (await fsp.stat(part)).size;
  } catch {}

  const request = (from) =>
    fetch(url, {
      headers: { ...headers, ...(from ? { Range: `bytes=${from}-` } : {}) },
      redirect: 'follow',
      signal
    });

  let res = await request(start);
  if (res.status === 416) {
    await fsp.rm(part, { force: true });
    start = 0;
    res = await request(0);
  }
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  if (start > 0 && res.status === 200) start = 0; // server ignored Range

  const lenHeader = parseInt(res.headers.get('content-length') || '0', 10);
  const total = expectedSize || (lenHeader ? start + lenHeader : 0);

  const ws = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
  let received = start;
  let lastTick = Date.now();
  let lastBytes = received;
  let speed = 0;

  try {
    for await (const chunk of Readable.fromWeb(res.body)) {
      if (!ws.write(chunk)) await once(ws, 'drain');
      received += chunk.length;
      const now = Date.now();
      if (now - lastTick >= 400) {
        speed = ((received - lastBytes) / (now - lastTick)) * 1000;
        lastTick = now;
        lastBytes = received;
        onProgress?.({ received, total, speed });
      }
    }
  } finally {
    ws.end();
    await once(ws, 'close').catch(() => {});
  }
  onProgress?.({ received, total, speed: 0 });

  if (expectedSha) {
    onProgress?.({ received, total, speed: 0, verifying: true });
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(part)) hash.update(chunk);
    if (hash.digest('hex') !== expectedSha) {
      await fsp.rm(part, { force: true });
      throw new Error(`Checksum mismatch for ${path.basename(dest)} — the file was removed, please retry.`);
    }
  }
  await fsp.rename(part, dest);
  return { skipped: false };
}

async function extractZip(zip, dest) {
  await fsp.mkdir(dest, { recursive: true });
  if (process.platform === 'win32') {
    const t = await run('tar', ['-xf', zip, '-C', dest]);
    if (t.ok) return;
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`
    ]);
    if (!ps.ok) throw new Error(`Could not extract ${path.basename(zip)}: ${ps.stderr || ps.err?.message}`);
    return;
  }
  const u = await run('unzip', ['-o', zip, '-d', dest]);
  if (!u.ok) throw new Error(`Could not extract ${path.basename(zip)} (is 'unzip' installed?): ${u.stderr}`);
}

/* ------------------------------------------------------------------- setup */

async function installRunner(settings, { signal, onEvent } = {}) {
  const backend = resolveBackend(settings);
  const existing = await readRunnerInfo();
  if (existing && existing.backend === backend) return existing;

  onEvent?.('step', { label: `Finding the latest stable-diffusion.cpp build (${backend})…` });
  const relRes = await fetch('https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest', {
    headers: GITHUB_HEADERS,
    signal
  });
  if (!relRes.ok) throw new Error(`GitHub release lookup failed (${relRes.status})`);
  const rel = await relRes.json();
  const asset = (rel.assets || []).find((a) => assetPattern(backend).test(a.name));
  if (!asset) throw new Error(`No stable-diffusion.cpp build found for ${process.platform}/${backend}.`);

  const extras = [];
  if (process.platform === 'win32' && backend === 'cuda') {
    const rt = (rel.assets || []).find((a) => /^cudart-sd-bin-win-cu12-x64\.zip$/.test(a.name));
    if (rt) extras.push(rt);
  }

  await fsp.rm(RUNNER_DIR, { recursive: true, force: true });
  await fsp.mkdir(RUNNER_DIR, { recursive: true });

  for (const a of [asset, ...extras]) {
    const zip = path.join(RUNNER_DIR, a.name);
    onEvent?.('step', { label: `Downloading ${a.name}` });
    await downloadFile({
      url: a.browser_download_url,
      dest: zip,
      expectedSize: a.size,
      signal,
      onProgress: (p) => onEvent?.('progress', { id: 'runner', label: 'Image runner', ...p })
    });
    onEvent?.('step', { label: `Unpacking ${a.name}` });
    await extractZip(zip, RUNNER_DIR);
    await fsp.rm(zip, { force: true });
  }

  const exeName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
  const exe = await findFile(RUNNER_DIR, exeName);
  if (!exe) throw new Error(`${exeName} was not found in the downloaded archive.`);
  if (process.platform !== 'win32') await fsp.chmod(exe, 0o755).catch(() => {});

  const info = { exe, backend, tag: rel.tag_name, asset: asset.name, installedAt: new Date().toISOString() };
  await fsp.writeFile(path.join(RUNNER_DIR, 'info.json'), JSON.stringify(info, null, 2));
  helpCache = null;
  return info;
}

async function setupQwen(settings, { signal, onEvent } = {}) {
  const vramMb = await detectVramMb();
  const quant = pickQuant(settings, vramMb);
  onEvent?.('plan', {
    quant,
    vramMb,
    backend: resolveBackend(settings),
    note: vramMb
      ? `Detected ${(vramMb / 1024).toFixed(0)} GB of GPU memory → using ${quant}.`
      : `No NVIDIA GPU info found → using the smallest quant (${quant}).`
  });

  await installRunner(settings, { signal, onEvent });

  for (const m of modelPlan(quant)) {
    if (signal?.aborted) throw new Error('Setup cancelled.');
    onEvent?.('step', { label: `Downloading ${m.label}` });
    const info = await hfFileInfo(m.repo, m.file);
    await downloadFile({
      url: `https://huggingface.co/${m.repo}/resolve/main/${m.file}`,
      dest: m.dest,
      expectedSize: info.size,
      expectedSha: info.sha256,
      headers: hfHeaders(),
      signal,
      onProgress: (p) => onEvent?.('progress', { id: m.id, label: m.label, ...p })
    });
  }
  onEvent?.('step', { label: 'Qwen-Image 2.1 is ready.' });
}

/* -------------------------------------------------------------- generation */

let helpCache = null;
async function runnerHelp(exe) {
  if (!helpCache) {
    helpCache = run(exe, ['--help'], { cwd: path.dirname(exe) }).then((r) => `${r.stdout}\n${r.stderr}`);
  }
  return helpCache;
}

let queue = Promise.resolve();
function enqueue(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function newImageId() {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function generateQwenLocal(settings, opts, { signal, onProgress } = {}) {
  return enqueue(async () => {
    const status = await getImageStatus(settings);
    if (!status.qwen.ready) {
      throw new Error('Qwen-Image 2.1 is not set up yet. Open Images and press “Set up locally”.');
    }
    const runner = await readRunnerInfo();
    const plan = Object.fromEntries(modelPlan(status.qwen.quant).map((m) => [m.id, m.dest]));
    const help = await runnerHelp(runner.exe);

    const [w, h] = ASPECTS[opts.aspectRatio] || ASPECTS['1:1'];
    const seed = Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 31);
    const steps = Math.max(4, Math.min(60, Number(opts.steps) || Number(settings.qwenSteps) || 24));
    const cfg = Number(settings.qwenCfg) || 6;

    await fsp.mkdir(GENERATED_DIR, { recursive: true });
    const id = newImageId();
    const out = path.join(GENERATED_DIR, `${id}.png`);

    const args = [
      '--diffusion-model', plan.diffusion,
      '--vae', plan.vae,
      '--llm', plan.llm,
      '-p', opts.prompt,
      '--cfg-scale', String(cfg),
      '--sampling-method', 'euler',
      '--steps', String(steps),
      '-W', String(w),
      '-H', String(h),
      '--seed', String(seed),
      '-o', out
    ];
    if (opts.negative) args.push('--negative-prompt', opts.negative);
    const vram = status.qwen.vramMb;
    if ((vram == null || vram < 16000) && help.includes('--offload-to-cpu')) args.push('--offload-to-cpu');
    if (help.includes('--diffusion-fa')) args.push('--diffusion-fa');
    if (help.includes('--vae-tiling')) args.push('--vae-tiling');

    await new Promise((resolve, reject) => {
      const child = spawn(runner.exe, args, { cwd: path.dirname(runner.exe), windowsHide: true });
      let tail = '';
      const feed = (d) => {
        const text = d.toString();
        tail = (tail + text).slice(-4000);
        const m = [...text.matchAll(/(\d+)\/(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/g)].pop();
        if (m) onProgress?.({ step: Number(m[1]), total: Number(m[2]) });
      };
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', reject);
      const onAbort = () => child.kill();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => child.kill(), 25 * 60 * 1000);
      child.on('close', async (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new Error('Generation cancelled.'));
        if (code === 0 && (await exists(out))) return resolve();
        const msg = tail.trim().split('\n').slice(-6).join('\n');
        reject(new Error(`stable-diffusion.cpp exited with code ${code}.\n${msg}`));
      });
    });

    return {
      id,
      prompt: opts.prompt,
      provider: 'qwen-image-local',
      model: 'Qwen-Image 2.1 Uncensored',
      imageUrl: `/generated/${id}.png`,
      width: w,
      height: h,
      seed,
      steps,
      createdAt: new Date().toISOString()
    };
  });
}

async function generateNanoBanana(settings, opts, { signal } = {}) {
  if (!settings.geminiApiKey) {
    throw new Error('Nano Banana 2.1 needs a Google Gemini API key. Add one in Settings → BYOK keys.');
  }
  const model = settings.nanoBananaModel || NANO_BANANA_MODEL;
  const parts = [{ text: opts.prompt }];
  for (const ref of opts.references || []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: ASPECTS[opts.aspectRatio] ? opts.aspectRatio : '1:1',
        imageSize: ['1K', '2K', '4K'].includes(opts.imageSize) ? opts.imageSize : '1K'
      }
    }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiApiKey },
      body: JSON.stringify(body),
      signal
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Nano Banana error (${res.status}): ${json.error?.message || res.statusText}`);
  }

  const cand = json.candidates?.[0];
  const outParts = cand?.content?.parts || [];
  const img = outParts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const inline = img?.inlineData || img?.inline_data;
  if (!inline) {
    const why = json.promptFeedback?.blockReason || cand?.finishReason || 'no image returned';
    const text = outParts.map((p) => p.text).filter(Boolean).join(' ').trim();
    throw new Error(`Nano Banana returned no image (${why}).${text ? ` ${text}` : ''}`);
  }

  await fsp.mkdir(GENERATED_DIR, { recursive: true });
  const id = newImageId();
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  await fsp.writeFile(path.join(GENERATED_DIR, `${id}.${ext}`), Buffer.from(inline.data, 'base64'));

  return {
    id,
    prompt: opts.prompt,
    provider: 'nano-banana',
    model: 'Nano Banana 2.1',
    imageUrl: `/generated/${id}.${ext}`,
    caption: outParts.map((p) => p.text).filter(Boolean).join(' ').trim() || undefined,
    createdAt: new Date().toISOString()
  };
}

async function loadReference(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/generated/')) return null;
  const file = path.join(GENERATED_DIR, path.basename(imageUrl));
  try {
    const buf = await fsp.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return { mimeType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

module.exports = {
  PROVIDERS,
  NANO_BANANA_MODEL,
  GENERATED_DIR,
  IMAGEGEN_DIR,
  getImageStatus,
  setupQwen,
  generateQwenLocal,
  generateNanoBanana,
  loadReference
};
