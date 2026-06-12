// ---------------------------------------------------------------------------
// Media Scraper Extension — Content Script (Scrape-only, no UI injection)
// ---------------------------------------------------------------------------
// Injected into web pages at document_idle.
// Builds a DocumentLike adapter from the real DOM and calls individual
// extractors in phases, streaming results to the popup via messages.
// ---------------------------------------------------------------------------

import {
  extractImages,
  extractVideos,
  extractAudio,
  extractDocuments,
  extractBackgroundImages,
  extractIframeMedia,
  extractShadowDomMedia,
} from '@media-scraper/core';
import type {
  DocumentLike,
  ElementLike,
  MediaResource,
} from '@media-scraper/core';
import type { ContentMessage, PopupMessage } from '../utils/messages.js';

// ---- DOM Adapter ----
// Wraps the real browser DOM to match the core's DocumentLike/ElementLike interfaces.

function wrapElement(el: Element): ElementLike {
  return {
    tagName: el.tagName,
    getAttribute(name: string): string | null {
      return el.getAttribute(name);
    },
    querySelectorAll(selector: string): ElementLike[] {
      const nodes = el.querySelectorAll(selector);
      const result: ElementLike[] = [];
      for (let i = 0; i < nodes.length; i++) {
        result.push(wrapElement(nodes[i]));
      }
      return result;
    },
    querySelector(selector: string): ElementLike | null {
      const node = el.querySelector(selector);
      return node ? wrapElement(node) : null;
    },
    textContent: el.textContent,
  };
}

function createDocumentAdapter(): DocumentLike {
  return {
    querySelectorAll(selector: string): ElementLike[] {
      const nodes = document.querySelectorAll(selector);
      const result: ElementLike[] = [];
      for (let i = 0; i < nodes.length; i++) {
        result.push(wrapElement(nodes[i]));
      }
      return result;
    },
    querySelector(selector: string): ElementLike | null {
      const node = document.querySelector(selector);
      return node ? wrapElement(node) : null;
    },
    title: document.title,
    head: wrapElement(document.head!),
    body: wrapElement(document.body!),
  };
}

// ---- State ----

let isScraping = false;
let abortController: AbortController | null = null;

// ---- Utility Helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Progress Messaging (to popup) ----

async function triggerLazyLoad(): Promise<void> {
  const scrollStep = window.innerHeight * 0.8;
  const maxScrolls = 20;
  let scrolls = 0;

  const originalY = window.scrollY;

  while (scrolls < maxScrolls && !abortController?.signal.aborted) {
    window.scrollBy(0, scrollStep);
    await sleep(400);
    scrolls++;

    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight) {
      break;
    }
  }

  window.scrollTo(0, originalY);
}

async function waitForNetworkIdle(timeoutMs = 3000): Promise<void> {
  const checkInterval = 300;
  const start = Date.now();
  let lastPendingCount = performance.getEntriesByType('resource').length;

  while (Date.now() - start < timeoutMs) {
    if (abortController?.signal.aborted) return;
    await sleep(checkInterval);
    const currentPending = performance.getEntriesByType('resource').length;
    if (currentPending === lastPendingCount) {
      return;
    }
    lastPendingCount = currentPending;
  }
}

// ---- MutationObserver for Dynamic Content ----

let mutationObserver: MutationObserver | null = null;

function startObservingDynamicContent(
  onNewContent: () => void,
): void {
  if (mutationObserver) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  mutationObserver = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!abortController?.signal.aborted) {
        onNewContent();
      }
    }, 500);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'data-original', 'style'],
  });
}

