// ---------------------------------------------------------------------------
// Media Scraper Extension — type-safe message passing
// ---------------------------------------------------------------------------

import type { MediaResource, ScrapeResult } from '@media-scraper/core';

export type { MediaResource, ScrapeResult };

// ---------------------------------------------------------------------------
// Popup → Content Script
// ---------------------------------------------------------------------------

export type PopupMessage =
  | { type: 'START_SCRAPE'; url: string }
  | { type: 'STOP_SCRAPE' }
  | { type: 'GET_HISTORY' }
  | { type: 'PLAY_VIDEO'; url: string };

// ---------------------------------------------------------------------------
// Content Script → Background / Popup
// ---------------------------------------------------------------------------

export type ContentMessage =
  | { type: 'SCRAPE_PROGRESS'; found: number; total?: number }
  | { type: 'FOUND_MEDIA'; items: MediaResource[]; phase: string }
  | { type: 'SCRAPE_COMPLETE'; total: number }
  | { type: 'SCRAPE_ERROR'; error: string };

// ---------------------------------------------------------------------------
// Content Script / Panel → Background
// ---------------------------------------------------------------------------

export type BackgroundMessage =
  | { type: 'DOWNLOAD'; resources: MediaResource[] }
  | { type: 'FETCH_THUMBNAIL'; url: string }
  | { type: 'FETCH_VIDEO_SIZE'; url: string }
  | { type: 'CLEAR_CACHE' };

// ---------------------------------------------------------------------------
// Background → Extension Pages (popup; panel removed — sidebar is in-page)
// ---------------------------------------------------------------------------

export type PanelMessage =
  | { type: 'DOWNLOAD_COMPLETE'; count: number; failed: string[] }
  | { type: 'DOWNLOAD_PROGRESS'; completed: number; total: number };

// ---------------------------------------------------------------------------
// Union of all message types
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | PopupMessage
  | ContentMessage
  | BackgroundMessage
  | PanelMessage;
