// ---------------------------------------------------------------------------
// Media Scraper Extension — Popup Logic (full results UI)
// ---------------------------------------------------------------------------

import type { MediaResource } from '@media-scraper/core';
import type { PopupMessage, ContentMessage, BackgroundMessage } from '../utils/messages.js';

// ---- Constants ----
const ITEM_HEIGHT = 64;
const BUFFER_SIZE = 5;

type Mode = 'input' | 'scraping' | 'results';
type TabType = 'image' | 'video' | 'audio' | 'document';

interface PopupState {
  mode: Mode;
  currentTabId: number | null;

  // Accumulated results
  images: MediaResource[];
  videos: MediaResource[];
  audio: MediaResource[];
  documents: MediaResource[];

  // UI state
  activeTab: TabType;
  selectedIds: Set<string>;
  searchQuery: string;
  scrollTop: number;
  lastSelectedIndex: number;

  // Status
  totalFound: number;
  scrapePhase: string;
}

const state: PopupState = {
  mode: 'input',
  currentTabId: null,
  images: [],
  videos: [],
  audio: [],
  documents: [],
  activeTab: 'image',
  selectedIds: new Set(),
  searchQuery: '',
  scrollTop: 0,
  lastSelectedIndex: -1,
  totalFound: 0,
  scrapePhase: '',
};

// ---- DOM Refs ----

// Input mode
const inputMode = document.getElementById('input-mode')!;
const resultsMode = document.getElementById('results-mode')!;
const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const grabCurrentBtn = document.getElementById('grabCurrentBtn') as HTMLButtonElement;
const batchScrapeBtn = document.getElementById('batchScrapeBtn') as HTMLButtonElement;
const inputStatus = document.getElementById('inputStatus') as HTMLDivElement;
const historyBtn = document.getElementById('historyBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

// Results mode
const msBackBtn = document.getElementById('ms-back-btn') as HTMLButtonElement;
const msRescrapeBtn = document.getElementById('ms-rescrape-btn') as HTMLButtonElement;
const msSpinner = document.getElementById('ms-spinner') as HTMLElement;
const msStatusText = document.getElementById('ms-status-text') as HTMLElement;
const msTabs = document.getElementById('ms-tabs') as HTMLElement;
const msSearchInput = document.getElementById('ms-search-input') as HTMLInputElement;
const msSelectAllBtn = document.getElementById('ms-select-all-btn') as HTMLButtonElement;
const msList = document.getElementById('ms-list') as HTMLElement;
const msItemsContainer = document.getElementById('ms-items-container') as HTMLElement;
const msSelectionBar = document.getElementById('ms-selection-bar') as HTMLElement;
const msSelectionInfo = document.getElementById('ms-selection-info') as HTMLElement;
const msCopyBtn = document.getElementById('ms-copy-btn') as HTMLButtonElement;
const msDownloadBtn = document.getElementById('ms-download-btn') as HTMLButtonElement;
const msCountImage = document.getElementById('ms-count-image') as HTMLElement;
const msCountVideo = document.getElementById('ms-count-video') as HTMLElement;
const msCountAudio = document.getElementById('ms-count-audio') as HTMLElement;
const msCountDocument = document.getElementById('ms-count-document') as HTMLElement;
const msPreviewOverlay = document.getElementById('ms-preview-overlay') as HTMLElement;
const msPreviewImg = document.getElementById('ms-preview-img') as HTMLImageElement;
const msPreviewInfo = document.getElementById('ms-preview-info') as HTMLElement;
const msVideoPlayer = document.getElementById('ms-video-player') as HTMLElement;
const msVideoEl = document.getElementById('ms-video-el') as HTMLVideoElement;
const msVideoClose = document.getElementById('ms-video-close') as HTMLButtonElement;

// ---- Utility ----

function formatSize(bytes: number): string {
  if (bytes === 0) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
}

function formatItemDimensions(r: MediaResource): string {
  if (r.width && r.height) return `${r.width}×${r.height}`;
  return '';
}

// ---- Mode Switching ----

function setMode(mode: Mode): void {
  state.mode = mode;
  inputMode.style.display = mode === 'input' ? '' : 'none';
  resultsMode.style.display = mode !== 'input' ? '' : 'none';
}

// ---- Init ----

async function init(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab?.url) {
      state.currentTabId = tab.id;
      if (!tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        urlInput.value = tab.url;
      }
    }
  } catch {
    // Ignore
  }

  setupInputEvents();
  setupResultsEvents();
  setupKeyboardEvents();
  setupMessageListener();

  // Try to restore cached results for this page
  const restored = await restoreScrapeState();
  if (restored) {
    setMode('results');
    updateTabCounts();
    renderVirtualList();
    msStatusText.textContent = `已发现 ${state.totalFound} 个资源（已缓存）`;
    return;
  }

  // Auto-scrape current page when popup opens (only if not already scraping/have results)
  if (state.currentTabId != null && urlInput.value.trim() && state.mode === 'input') {
    startScrape();
  }
}

