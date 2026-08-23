# Huh? — Progress Tracker

> Contextual browser dictionary extension. Highlight any text on any page and get a concise, AI-powered, context-aware explanation — without leaving the tab.

---

## Project Overview

- **Purpose:** Chrome/Firefox extension that explains selected (or Alt+Clicked) text using surrounding page context and a user-provided AI API key.
- **Tech Stack:** React 19, TypeScript, Vite, @crxjs/vite-plugin, Shadow DOM, Chrome Extension Manifest V3
- **Repo:** `e:\huh` — frontend source in `frontend/`
- **Version:** 1.0.0 (both Chrome and Firefox builds)

---

## Current Status

### ✅ Completed

- [x] **Core content script** (`content.tsx`) — Shadow DOM isolation, floating trigger button, explanation card, drag-to-reposition, keyboard/click dismiss
- [x] **Selection handler** — `mouseup` listener; extracts selection text + surrounding context (500-char window, semantic ancestor walking)
- [x] **Alt+Click handler** — word boundary detection via caret APIs (`caretPositionFromPoint` / `caretRangeFromPoint`), direct lookup bypass
- [x] **Background service worker** (`background.ts`) — message routing, AI API calls, Jaccard-similarity cache (100 entries, 0.3 threshold)
- [x] **Multi-provider support** — Gemini, Anthropic Claude, OpenAI, Groq, OpenRouter, xAI Grok (direct xai- key routing)
- [x] **Structured output** — provider-specific JSON schemas / tool_use forced responses; `{ title, type, subtitle, description }`
- [x] **Popup UI** (`popup.tsx`) — Dashboard tab, BYOK tab, Sign-in tab (placeholder); provider pills with key status indicators; card placement picker; interaction toggles; cache clear
- [x] **Persisted settings** — `chrome.storage.local`: `provider`, `apiKey`, `apiKeysMap`, `showTrigger`, `enableAltClick`, `cardPositionSetting`, `lookupCache`
- [x] **Live settings sync** — `chrome.storage.onChanged` listener in content script picks up popup toggle changes without page reload
- [x] **Card positioning modes** — Follow Selection (default, viewport-boundary-aware), Top-Left, Top-Right, Bottom-Left, Bottom-Right
- [x] **Loading skeleton** — shimmer animation while awaiting API response
- [x] **Error handling & retry** — error card with `⚠️` icon and Retry button; extension context invalidation handled gracefully
- [x] **Cache hit indicator** — "Instant Cache Hit" footer badge on card
- [x] **Dual browser builds** — Chrome (`dist/`) and Firefox (`dist-firefox/`) via separate Vite configs; Firefox service-worker loader shim
- [x] **README** — installation steps, feature table, provider table, source layout

---

## In Progress / Planned

- [ ] **Chrome Web Store submission** — extension not yet published; currently manual unpacked install only
- [ ] **Sign-in / cloud sync (V2)** — Sign-in tab UI exists but is non-functional (placeholder); backend auth not built
- [ ] **Model picker in popup** — currently defaults to a hard-coded model per provider; no UI to override the model
- [ ] **Keyboard shortcut** — no hotkey to trigger lookup on current selection without clicking the button
- [ ] **Onboarding flow** — no first-run experience to guide new users through API key setup
- [ ] **Firefox Web Store (AMO) submission** — Firefox build exists (`huh-firefox.zip`) but not published

---

## Known Issues / Tech Debt

- `grok` provider in `PROVIDER_BRIDGE` maps to `openrouter` bgId but popup label says "Grok" — slightly confusing routing; xai- key detection in `background.ts` bypasses openrouter for direct xAI endpoint
- BYOK Interactions toggles in the collapsible section do not persist on save (only saved when the main Save button is pressed via `handleSave`); Dashboard toggles persist immediately
- `showToggles` state in popup resets to `false` on every open (not persisted)
- `App.tsx` is a thin shell (`<Popup />`) with no routing — sign-in tab is purely cosmetic

---

## Build Commands

```bash
cd frontend

# Dev server (popup UI preview only)
npm run dev

# Chrome production build → dist/
npm run build

# Firefox production build → dist-firefox/
npm run build:firefox
```

---

## File Map

| File | Role |
|---|---|
| `src/background.ts` | Service worker: caching, AI API calls, message routing |
| `src/content.tsx` | Content script: selection/alt-click detection, floating UI, Shadow DOM |
| `src/popup.tsx` | Extension popup: BYOK config, dashboard, settings |
| `src/content.css` | Scoped styles for floating card and trigger button |
| `src/index.css` | Popup styles |
| `manifest.chrome.json` | MV3 manifest for Chrome |
| `manifest.firefox.json` | MV3 manifest for Firefox |

---

*Last updated: 2026-08-23*
