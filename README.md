# Media Scraper — Chrome Extension

> One-click media extraction from any web page. Dark-themed, virtual-scrolling, popup-driven.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-purple)](https://vitejs.dev/)

## Features

- **One-click scrape** — extension icon auto-scrapes current page
- **Smart extraction** — images, videos, audio, documents; lazy-load, og:image, JSON-LD, CSS backgrounds
- **Video preview** — embedded player in popup
- **Batch download** — select + download to local
- **Session cache** — results persist across popup reopens
- **Type indicators** — ▶ direct video, 🔗 platform embed, 📡 streaming
- **Keyboard shortcuts** — arrows, space, Ctrl+A, Escape

## Install

1. Clone or download this repo
2. Go to `chrome://extensions` → enable "Developer mode"
3. Click "Load unpacked" → select the `dist/` folder
4. Pin the extension for quick access

## Build from source

```bash
pnpm install
pnpm build
# Output in dist/
```

## Architecture

```
src/
├── popup/          # Extension popup UI (input + results)
├── content/        # Content script (DOM extraction)
├── background/     # Service worker (downloads, thumbnails, metadata)
├── panel/          # Results panel page
└── utils/          # Message types
```

Core extraction logic lives in the shared [media-scraper](https://github.com/knowlily/media-scraper) package.

## Permissions

| Permission | Purpose |
|-----------|---------|
| `activeTab` | Access current page DOM |
| `downloads` | Save files to disk |
| `scripting` | Inject content script |
| `storage` | Cache results + settings |
| `tabs` | Open video pages |

## License

MIT
