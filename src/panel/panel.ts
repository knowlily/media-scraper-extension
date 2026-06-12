// ---------------------------------------------------------------------------
// Media Scraper Extension — Results Panel Logic
// ---------------------------------------------------------------------------

import type { MediaResource, ScrapeResult } from '@media-scraper/core';
import type { BackgroundMessage, PanelMessage } from '../utils/messages.js';

// ---- Types ----

type TabType = 'image' | 'video' | 'audio' | 'document';

interface UIState {
  result: ScrapeResult | null;
  activeTab: TabType;
  selectedIds: Set<string>;
  typeFilter: string;
  sizeFilter: { minWidth: number; minHeight: number; minSize: number };
}

// ---- State ----

const state: UIState = {
  result: null,
  activeTab: 'image',
  selectedIds: new Set(),
  typeFilter: '',
  sizeFilter: { minWidth: 0, minHeight: 0, minSize: 0 },
};

// Keep track of the last clicked index for Shift+click range selection
let lastClickedIndex = -1;

// ---- DOM Elements ----

const pageTitle = document.getElementById('pageTitle')!;
const totalCount = document.getElementById('totalCount')!;
const imageCount = document.getElementById('imageCount')!;
const videoCount = document.getElementById('videoCount')!;
const audioCount = document.getElementById('audioCount')!;
const docCount = document.getElementById('docCount')!;
const typeTabs = document.getElementById('typeTabs')!;
const typeFilter = document.getElementById('typeFilter') as HTMLSelectElement;
const sizeFilter = document.getElementById('sizeFilter') as HTMLInputElement;
const selectAllBtn = document.getElementById('selectAllBtn')!;
const deselectAllBtn = document.getElementById('deselectAllBtn')!;
const mediaGrid = document.getElementById('mediaGrid')!;
const emptyState = document.getElementById('emptyState')!;
const selectionBar = document.getElementById('selectionBar')!;
const selectionText = document.getElementById('selectionText')!;
const selectionSize = document.getElementById('selectionSize')!;
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn')!;
const previewOverlay = document.getElementById('previewOverlay')!;
const previewBackdrop = document.getElementById('previewBackdrop')!;
const previewClose = document.getElementById('previewClose')!;
const previewImage = document.getElementById('previewImage') as HTMLImageElement;
const previewFilename = document.getElementById('previewFilename')!;
const previewDimensions = document.getElementById('previewDimensions')!;
const previewSize = document.getElementById('previewSize')!;
const previewSourceUrl = document.getElementById('previewSourceUrl') as HTMLAnchorElement;

// ---- Init ----

async function init(): Promise<void> {
  // Load result from storage
  try {
    const stored = await chrome.storage.local.get('lastResult');
    if (stored.lastResult) {
      loadResult(stored.lastResult as ScrapeResult);
    }
  } catch {
    // No stored result
  }

  // Also listen for incoming messages (in case panel was already open)
  chrome.runtime.onMessage.addListener(handleIncomingMessage);

  // Parse URL params (for history view, etc.)
  const params = new URLSearchParams(location.search);
  if (params.get('view') === 'history') {
    // TODO: load history
    console.log('[panel] History view requested');
  }
}

// ---- Message Handler ----

function handleIncomingMessage(message: PanelMessage | { type: string; [key: string]: unknown }): boolean {
  switch (message.type) {
    case 'SHOW_RESULT':
      loadResult((message as PanelMessage & { result: ScrapeResult }).result);
      break;
    case 'DOWNLOAD_PROGRESS':
      // Could show download progress in the selection bar
      break;
    case 'DOWNLOAD_COMPLETE':
      alert(`下载完成！成功 ${(message as PanelMessage & { count: number }).count} 个文件`);
      break;
  }
  return true;
}

// ---- Load Result ----

function loadResult(result: ScrapeResult): void {
  state.result = result;
  pageTitle.textContent = result.title || result.url;
  totalCount.textContent = `共 ${result.total} 个资源`;

  // Update tab counts
  imageCount.textContent = String(result.images.length);
  videoCount.textContent = String(result.videos.length);
  audioCount.textContent = String(result.audio.length);
  docCount.textContent = String(result.documents.length);

  // Auto-select tab with most resources
  const counts: { key: TabType; count: number }[] = [
    { key: 'image', count: result.images.length },
    { key: 'video', count: result.videos.length },
    { key: 'audio', count: result.audio.length },
    { key: 'document', count: result.documents.length },
  ];
  counts.sort((a, b) => b.count - a.count);

  state.activeTab = counts[0].count > 0 ? counts[0].key : 'image';

  // Update active tab UI
  document.querySelectorAll('.tab').forEach((tab) => {
    const el = tab as HTMLElement;
    el.classList.toggle('active', el.dataset.type === state.activeTab);
  });

  renderGrid();
}