// ---- Input Mode Events ----

function setupInputEvents(): void {
  grabCurrentBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        showInputStatus('无法获取当前页面', 'error');
        return;
      }
      state.currentTabId = tab.id;
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        urlInput.value = tab.url;
        // Start scraping immediately
        startScrape();
      } else {
        showInputStatus('无法抓取此页面（Chrome 内部页面）', 'error');
      }
    } catch (err) {
      showInputStatus('获取页面失败: ' + String(err), 'error');
    }
  });

  batchScrapeBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showInputStatus('请输入网页地址', 'error');
      return;
    }

    let targetUrl: string;
    try {
      targetUrl = new URL(url).href;
    } catch {
      try {
        targetUrl = new URL('https://' + url).href;
        urlInput.value = targetUrl;
      } catch {
        showInputStatus('无效的网页地址', 'error');
        return;
      }
    }

    // For batch mode: open a new tab and scrape it
    try {
      const tab = await chrome.tabs.create({ url: targetUrl, active: false });
      state.currentTabId = tab.id ?? null;

      const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          startScrape();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 15000);

      showInputStatus(`正在打开: ${targetUrl}`, 'info');
    } catch (err) {
      showInputStatus('打开页面失败: ' + String(err), 'error');
    }
  });

  // Enter key in URL input starts scrape
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      startScrape();
    }
  });

  historyBtn.addEventListener('click', () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/panel/panel.html') + '?view=history',
    });
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.();
  });
}

function showInputStatus(msg: string, type: 'success' | 'error' | 'info'): void {
  inputStatus.textContent = msg;
  inputStatus.className = 'status-message ' + type;
  inputStatus.style.display = '';
  if (type !== 'error') {
    setTimeout(() => {
      if (inputStatus.textContent === msg) {
        inputStatus.style.display = 'none';
      }
    }, 5000);
  }
}

// ---- Start Scrape ----

async function startScrape(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url || !state.currentTabId) {
    showInputStatus('无法开始抓取', 'error');
    return;
  }

  // Reset state
  state.images = [];
  state.videos = [];
  state.audio = [];
  state.documents = [];
  state.selectedIds.clear();
  state.searchQuery = '';
  state.scrollTop = 0;
  state.lastSelectedIndex = -1;
  state.totalFound = 0;
  state.scrapePhase = 'initializing';

  // Switch modes
  setMode('scraping');
  msSpinner.classList.remove('ms-hidden');
  msStatusText.textContent = '正在初始化...';
  updateTabCounts();
  renderVirtualList();
  updateSelectionBarUI();

  // Try to send message to content script
  try {
    await chrome.tabs.sendMessage(state.currentTabId, { type: 'START_SCRAPE', url } as PopupMessage);
    msStatusText.textContent = '正在抓取页面资源...';
  } catch {
    // Content script not injected, try to inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.currentTabId },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(state.currentTabId, { type: 'START_SCRAPE', url } as PopupMessage);
      msStatusText.textContent = '正在抓取页面资源...';
    } catch (err2) {
      setMode('input');
      showInputStatus('无法注入抓取脚本: ' + String(err2), 'error');
      return;
    }
  }
}

