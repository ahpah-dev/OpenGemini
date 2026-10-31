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
- **Images**: AI Image Studio supporting offline **Local LLM Vector Art Studio**, zero-key **Pollinations Flux**, **OpenAI DALL-E 3**, and **Local Stable Diffusion WebUI**, plus conversational image remixing.
- **Scheduled**: Recurring background tasks & cron checks with live execution logs and `▶ Run Now`.
- **Students**: Guided Learning hub with interactive **Adaptive Practice Quizzes** (instant grading, hints & explanations), **3D Flip Flashcards**, **Exam Study Breakdowns**, and **Socratic Tutor**.
- **Notebooks**: **NotebookLM-in-Gemini** grounded workspaces—attach text, local files, or web URLs; generate **Study Guides**, **Flashcards**, and **2-Host Deep Dive Audio Overviews** (Alex & Maya browser TTS playback).
- **More**: **Gems** (custom AI personas), **Deep Research** (multi-query web synthesis with numbered citations), and **Antigravity Customizations** (`GEMINI.md` / `AGENTS.md` workspace rules, `SKILL.md` skills, and MCP status).