// ---- Render Grid ----

function getCurrentResources(): MediaResource[] {
  if (!state.result) return [];
  const result = state.result;

  let resources: MediaResource[];
  switch (state.activeTab) {
    case 'image': resources = result.images; break;
    case 'video': resources = result.videos; break;
    case 'audio': resources = result.audio; break;
    case 'document': resources = result.documents; break;
    default: resources = result.images;
  }

  // Apply filters
  if (state.typeFilter) {
    resources = resources.filter((r) => r.type === state.typeFilter);
  }

  if (state.sizeFilter.minWidth > 0) {
    resources = resources.filter(
      (r) => r.width === 0 || r.width >= state.sizeFilter.minWidth
    );
  }
  if (state.sizeFilter.minHeight > 0) {
    resources = resources.filter(
      (r) => r.height === 0 || r.height >= state.sizeFilter.minHeight
    );
  }
  if (state.sizeFilter.minSize > 0) {
    resources = resources.filter(
      (r) => r.size === 0 || r.size >= state.sizeFilter.minSize
    );
  }

  return resources;
}

function renderGrid(): void {
  const resources = getCurrentResources();

  if (resources.length === 0) {
    mediaGrid.innerHTML = '';
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';

  mediaGrid.innerHTML = resources
    .map(
      (r, idx) => `
    <div class="media-card ${state.selectedIds.has(r.id) ? 'selected' : ''}"
         data-id="${r.id}"
         data-index="${idx}"
         data-url="${escapeAttr(r.url)}">
      <input type="checkbox" class="media-checkbox" ${state.selectedIds.has(r.id) ? 'checked' : ''}
             data-id="${r.id}" />
      ${renderThumbnail(r)}
      <div class="media-info">
        <div class="media-filename" title="${escapeAttr(r.filename)}">${escapeHtml(r.filename)}</div>
        <div class="media-meta">
          <span>${formatDimensions(r)}</span>
          <span>${formatSize(r.size)}</span>
        </div>
      </div>
    </div>`
    )
    .join('');

  // Attach event listeners
  mediaGrid.querySelectorAll('.media-card').forEach((card) => {
    const el = card as HTMLElement;
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const checkbox = el.querySelector('.media-checkbox') as HTMLInputElement;

      // If clicking the checkbox itself, handle toggle
      if (target === checkbox) {
        handleToggle(el.dataset.id!);
        return;
      }

      // If clicking the card, handle selection
      if (e.shiftKey && lastClickedIndex >= 0) {
        handleRangeSelect(parseInt(el.dataset.index!, 10));
      } else {
        handleCardClick(el.dataset.id!, parseInt(el.dataset.index!, 10));
      }
    });

    // Double-click to open preview
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openPreview(el.dataset.id!);
    });
  });

  // Update selection bar
  updateSelectionBar();
}

function renderThumbnail(r: MediaResource): string {
  if (r.type === 'image' || r.type === 'unknown') {
    return `<img class="media-thumbnail" src="${escapeAttr(r.url)}" alt="${escapeAttr(r.filename)}" loading="lazy"
              onerror="this.parentElement.querySelector('.media-thumbnail').style.display='none';(this.parentElement.querySelector('.media-thumbnail-placeholder')||this).style.display='flex'" />`;
  }
  if (r.type === 'video') {
    const thumb = r.thumbnail || '';
    if (thumb) {
      return `<img class="media-thumbnail" src="${escapeAttr(thumb)}" alt="${escapeAttr(r.filename)}" loading="lazy" />`;
    }
    return `<div class="media-thumbnail-placeholder">🎬</div>`;
  }
  if (r.type === 'audio') {
    return `<div class="media-thumbnail-placeholder">🎵</div>`;
  }
  return `<div class="media-thumbnail-placeholder">📄</div>`;
}

// ---- Selection ----