// ---- Results Mode Events ----

function setupResultsEvents(): void {
  // Back button
  msBackBtn.addEventListener('click', goBackToInput);
  // Re-scrape button
  msRescrapeBtn.addEventListener('click', () => { clearScrapeState(); startScrape(); });

  // Tab clicks
  msTabs.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.ms-tab') as HTMLElement | null;
    if (!btn) return;
    const tabType = btn.dataset.msTab as TabType;
    if (!tabType) return;
    switchTab(tabType);
  });

  // Search input
  msSearchInput.addEventListener('input', () => {
    state.searchQuery = msSearchInput.value.trim().toLowerCase();
    state.selectedIds.clear();
    state.lastSelectedIndex = -1;
    state.scrollTop = 0;
    msList.scrollTop = 0;
    renderVirtualList();
  });

  // Select all
  msSelectAllBtn.addEventListener('click', selectAll);

  // Download
  msDownloadBtn.addEventListener('click', downloadSelected);

  // Copy URLs
  msCopyBtn.addEventListener('click', copySelectedUrls);

  // Virtual scroll on list
  let rafId: number | ReturnType<typeof requestAnimationFrame> = 0;
  msList.addEventListener('scroll', () => {
    if (rafId) cancelAnimationFrame(rafId as number);
    rafId = requestAnimationFrame(() => {
      state.scrollTop = msList.scrollTop;
      renderVirtualList();
    });
  }, { passive: true });

  // Image preview overlay
  msPreviewOverlay.querySelector('.ms-preview-backdrop')?.addEventListener('click', closePreview);
  msPreviewOverlay.querySelector('.ms-preview-close')?.addEventListener('click', closePreview);
  msVideoClose.addEventListener('click', hideVideoPlayer);
}

function setupKeyboardEvents(): void {
  document.addEventListener('keydown', (e) => {
    // Only handle when in results/scraping mode
    if (state.mode === 'input') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      // Close preview first if open
      if (msPreviewOverlay.style.display !== 'none') {
        closePreview();
        return;
      }
      // Go back to input mode
      goBackToInput();
      return;
    }

    // Ctrl+A to select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        if (active === msSearchInput) return;
      }
      e.preventDefault();
      selectAll();
    }
  });
}

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender) => {
      switch (message.type) {
        case 'FOUND_MEDIA':
          appendItems(message.items, message.phase);
          break;

        case 'SCRAPE_PROGRESS':
          if (state.mode === 'scraping') {
            msStatusText.textContent = `已发现 ${message.found} 个资源${message.total ? ` / 预估 ${message.total}` : ''}...`;
          }
          break;

        case 'SCRAPE_COMPLETE':
          if (state.mode === 'scraping') {
            state.mode = 'results';
            msSpinner.classList.add('ms-hidden');
            msStatusText.textContent = `已发现 ${state.totalFound} 个资源`;
            updateTabCounts();
            renderVirtualList();
            // Save to session storage so reopening popup restores results
            saveScrapeState();
          }
          break;

        case 'SCRAPE_ERROR':
          if (state.mode === 'scraping') {
            state.mode = 'results';
            msSpinner.classList.add('ms-hidden');
            msStatusText.textContent = '❌ 抓取失败: ' + message.error;
          }
          break;
      }
      return true;
    }
  );
}

function goBackToInput(): void {
  // Stop any in-progress scrape
  if (state.currentTabId && state.mode === 'scraping') {
    chrome.tabs.sendMessage(state.currentTabId, { type: 'STOP_SCRAPE' } as PopupMessage).catch(() => {});
  }
  clearScrapeState();
  setMode('input');
}

// ---- Session Cache ----

const CACHE_KEY_PREFIX = 'scrape_';

