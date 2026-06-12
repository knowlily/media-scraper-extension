# Media Scraper — Chrome 浏览器扩展

> 一键提取网页中所有媒体资源。暗色主题、虚拟滚动、弹窗驱动。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-purple)](https://vitejs.dev/)

## 功能

- **一键抓取**：点击扩展图标自动抓取当前页面
- **智能提取**：图片、视频、音频、文档；支持懒加载、og:image、JSON-LD、CSS 背景图
- **视频预览**：弹窗内嵌播放器直接播放
- **批量下载**：勾选后一键下载到本地
- **会话缓存**：关掉弹窗再打开，结果还在
- **类型标识**：▶ 直链视频、🔗 平台嵌入、📡 流媒体
- **键盘快捷键**：方向键切换、空格选中、Ctrl+A 全选、Esc 关闭

## 安装

1. 克隆或下载本仓库
2. 打开 `chrome://extensions` → 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `dist/` 目录
4. 固定扩展图标方便使用

## 从源码构建

```bash
pnpm install
pnpm build
# 产物在 dist/ 目录
```

## 架构

```
src/
├── popup/          # 扩展弹窗界面（输入 + 结果）
├── content/        # 内容脚本（DOM 提取）
├── background/     # Service Worker（下载、缩略图、元数据）
├── panel/          # 结果面板页面
└── utils/          # 消息类型定义
```

核心提取逻辑来自共享的 [media-scraper](https://github.com/knowlily/media-scraper) 包。

## 使用方法

1. 打开任意网页，点击扩展图标
2. 自动开始抓取，实时显示发现的资源
3. 按类型筛选：📷 图片 / 🎬 视频 / 🎵 音频 / 📄 文档
4. 点击缩略图预览大图，点击 ▶ 播放视频
5. 勾选需要的资源，点击「⬇ 下载」批量保存
6. 关掉弹窗再打开，之前的结果还在（会话缓存）

### 键盘操作

| 按键 | 功能 |
|------|------|
| ↑↓ | 切换选中 |
| 空格 | 选中/取消 |
| Ctrl+A | 全选 |
| Enter | 下载选中 |
| Esc | 关闭预览 |

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前页面 DOM |
| `downloads` | 保存文件到本地 |
| `scripting` | 注入内容脚本 |
| `storage` | 缓存结果和设置 |
| `tabs` | 打开视频页面 |

## 许可

MIT
