# Media Scraper Chrome Extension

一键提取网页中所有图片、视频、音频和文档的 Chrome 浏览器扩展。

## 技术栈

- **TypeScript** (strict mode, ES2022 target)
- **Vite 6** (bundler, no module preload)
- **Chrome Extension Manifest V3**
- **@media-scraper/core** — 共享的媒体提取引擎

## 项目结构

```
mount-chorm/
├── manifest.json          # Chrome MV3 扩展配置
├── package.json           # 依赖和脚本
├── tsconfig.json          # TypeScript 配置
├── vite.config.ts         # Vite 构建配置
├── AGENTS.md              # 项目文档
├── .gitignore
├── src/
│   ├── popup/
│   │   ├── popup.html     # 弹窗 UI
│   │   ├── popup.ts       # 弹窗逻辑
│   │   └── popup.css      # 弹窗样式
│   ├── panel/
│   │   ├── panel.html     # 结果面板 UI
│   │   ├── panel.ts       # 面板逻辑（网格、选择、预览、下载）
│   │   └── panel.css      # 面板样式
│   ├── content/
│   │   └── content.ts     # 内容脚本（注入页面，执行抓取）
│   ├── background/
│   │   └── background.ts  # Service Worker（消息路由、下载、缩略图代理）
│   └── utils/
│       └── messages.ts    # 类型安全的消息传递
└── dist/                  # 构建输出（加载到 Chrome）
```

## 架构

```
┌──────────┐   START_SCRAPE    ┌──────────────┐
│  Popup   │ ────────────────→ │   Content    │
│  (弹窗)   │                   │   Script     │
│          │ ←── SCRAPE_RESULT  │ (页面注入)    │
└──────────┘                   └──────┬───────┘
                                      │
                               SCRAPE_RESULT
                                      │
                                      ▼
┌──────────┐   DOWNLOAD       ┌──────────────┐
│  Panel   │ ───────────────→ │  Background  │
│ (结果面板) │ ←── DOWNLOAD_*   │     SW       │
│          │                   │ (Service     │
│          │                   │  Worker)     │
└──────────┘                   └──────────────┘
```

1. **Popup** 发送 `START_SCRAPE` 到当前页面的 **Content Script**
2. **Content Script** 构建 DOM 适配器，调用 `@media-scraper/core` 的 `scrape()` 函数
3. 抓取结果通过 **Background SW** 路由到 **Panel**
4. **Panel** 显示结果，用户选择后通过 Background SW 触发下载

## 构建

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（监听文件变化）
pnpm dev

# 类型检查
pnpm typecheck
```

## 在 Chrome 中加载

1. 打开 `chrome://extensions`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `dist/` 目录

## 核心设计决策

### 跨域策略
- Content Script 运行在目标页面上下文中，可直接访问 DOM
- Background SW 代理跨域缩略图请求（Range: bytes=0-524287）
- Chrome MV3 的 Service Worker 可以发起跨域 fetch

### 缩略图缓存
- LRU 策略，最多 50 个条目
- 缓存有效期 30 分钟
- 通过 FileReader 将 blob 转为 data URL

### 权限
- `activeTab` — 仅在用户点击扩展时访问当前页面
- `downloads` — 下载媒体文件
- `scripting` — 动态注入内容脚本
- `storage` — 保存历史记录和结果
- `<all_urls>` (可选) — 跨域缩略图代理

### 依赖
- `@media-scraper/core` — 通过 `file:` 协议链接到 `../mount/packages/core`
- Vite 在构建时将 core 打包进扩展（无运行时依赖）
