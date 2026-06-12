// ---------------------------------------------------------------------------
// Media Scraper Extension — Background Service Worker
// ---------------------------------------------------------------------------
// Handles download orchestration and thumbnail proxy for cross-origin images.
// Popup handles all UI; content script only scrapes and sends results.
// ---------------------------------------------------------------------------

import type { MediaResource } from '@media-scraper/core';
import type {
  PopupMessage,
  ContentMessage,
  BackgroundMessage,
  PanelMessage,
  ExtensionMessage,
} from '../utils/messages.js';

// ---- Thumbnail Cache ----

const MAX_CACHE_ENTRIES = 50;
const thumbnailCache = new Map<string, { dataUrl: string; timestamp: number }>();

function getCachedThumbnail(url: string): string | null {
  const entry = thumbnailCache.get(url);
  if (entry && Date.now() - entry.timestamp < 30 * 60 * 1000) {
    return entry.dataUrl;
  }
  if (entry) {
    thumbnailCache.delete(url);
  }
  return null;
}

function setCachedThumbnail(url: string, dataUrl: string): void {
  if (thumbnailCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey) thumbnailCache.delete(oldestKey);
  }
  thumbnailCache.set(url, { dataUrl, timestamp: Date.now() });
}

// ---- Thumbnail Fetch (Cross-Origin Proxy) ----

async function fetchThumbnail(url: string): Promise<string | null> {
  const cached = getCachedThumbnail(url);
  if (cached) return cached;

  try {
    const response = await fetch(url, {
      headers: {
        Range: 'bytes=0-524287',
      },
    });

    if (!response.ok && response.status !== 206) {
      return null;
    }

    const blob = await response.blob();

    if (!blob.type.startsWith('image/')) {
      return null;
    }

    const dataUrl = await blobToDataUrl(blob);

    if (dataUrl) {
      setCachedThumbnail(url, dataUrl);
    }

    return dataUrl;
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string | null);
    };
    reader.onerror = () => {
      resolve(null);
    };
    reader.readAsDataURL(blob);
  });
}

// ---- Download Orchestration ----

interface DownloadJob {
  resource: MediaResource;
  retries: number;
  downloadId?: number;
}

const MAX_RETRIES = 2;
const activeDownloads = new Map<number, DownloadJob>();
const pendingDownloads: DownloadJob[] = [];

async function startDownload(resources: MediaResource[]): Promise<void> {
  let completed = 0;
  const failed: string[] = [];

  for (const resource of resources) {
    pendingDownloads.push({ resource, retries: 0 });
  }

  const concurrency = 3;
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push(processDownloadQueue(failed, () => {
      completed++;
      sendDownloadProgress(completed, resources.length);
    }));
  }

  await Promise.all(workers);

  const message: PanelMessage = {
    type: 'DOWNLOAD_COMPLETE',
    count: completed - failed.length,
    failed,
  };
  sendToAllTabs(message);
}

async function processDownloadQueue(
  failed: string[],
  onComplete: () => void,
): Promise<void> {
  while (pendingDownloads.length > 0) {
    const job = pendingDownloads.shift()!;
    const success = await downloadSingle(job);

    if (!success) {
      if (job.retries < MAX_RETRIES) {
        job.retries++;
        pendingDownloads.push(job);
      } else {
        failed.push(job.resource.filename);
      }
    }
    onComplete();
  }
}

async function downloadSingle(job: DownloadJob): Promise<boolean> {
  return new Promise((resolve) => {
    const filename = sanitizeDownloadFilename(job.resource.filename);

    chrome.downloads.download(
      {
        url: job.resource.url,
        filename: 'media-scraper/' + filename,
        saveAs: false,
        conflictAction: 'uniquify',
      },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          console.error(
            '[media-scraper] Download failed:',
            job.resource.filename,
            chrome.runtime.lastError?.message
          );
          resolve(false);
          return;
        }

        job.downloadId = downloadId;
        activeDownloads.set(downloadId, job);

        const listener = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id === downloadId && delta.state) {
            if (delta.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(listener);
              activeDownloads.delete(downloadId);
              resolve(true);
            } else if (delta.state.current === 'interrupted') {
              chrome.downloads.onChanged.removeListener(listener);
              activeDownloads.delete(downloadId);
              resolve(false);
            }
          }
        };
        chrome.downloads.onChanged.addListener(listener);

        setTimeout(() => {
          chrome.downloads.onChanged.removeListener(listener);
          if (activeDownloads.has(downloadId)) {
            activeDownloads.delete(downloadId);
            resolve(false);
          }
        }, 300000);
      }
    );
  });
}

function sanitizeDownloadFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim() || 'unknown_file';
}

function sendDownloadProgress(completed: number, total: number): void {
  const message: PanelMessage = {
    type: 'DOWNLOAD_PROGRESS',
    completed,
    total,
  };
  sendToAllTabs(message);
}

function sendToAllTabs(message: PanelMessage): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have a listener
        });
      }
    }
  });
}

// ---- Message Router ----

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    switch (message.type) {
      // ---- Popup → Content Script (log only; popup sends directly) ----
      case 'START_SCRAPE': {
        console.log('[media-scraper] Scrape started for:', message.url);
        break;
      }

      case 'STOP_SCRAPE': {
        console.log('[media-scraper] Scrape stopped');
        break;
      }

      // ---- Content Script → Popup (proxied automatically) ----
      case 'SCRAPE_PROGRESS': {
        // Popup receives this directly via runtime.onMessage; no action needed
        break;
      }

      case 'SCRAPE_ERROR': {
        console.error('[media-scraper] Scrape error:', message.error);
        break;
      }

      // ---- Content Script / Sidebar → Download ----
      case 'DOWNLOAD': {
        startDownload(message.resources).then(() => {
          sendResponse({ status: 'completed' });
        });
        return true;
      }

      // ---- Thumbnail Fetch ----
      case 'FETCH_THUMBNAIL': {
        fetchThumbnail(message.url).then((dataUrl) => {
          sendResponse({ dataUrl });
        });
        return true;
      }

      // ---- Video Size Fetch (HEAD request) ----
      case 'FETCH_VIDEO_SIZE': {
        fetch(message.url, { method: 'HEAD' })
          .then((res) => {
            const len = res.headers.get('Content-Length');
            sendResponse({ size: len ? parseInt(len, 10) : 0 });
          })
          .catch(() => sendResponse({ size: 0 }));
        return true;
      }

      // ---- Cache Management ----
      case 'CLEAR_CACHE': {
        thumbnailCache.clear();
        sendResponse({ status: 'cleared' });
        break;
      }

      // ---- History ----
      case 'GET_HISTORY': {
        chrome.storage.local.get('scrapeHistory', (result) => {
          sendResponse(result.scrapeHistory || []);
        });
        return true;
      }

      default:
        console.warn('[media-scraper] Unknown message type:', (message as { type: string }).type);
    }
    return false;
  }
);

// ---- Init ----

console.log('[media-scraper] Background service worker started');
