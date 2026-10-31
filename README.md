# ✨ OpenGemini 2.0

> 🌐 **Website:** https://ahpah-dev.github.io/OpenGemini/ · *Independent community project, not affiliated with Google.*

**OpenGemini** is a 100% local-first AI workspace replicating the modern **Google Gemini** interface and **Google Antigravity 2.0** autonomous engineering suite—powered by your own **Local AI Models** (Ollama, LM Studio, llama.cpp, vLLM) or **BYOK** (Google Gemini, OpenAI, Anthropic, OpenRouter, Groq).

---

## 🚀 Quick Start

1. **Double-click** `start-opengemini.bat` (or run `npm start` inside `OpenGemini/`).
2. Open **http://localhost:3456** in your browser.

---

## 🧩 Replicated Google Gemini + Antigravity Features

### 1. Chat vs. Autonomous **Task** Mode (`Chat | Task` Toggle)
- **Chat Mode**: Fast streaming conversation with collapsible **Thinking** traces (`Off`, `Low`, `Medium`, `High` effort levels), multimodal image/file attachments, voice dictation, Temporary Chat (incognito), Gems, and Notebook grounding.
- **Task Mode**: Full **Antigravity 2.0 + Gemini Task** autonomous multi-step agent loop:
  - Live step-by-step **Implementation Plan Checklist** (`update_plan`)
  - Real local **Workspace Tools** (`list_files`, `read_file`, `write_file`, `edit_file`, `search_files`) with unified `+`/`-` **File Diffs**
  - **Terminal Execution** (`run_command`) with configurable Human-in-the-Loop approval (`always-proceed`, `request-review`, `strict`)
  - **Live Web Search & Auto-Browse Reader** (`web_search`, `fetch_url`) with zero API keys required
  - **Subagent Delegation** (`spawn_subagent`)
  - **Interactive Artifact Synthesis** (`create_artifact`) opening live in the split-screen **Canvas**

### 2. Antigravity 2.0 Auxiliary Side Pane & Gemini Canvas
- **Canvas**: Split-screen Live Preview (sandboxed HTML5/JS/CSS, SVG, Markdown) + Code Editor + **AI Refine** bar (`"Add dark neon theme & sound"`).
- **Task & Agents**: Live Task checklist, Subagent cards, and inspectable Tool Call timeline.
- **Files & Diffs**: Color-coded unified diffs for modified workspace files + interactive Workspace File Explorer.
- **Terminal**: Live command logs + interactive workspace shell prompt.

### 3. Specialized Sidebar Hubs
- **Library**: Centralized repository of HTML5 apps, Markdown reports, SVG graphics, code artifacts, and pinned threads.
- **Images (State-of-the-Art Local & Cloud Studio)**:
  - **Qwen 2.1 Image Uncensored (Local GGUF)**: 100% private, on-device uncensored generation powered by Vulkan-accelerated `sd-cli` with a 1-click **Auto Setup** downloader and automatic GPU VRAM quantification (`Q4_K_M`, `Q5_K_M`, `Q8_0`).
  - **Nano Banana 2.1 (Google Gemini API)**: Google's flagship multimodal generation model (`gemini-nano-banana-2.1`) supporting custom aspect ratios (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`), resolutions (`1K`, `2K`), and reference image conversational remixing.
  - **Local AI Vector Art Studio (SVG)**: 100% offline, zero-GPU required illustration generation with any local LLM.
  - **Pollinations Flux, OpenAI DALL-E 3, and Local SD WebUI** integration.
- **Scheduled**: Recurring background tasks & cron checks with live execution logs and `▶ Run Now`.
- **Students**: Guided Learning hub with interactive **Adaptive Practice Quizzes** (instant grading, hints & explanations), **3D Flip Flashcards**, **Exam Study Breakdowns**, and **Socratic Tutor**.
- **Notebooks**: **NotebookLM-in-Gemini** grounded workspaces—attach text, local files, or web URLs; generate **Study Guides**, **Flashcards**, and **2-Host Deep Dive Audio Overviews** (Alex & Maya browser TTS playback).
- **More**: **Gems** (custom AI personas), **Deep Research** (multi-query web synthesis with numbered citations), and **Antigravity Customizations** (`GEMINI.md` / `AGENTS.md` workspace rules, `SKILL.md` skills, and MCP status).

---

## 🧠 Updated 2026 Model Catalog

| Provider | Models Supported | Capabilities |
|---|---|---|
| **Google Gemini (BYOK)** | `gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-nano-banana-2.1` | Tools, Thinking, Vision, Multimodal Image Gen |
| **OpenAI (BYOK)** | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `dall-e-3` | Tools, Deep Thinking, Vision, Image Gen |
| **Anthropic (BYOK)** | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1` | Extended Thinking, Tools, Vision |
| **OpenRouter / Groq** | `deepseek/deepseek-v4-pro-0813`, `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `meta-llama/llama-4-maverick-17b` | High-speed inference, Deep Reasoning |
| **Local Offline** | `qwen3.5:4b`, `qwen3.5:9b`, `gemma4:12b`, `gpt-oss:20b`, `qwen3-coder:30b`, `yokocoder-4b` | 100% Private, Zero Cloud Telemetry |