function handleToggle(id: string): void {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  lastClickedIndex = -1;
  updateCardSelection(id);
  updateSelectionBar();
}

function handleCardClick(id: string, index: number): void {
  // Toggle this item, deselect all others
  const wasSelected = state.selectedIds.has(id);
  state.selectedIds.clear();
  if (!wasSelected) {
    state.selectedIds.add(id);
  }
  lastClickedIndex = wasSelected ? -1 : index;
  refreshGridSelections();
  updateSelectionBar();
}

function handleRangeSelect(toIndex: number): void {
  if (lastClickedIndex < 0) return;

  const resources = getCurrentResources();
  const from = Math.min(lastClickedIndex, toIndex);
  const to = Math.max(lastClickedIndex, toIndex);

  for (let i = from; i <= to; i++) {
    if (resources[i]) {
      state.selectedIds.add(resources[i].id);
    }
  }
  refreshGridSelections();
  updateSelectionBar();
}

function refreshGridSelections(): void {
  mediaGrid.querySelectorAll('.media-card').forEach((card) => {
    const el = card as HTMLElement;
    const id = el.dataset.id!;
    el.classList.toggle('selected', state.selectedIds.has(id));
    const cb = el.querySelector('.media-checkbox') as HTMLInputElement;
    if (cb) cb.checked = state.selectedIds.has(id);
  });
}

function updateCardSelection(id: string): void {
  const card = mediaGrid.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (card) {
    card.classList.toggle('selected', state.selectedIds.has(id));
    const cb = card.querySelector('.media-checkbox') as HTMLInputElement;
    if (cb) cb.checked = state.selectedIds.has(id);
  }
}

function updateSelectionBar(): void {
  const count = state.selectedIds.size;
  if (count === 0) {
    selectionBar.style.display = 'none';
    return;
  }

  selectionBar.style.display = '';
  const resources = getCurrentResources();
  const total = resources.length;
  selectionText.textContent = `已选 ${count}/${total}`;

  // Calculate total size of selected
  let totalSize = 0;
  for (const r of resources) {
    if (state.selectedIds.has(r.id)) {
      totalSize += r.size;
    }
  }
  selectionSize.textContent = `总大小 ${formatSize(totalSize)}`;
}

function selectAll(): void {
  const resources = getCurrentResources();
  for (const r of resources) {
    state.selectedIds.add(r.id);
  }
  refreshGridSelections();
  updateSelectionBar();
}

function deselectAll(): void {
  state.selectedIds.clear();
  lastClickedIndex = -1;
  refreshGridSelections();
  updateSelectionBar();
}

// ---- Preview ----

function openPreview(id: string): void {
  const resources = getCurrentResources();
  const resource = resources.find((r) => r.id === id);
  if (!resource) return;

  if (resource.type === 'image' || resource.type === 'unknown') {
    previewImage.src = resource.url;
    previewImage.style.display = '';
    previewDimensions.textContent =
      resource.width && resource.height
        ? `${resource.width} × ${resource.height}`
        : '尺寸未知';
  } else {
    previewImage.style.display = 'none';
    previewDimensions.textContent = resource.type.toUpperCase();
  }

  previewFilename.textContent = resource.filename || resource.url;
  previewSize.textContent = formatSize(resource.size);
  previewSourceUrl.href = resource.url;
  previewSourceUrl.textContent = '查看原' + (resource.type === 'image' ? '图' : '文件');

  previewOverlay.style.display = '';
}

function closePreview(): void {
  previewOverlay.style.display = 'none';
  previewImage.src = '';
}

// ---- Download ----

async function downloadSelected(): Promise<void> {
  if (state.selectedIds.size === 0) return;

  const resources = getCurrentResources();
  const selected = resources.filter((r) => state.selectedIds.has(r.id));

  const message: BackgroundMessage = {
    type: 'DOWNLOAD',
    resources: selected,
  };

  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        alert('下载请求失败: ' + chrome.runtime.lastError.message);
        return;
      }
      alert(`已提交 ${selected.length} 个文件下载`);
    });
  } catch (err) {
    alert('下载请求失败: ' + String(err));
  }
}

// ---- Event Handlers ----

// Tab switching
typeTabs.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (!btn) return;

  const tabType = btn.dataset.type as TabType;
  if (!tabType) return;

  state.activeTab = tabType;
  state.selectedIds.clear();
  lastClickedIndex = -1;

  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');

  renderGrid();
});