function stopObservingDynamicContent(): void {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

// ---- Progress Messaging (to popup) ----

function sendProgress(percent: number, total?: number): void {
  const message: ContentMessage = {
    type: 'SCRAPE_PROGRESS',
    found: percent,
    total,
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---- URL set for dedup across phases ----

class UrlSet {
  private set = new Set<string>();
  add(url: string): void { this.set.add(url); }
  has(url: string): boolean { return this.set.has(url); }
  addAll(urls: string[]): void { for (const u of urls) this.set.add(u); }
}

// ---- Safe extractor runner ----

function safeExtract(
  name: string,
  fn: (doc: DocumentLike, baseUrl: string) => MediaResource[],
  doc: DocumentLike,
  baseUrl: string,
): MediaResource[] {
  try {
    return fn(doc, baseUrl);
  } catch (err) {
    console.error(`[media-scraper] ${name} extractor failed:`, err);
    return [];
  }
}

// ---- FOUND_MEDIA sender ----

function sendFoundMedia(items: MediaResource[], phase: string): void {
  if (items.length === 0) return;
  console.log(`[media-scraper] Sending FOUND_MEDIA: phase="${phase}" count=${items.length} types=${[...new Set(items.map(i=>i.type))]}`);
  const message: ContentMessage = {
    type: 'FOUND_MEDIA',
    items,
    phase,
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---- SCRAPE_COMPLETE sender ----

function sendScrapeComplete(total: number): void {
  const message: ContentMessage = {
    type: 'SCRAPE_COMPLETE',
    total,
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---- SCRAPE_ERROR sender ----

function sendScrapeError(error: string): void {
  const message: ContentMessage = {
    type: 'SCRAPE_ERROR',
    error,
  };
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ===========================================================================
// SCRAPE ORCHESTRATION — streaming phases (no UI injection)
// ===========================================================================

async function runScrape(baseUrl: string): Promise<void> {
  if (isScraping) return;
  isScraping = true;
  abortController = new AbortController();

  let totalFound = 0;

  sendProgress(5);

  try {
    await triggerLazyLoad();
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    sendProgress(10);
    await waitForNetworkIdle(3000);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    // Create document adapter once
    const doc = createDocumentAdapter();
    const seenUrls = new Set<string>();

    // Helper: extract, dedup against seenUrls, send to popup
    async function runPhase(
      name: string,
      _phaseLabel: string,
      extractor: (doc: DocumentLike, baseUrl: string) => MediaResource[],
    ): Promise<MediaResource[]> {
      if (abortController!.signal.aborted) return [];

      const items = safeExtract(name, extractor, doc, baseUrl);
      if (abortController!.signal.aborted) return [];

      // Deduplicate against already-seen URLs
      const newItems = items.filter((r) => {
        if (seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        return true;
      });

      console.log(`[media-scraper] Phase "${name}": raw=${items.length} new=${newItems.length}`);

      if (newItems.length > 0) {
        sendFoundMedia(newItems, name);
        totalFound += newItems.length;
      }

      return newItems;
    }

    // Phase 1: Images + backgrounds + iframes
    sendProgress(25);

    await runPhase('images', '正在提取图片...', extractImages);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    await runPhase('backgrounds', '正在提取背景图片...', extractBackgroundImages);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    await runPhase('iframes', '正在提取内嵌框架...', extractIframeMedia);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    sendProgress(50);

    // Phase 2: Videos
    await runPhase('videos', '正在提取视频...', extractVideos);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    sendProgress(65);

    // Phase 3: Audio + Documents + Shadow DOM
    await runPhase('audio', '正在提取音频...', extractAudio);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    await runPhase('documents', '正在提取文档...', extractDocuments);
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    // Shadow DOM with real browser shadowRoot walking
    const walkShadowFn = (el: ElementLike): ElementLike[] => {
      const realEl = (el as unknown as { shadowRoot?: Element | null }).shadowRoot;
      if (!realEl) return [];
      return [wrapElement(realEl)];
    };
    await runPhase('shadow-dom', '正在扫描Shadow DOM...',
      (d: DocumentLike, b: string) => extractShadowDomMedia(d.body!, b, walkShadowFn));
    if (abortController.signal.aborted) { cleanupScrape(totalFound); return; }

    sendProgress(80);

    // Phase 4: Dynamic content observation (brief)
    const dynamicPromise = new Promise<void>((resolve) => {
      let dynamicScrapes = 0;
      const maxDynamicScrapes = 2;

      startObservingDynamicContent(async () => {
        if (dynamicScrapes >= maxDynamicScrapes || abortController?.signal.aborted) return;

        dynamicScrapes++;

        try {
          const newImages = safeExtract('images-dynamic', extractImages, doc, baseUrl);
          const newVideos = safeExtract('videos-dynamic', extractVideos, doc, baseUrl);
          const newAudio = safeExtract('audio-dynamic', extractAudio, doc, baseUrl);
          const newDocs = safeExtract('documents-dynamic', extractDocuments, doc, baseUrl);

          const allNew = [...newImages, ...newVideos, ...newAudio, ...newDocs];
          const uniqueNew = allNew.filter((r) => {
            if (seenUrls.has(r.url)) return false;
            seenUrls.add(r.url);
            return true;
          });

          if (uniqueNew.length > 0) {
            sendFoundMedia(uniqueNew, 'dynamic');
            totalFound += uniqueNew.length;
          }
        } catch {
          // Ignore dynamic scrape errors
        }

        if (dynamicScrapes >= maxDynamicScrapes) {
          resolve();
        }
      });

      setTimeout(() => {
        stopObservingDynamicContent();
        resolve();
      }, 3000);
    });

    await dynamicPromise;

    // Complete
    stopObservingDynamicContent();
    sendScrapeComplete(totalFound);
  } catch (err) {
    stopObservingDynamicContent();
    sendScrapeError(err instanceof Error ? err.message : String(err));
    sendScrapeComplete(totalFound);
  } finally {
    isScraping = false;
    abortController = null;
  }
}

function cleanupScrape(totalFound: number): void {
  stopObservingDynamicContent();
  sendScrapeComplete(totalFound);
  isScraping = false;
  abortController = null;
}

// ---- Message Listener ----

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_SCRAPE':
        console.log('[media-scraper] Received START_SCRAPE for:', message.url);
        if (!isScraping) {
          runScrape(message.url);
        }
        sendResponse({ status: 'started' });
        break;

      case 'STOP_SCRAPE':
        if (abortController) {
          abortController.abort();
        }
        stopObservingDynamicContent();
        isScraping = false;
        sendResponse({ status: 'stopped' });
        break;
    }
    return true;
  }
);

console.log('[media-scraper] Content script loaded (scrape-only, popup-driven UI)');
