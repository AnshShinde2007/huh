# Huh? — Contextual Browser Dictionary

> Highlight any word or term on any webpage and instantly get a concise, context-aware explanation — without leaving the tab.

---

## What it does

**Huh?** is a Chrome extension that lets you select any text on a webpage and look it up instantly. It uses the surrounding sentence to disambiguate ambiguous terms before asking an AI to explain them.

| Selected text | Surrounding context | Explanation |
|---|---|---|
| `Apple` | *"Apple announced its latest quarterly earnings…"* | Apple Inc. — the tech company |
| `apple` | *"Add the chopped apple to the bowl…"* | The fruit |
| `inference` | *"The model performs inference on the incoming request."* | ML inference, not logical reasoning |

---

## Features

- **Select to explain** — highlight any text; a `huh?` button appears near the selection
- **Alt+Click** — click any word while holding `Alt` to look it up without selecting
- **Context-aware** — extracts up to 500 characters of surrounding text from the page to disambiguate the selection before sending to AI
- **Multi-provider** — works with Gemini, Claude, OpenAI, Groq, OpenRouter, and xAI Grok
- **Smart caching** — identical lookups return instantly from local cache (up to 100 entries, Jaccard-similarity matched)
- **Shadow DOM isolation** — the extension UI never conflicts with the host page's styles

---

## Supported AI Providers

| Provider | Models (examples) |
|---|---|
| **Google Gemini** | `gemini-2.0-flash`, `gemini-2.5-pro` |
| **Anthropic Claude** | `claude-3-5-haiku-latest`, `claude-3-7-sonnet` |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o` |
| **Groq** | `llama-3.3-70b-versatile`, `moonshotai/kimi-k2-instruct` |
| **OpenRouter** | Any model available on openrouter.ai |
| **xAI Grok** | `grok-4.5`, `grok-2` |

---

## Installation

> The extension is not yet on the Chrome Web Store. Install it manually as an unpacked extension.

### 1. Clone and build

```bash
git clone https://github.com/AnshShinde2007/huh.git
cd huh/frontend
npm install
npm run build
```

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `huh/frontend/dist` folder

### 3. Configure your API key

1. Click the **Huh?** extension icon in the toolbar
2. Choose your AI provider
3. Paste your API key and click **Save**

---

## Usage

| Action | How |
|---|---|
| Explain selected text | Select any text → click the `huh?` button that appears |
| Explain a single word | Hold `Alt` and click any word |
| Dismiss the card | Click anywhere outside it |
| Retry a failed lookup | Click **Retry** inside the error card |

Both triggers can be toggled independently in the popup settings.

---

## Development

```bash
cd frontend
npm install
npm run dev    # Vite dev server (for popup UI preview)
npm run build  # Builds the extension to dist/
```

The extension uses:
- **Vite** + **@crxjs/vite-plugin** for Chrome extension bundling
- **React 19** + **TypeScript** for the popup and content script UI
- **Shadow DOM** to isolate extension styles from host pages

Source layout:

```
frontend/src/
├── background.ts   # Service worker: AI API calls, caching, message routing
├── content.tsx     # Content script: selection detection, context extraction, floating UI
├── content.css     # Scoped styles for the floating card and trigger button
└── popup.tsx       # Extension popup: provider/key configuration, settings
```

---

## License

[MIT](../LICENSE) © 2026 Ansh Shinde