async function saveScrapeState(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url) return;
  try {
    await chrome.storage.session.set({
      [CACHE_KEY_PREFIX + url]: {
        images: state.images,
        videos: state.videos,
        audio: state.audio,
        documents: state.documents,
        totalFound: state.totalFound,
        timestamp: Date.now(),
      },
    });
  } catch { /* ignore */ }
}

async function restoreScrapeState(): Promise<boolean> {
  const url = urlInput.value.trim();
  if (!url) return false;
  try {
    const result = await chrome.storage.session.get(CACHE_KEY_PREFIX + url);
    const cached = result[CACHE_KEY_PREFIX + url];
    if (cached && cached.totalFound > 0) {
      state.images = cached.images || [];
      state.videos = cached.videos || [];
      state.audio = cached.audio || [];
      state.documents = cached.documents || [];
      state.totalFound = cached.totalFound;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

async function clearScrapeState(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url) return;
  state.images = [];
  state.videos = [];
  state.audio = [];
  state.documents = [];
  state.totalFound = 0;
  state.selectedIds.clear();
  try { await chrome.storage.session.remove(CACHE_KEY_PREFIX + url); } catch { /* ignore */ }
}

// ---- Append Items (from FOUND_MEDIA messages) ----

function appendItems(items: MediaResource[], phase: string): void {
  for (const item of items) {
    let category: string = item.type;
    if (category === 'unknown') {
      const ext = item.extension.toLowerCase();
      if (ext === '.mp4' || ext === '.webm' || ext === '.mov' || ext === '.avi' ||
          ext === '.mkv' || ext === '.flv' || ext === '.m4v' || ext === '.m3u8' || ext === '.mpd') {
        category = 'video';
      } else if (ext === '.mp3' || ext === '.wav' || ext === '.ogg' || ext === '.flac' || ext === '.aac') {
        category = 'audio';
      } else if (ext === '.pdf' || ext === '.doc' || ext === '.docx' || ext === '.zip' || ext === '.rar' || ext === '.7z') {
        category = 'document';
      } else if (phase === 'iframes') {
        category = 'video';
      } else {
        category = 'image';
      }
    }
    switch (category) {
      case 'video': state.videos.push(item); fetchVideoSize(item); break;
      case 'audio': state.audio.push(item); break;
      case 'document': state.documents.push(item); break;
      default: state.images.push(item); break;
    }
  }

  state.totalFound = state.images.length + state.videos.length + state.audio.length + state.documents.length;
  state.scrapePhase = phase;
  msStatusText.textContent = `已发现 ${state.totalFound} 个资源...`;

  // Auto-switch to the tab with most resources on first batch
  if (state.totalFound <= items.length) {
    autoSwitchTab();
  }

  updateTabCounts();
  renderVirtualList();
}

function autoSwitchTab(): void {
  const counts: { tab: TabType; count: number }[] = [
    { tab: 'image', count: state.images.length },
    { tab: 'video', count: state.videos.length },
    { tab: 'audio', count: state.audio.length },
    { tab: 'document', count: state.documents.length },
  ];
  counts.sort((a, b) => b.count - a.count);
  if (counts[0].count > 0) {
    switchTab(counts[0].tab);
  }
}

function updateTabCounts(): void {
  msCountImage.textContent = String(state.images.length);
  msCountVideo.textContent = String(state.videos.length);
  msCountAudio.textContent = String(state.audio.length);
  msCountDocument.textContent = String(state.documents.length);
}

// ---- Tab Switching ----

function switchTab(tab: TabType): void {
  state.activeTab = tab;
  state.selectedIds.clear();
  state.lastSelectedIndex = -1;
  state.searchQuery = '';
  state.scrollTop = 0;
  msSearchInput.value = '';

  msTabs.querySelectorAll('.ms-tab').forEach((t) => {
    t.classList.toggle('ms-active', (t as HTMLElement).dataset.msTab === tab);
  });

  msList.scrollTop = 0;
  hideVideoPlayer();
  renderVirtualList();
}

// ---- Get Filtered Resources ----

function getFilteredResources(): MediaResource[] {
  let resources: MediaResource[];
  switch (state.activeTab) {
    case 'image': resources = state.images; break;
    case 'video': resources = state.videos; break;
    case 'audio': resources = state.audio; break;
    case 'document': resources = state.documents; break;
    default: resources = state.images;
  }

  if (state.searchQuery) {
    const q = state.searchQuery;
    resources = resources.filter((r) => r.filename.toLowerCase().includes(q));
  }

  return resources;
}

// ---- Virtual Scrolling Render ----

function renderVirtualList(): void {
  if (!msItemsContainer) return;

  const resources = getFilteredResources();

  if (resources.length === 0) {
    msItemsContainer.innerHTML = '<div class="ms-empty">没有找到资源</div>';
    msItemsContainer.style.height = 'auto';
    updateSelectionBarUI();
    return;
  }

  const totalHeight = resources.length * ITEM_HEIGHT;
  const viewportTop = msList.scrollTop;
  const viewportHeight = msList.clientHeight;
  const viewportBottom = viewportTop + viewportHeight;

  const startIndex = Math.max(0, Math.floor(viewportTop / ITEM_HEIGHT) - BUFFER_SIZE);
  const endIndex = Math.min(resources.length, Math.ceil(viewportBottom / ITEM_HEIGHT) + BUFFER_SIZE);

  msItemsContainer.innerHTML = '';
  msItemsContainer.style.height = totalHeight + 'px';

  const fragment = document.createDocumentFragment();

  for (let i = startIndex; i < endIndex; i++) {
    const r = resources[i];
    const item = createResourceItemDOM(r, i);
    item.style.top = (i * ITEM_HEIGHT) + 'px';

    fragment.appendChild(item);
  }

  msItemsContainer.appendChild(fragment);
  updateSelectionBarUI();
}

// ---- Create Resource Item DOM ----

function createResourceItemDOM(r: MediaResource, index: number): HTMLElement {
  const item = document.createElement('div');
  item.className = 'ms-item';
  item.setAttribute('data-ms-id', r.id);
  item.setAttribute('data-ms-index', String(index));

  const isSelected = state.selectedIds.has(r.id);
  if (isSelected) item.classList.add('ms-selected');

  // Checkbox
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'ms-item-checkbox';
  cb.checked = isSelected;
  cb.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSelection(r.id);
  });

  // Thumb
  const thumbDiv = document.createElement('div');
  thumbDiv.className = 'ms-item-thumb';
  thumbDiv.style.position = 'relative';

  if (r.type === 'image' || r.type === 'unknown') {
    const img = document.createElement('img');
    img.src = r.url;
    img.alt = r.filename;
    img.loading = 'lazy';
    img.onerror = () => {
      img.style.display = 'none';
      if (!thumbDiv.querySelector('.ms-thumb-icon')) {
        const icon = document.createElement('span');
        icon.className = 'ms-thumb-icon';
        icon.textContent = '🖼️';
        thumbDiv.appendChild(icon);
      }
    };
    thumbDiv.appendChild(img);
    thumbDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      openPreview(r);
    });
  } else if (r.type === 'video') {
    const img = document.createElement('img');
    img.alt = r.filename;
    img.loading = 'lazy';

    // Different button based on video source type
    let btnIcon: string;
    let btnTitle: string;
    if (r.source === 'iframe') {
      btnIcon = '🔗';
      btnTitle = '平台视频 — 点击在源站观看';
    } else if (r.source === 'm3u8' || r.source === 'mpd') {
      btnIcon = '📡';
      btnTitle = '流媒体视频 — 需用CLI下载';
    } else {
      btnIcon = '▶';
      btnTitle = '播放视频';
    }

    if (r.thumbnail) {
      img.src = r.thumbnail;
      img.onerror = () => { img.style.display = 'none'; };
      thumbDiv.appendChild(img);

      // Small overlay icon
      const playBtn = document.createElement('span');
      playBtn.className = 'ms-thumb-play';
      playBtn.textContent = btnIcon;
      playBtn.title = btnTitle;
      thumbDiv.appendChild(playBtn);
    } else {
      // No thumbnail: show icon directly in thumbDiv
      thumbDiv.textContent = btnIcon;
      thumbDiv.title = btnTitle;
      Object.assign(thumbDiv.style, {
        fontSize: '24px', background: '#1a1a2e', cursor: 'pointer',
      });
    }

    thumbDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVideoPlayer(r);
    });
  } else if (r.type === 'audio') {
    thumbDiv.textContent = '🎵';
  } else {
    thumbDiv.textContent = '📄';
  }

  // Info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'ms-item-info';

  const nameDiv = document.createElement('div');
  nameDiv.className = 'ms-item-name';
  nameDiv.textContent = r.filename;
  nameDiv.title = r.filename;

  const metaDiv = document.createElement('div');
  metaDiv.className = 'ms-item-meta';
  const dims = formatItemDimensions(r);
  const sz = formatSize(r.size);
  const parts = [dims, sz].filter(Boolean);
  // For videos without size info, show source type
  if (parts.length === 0 && r.type === 'video') {
    const srcLabels: Record<string, string> = { iframe: '平台', m3u8: 'm3u8', mpd: 'mpd', video: '视频', link: '链接' };
    parts.push(srcLabels[r.source] || r.source);
  }
  metaDiv.textContent = parts.join('  ');

  infoDiv.appendChild(nameDiv);
  infoDiv.appendChild(metaDiv);

  // Row
  const rowDiv = document.createElement('div');
  rowDiv.style.display = 'flex';
  rowDiv.style.alignItems = 'center';
  rowDiv.style.gap = '10px';
  rowDiv.style.width = '100%';
  rowDiv.style.minHeight = '48px';
  rowDiv.appendChild(cb);
  rowDiv.appendChild(thumbDiv);
  rowDiv.appendChild(infoDiv);

  item.appendChild(rowDiv);

  // Click on item body
  item.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    if (target.closest('.ms-item-thumb')) return;
    if (target.closest('.ms-video-player')) return;
    if (target.closest('.ms-video-close')) return;

    if (e.shiftKey) {
      rangeSelect(index);
    } else {
      singleSelect(r.id, index);
    }
  });

  return item;
}