// Filter changes
typeFilter.addEventListener('change', () => {
  state.typeFilter = typeFilter.value;
  state.selectedIds.clear();
  renderGrid();
});

sizeFilter.addEventListener('input', () => {
  const val = sizeFilter.value.trim();
  if (!val) {
    state.sizeFilter = { minWidth: 0, minHeight: 0, minSize: 0 };
    renderGrid();
    return;
  }

  // Parse size filter: "100x100", "10KB", "1MB", etc.
  const dimMatch = val.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (dimMatch) {
    state.sizeFilter.minWidth = parseInt(dimMatch[1], 10);
    state.sizeFilter.minHeight = parseInt(dimMatch[2], 10);
    renderGrid();
    return;
  }

  const sizeMatch = val.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)$/i);
  if (sizeMatch) {
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    const multipliers: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    state.sizeFilter.minSize = Math.round(num * (multipliers[unit] || 1024));
    state.sizeFilter.minWidth = 0;
    state.sizeFilter.minHeight = 0;
    renderGrid();
    return;
  }

  // Just a number = bytes
  const plainNum = parseInt(val, 10);
  if (!isNaN(plainNum)) {
    state.sizeFilter.minSize = plainNum;
    state.sizeFilter.minWidth = 0;
    state.sizeFilter.minHeight = 0;
    renderGrid();
  }
});

// Select all / deselect
selectAllBtn.addEventListener('click', selectAll);
deselectAllBtn.addEventListener('click', deselectAll);

// Download
downloadSelectedBtn.addEventListener('click', downloadSelected);

// Preview
previewClose.addEventListener('click', closePreview);
previewBackdrop.addEventListener('click', closePreview);

// ---- Keyboard Shortcuts ----

document.addEventListener('keydown', (e) => {
  // Don't intercept if typing in an input
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLSelectElement
  ) {
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
    }
    return;
  }

  switch (e.key) {
    case 'Escape':
      closePreview();
      state.selectedIds.clear();
      lastClickedIndex = -1;
      refreshGridSelections();
      updateSelectionBar();
      break;

    case 'a':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        selectAll();
      }
      break;

    case 'Delete':
    case 'Backspace':
      state.selectedIds.clear();
      lastClickedIndex = -1;
      refreshGridSelections();
      updateSelectionBar();
      break;

    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
      e.preventDefault();
      navigateGrid(e.key);
      break;

    case ' ':
      e.preventDefault();
      toggleFocusedCard();
      break;

    case 'Enter':
      e.preventDefault();
      downloadSelected();
      break;
  }
});

function navigateGrid(key: string): void {
  const resources = getCurrentResources();
  if (resources.length === 0) return;

  let newIndex: number;
  if (lastClickedIndex < 0) {
    newIndex = 0;
  } else {
    switch (key) {
      case 'ArrowRight': newIndex = Math.min(lastClickedIndex + 1, resources.length - 1); break;
      case 'ArrowLeft': newIndex = Math.max(lastClickedIndex - 1, 0); break;
      case 'ArrowDown': newIndex = Math.min(lastClickedIndex + 4, resources.length - 1); break;
      case 'ArrowUp': newIndex = Math.max(lastClickedIndex - 4, 0); break;
      default: return;
    }
  }

  lastClickedIndex = newIndex;
  state.selectedIds.clear();
  state.selectedIds.add(resources[newIndex].id);
  refreshGridSelections();
  updateSelectionBar();

  // Scroll into view
  const card = mediaGrid.querySelector(
    `[data-index="${newIndex}"]`
  ) as HTMLElement | null;
  card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleFocusedCard(): void {
  if (lastClickedIndex < 0) return;
  const resources = getCurrentResources();
  if (lastClickedIndex >= resources.length) return;

  const id = resources[lastClickedIndex].id;
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  refreshGridSelections();
  updateSelectionBar();
}

// ---- Helpers ----

function formatSize(bytes: number): string {
  if (bytes === 0) return '未知';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDimensions(r: MediaResource): string {
  if (r.width && r.height) return `${r.width}×${r.height}`;
  if (r.width) return `${r.width}px`;
  return r.extension.toUpperCase().replace('.', '') || '?';
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- Start ----
init();