// ---- Image Preview ----

function openPreview(r: MediaResource): void {
  msPreviewImg.src = r.url;
  msPreviewImg.alt = r.filename;
  msPreviewInfo.textContent = r.filename;
  msPreviewOverlay.style.display = '';
}

function closePreview(): void {
  msPreviewOverlay.style.display = 'none';
  msPreviewImg.src = '';
}

function toggleVideoPlayer(r: MediaResource): void {
  // Embed player in popup results panel
  msVideoEl.src = r.url;
  msVideoPlayer.style.display = '';
  // Scroll to player
  msVideoPlayer.scrollIntoView({ behavior: 'smooth' });
}

function hideVideoPlayer(): void {
  msVideoPlayer.style.display = 'none';
  msVideoEl.pause();
  msVideoEl.src = '';
}

function fetchVideoSize(r: MediaResource): void {
  if (r.size > 0 || r.source === 'iframe') return; // Already have size, or platform page
  chrome.runtime.sendMessage({ type: 'FETCH_VIDEO_SIZE', url: r.url } as BackgroundMessage, (resp) => {
    if (resp?.size) {
      r.size = resp.size;
      // Re-render if results are visible
      if (state.mode === 'results') renderVirtualList();
    }
  });
}

// ---- Selection Logic ----

function toggleSelection(id: string): void {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  state.lastSelectedIndex = -1;

  const item = msItemsContainer.querySelector(`[data-ms-id="${CSS.escape(id)}"]`) as HTMLElement;
  if (item) {
    item.classList.toggle('ms-selected', state.selectedIds.has(id));
    const cb = item.querySelector('.ms-item-checkbox') as HTMLInputElement;
    if (cb) cb.checked = state.selectedIds.has(id);
  }

  updateSelectionBarUI();
}

function singleSelect(id: string, index: number): void {
  const wasSelected = state.selectedIds.has(id);

  // Deselect all visible
  msItemsContainer.querySelectorAll('.ms-item.ms-selected').forEach((el) => {
    el.classList.remove('ms-selected');
    const cb = el.querySelector('.ms-item-checkbox') as HTMLInputElement;
    if (cb) cb.checked = false;
  });
  state.selectedIds.clear();

  if (!wasSelected) {
    state.selectedIds.add(id);
    state.lastSelectedIndex = index;
    const item = msItemsContainer.querySelector(`[data-ms-id="${CSS.escape(id)}"]`) as HTMLElement;
    if (item) {
      item.classList.add('ms-selected');
      const cb = item.querySelector('.ms-item-checkbox') as HTMLInputElement;
      if (cb) cb.checked = true;
    }
  } else {
    state.lastSelectedIndex = -1;
  }

  updateSelectionBarUI();
}

function rangeSelect(toIndex: number): void {
  if (state.lastSelectedIndex < 0) return;

  const resources = getFilteredResources();
  const from = Math.min(state.lastSelectedIndex, toIndex);
  const to = Math.max(state.lastSelectedIndex, toIndex);

  for (let i = from; i <= to; i++) {
    if (resources[i]) {
      state.selectedIds.add(resources[i].id);
    }
  }

  // Refresh visible items
  msItemsContainer.querySelectorAll('.ms-item').forEach((el) => {
    const id = (el as HTMLElement).getAttribute('data-ms-id')!;
    const selected = state.selectedIds.has(id);
    el.classList.toggle('ms-selected', selected);
    const cb = el.querySelector('.ms-item-checkbox') as HTMLInputElement;
    if (cb) cb.checked = selected;
  });

  updateSelectionBarUI();
}

function selectAll(): void {
  const resources = getFilteredResources();
  for (const r of resources) {
    state.selectedIds.add(r.id);
  }

  msItemsContainer.querySelectorAll('.ms-item').forEach((el) => {
    el.classList.add('ms-selected');
    const cb = el.querySelector('.ms-item-checkbox') as HTMLInputElement;
    if (cb) cb.checked = true;
  });

  updateSelectionBarUI();
}

function updateSelectionBarUI(): void {
  const count = state.selectedIds.size;
  const resources = getFilteredResources();
  const total = resources.length;

  if (count === 0) {
    msSelectionBar.style.display = 'none';
    return;
  }

  msSelectionBar.style.display = 'flex';

  let totalSize = 0;
  for (const r of resources) {
    if (state.selectedIds.has(r.id)) {
      totalSize += r.size;
    }
  }

  msSelectionInfo.innerHTML = `已选 <strong>${count}</strong> / ${total} · ${formatSize(totalSize)}`;
  msDownloadBtn.disabled = false;
}

// ---- Download ----

function downloadSelected(): void {
  const resources = getFilteredResources();
  const selected = resources.filter((r) => state.selectedIds.has(r.id));
  if (selected.length === 0) return;

  const message: BackgroundMessage = {
    type: 'DOWNLOAD',
    resources: selected,
  };

  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[media-scraper] Download failed:', chrome.runtime.lastError.message);
      return;
    }
  });
}

// ---- Copy URLs ----

function copySelectedUrls(): void {
  const resources = getFilteredResources();
  const selected = resources.filter((r) => state.selectedIds.has(r.id));
  if (selected.length === 0) return;

  const urls = selected.map((r) => r.url).join('\n');

  navigator.clipboard.writeText(urls).then(() => {
    const orig = msCopyBtn.textContent;
    msCopyBtn.textContent = '✅ 已复制!';
    setTimeout(() => { msCopyBtn.textContent = orig; }, 1500);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = urls;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// ---- Start ----
init();
