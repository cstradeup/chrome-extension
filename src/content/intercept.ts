/**
 * intercept.ts — Runs in the MAIN world (page JS context).
 *
 * Because MAIN-world scripts have NO access to chrome.runtime,
 * we relay intercepted data to the ISOLATED-world content script
 * via window.postMessage().  The content script then forwards it
 * to the service-worker over the normal extension messaging channel.
 *
 * Steam paginates inventory responses with `more_items: 1` and
 * `last_assetid`.  This script accumulates all pages for each
 * context before relaying the merged, complete inventory.
 */

const APP_ID = '730';                       // CS2 app id (inline to avoid importing extension modules)
// @ts-ignore
const CHANNEL = '__CSTRADEUP_INVENTORY__';  // unique key so no other extension/page collides

const INVENTORY_PATH_SEGMENT = '/inventory/';
const LANGUAGE_QUERY = '?l=english';
const JSON_SEGMENT = '/json/';

// ---------- helpers ----------

interface InventoryResponseLike {
  success: boolean;
  total_inventory_count?: number;
  more_items?: number;          // 1 when more pages are available
  last_assetid?: string;        // cursor for next page
  assets?: any[];
  descriptions?: any[];
  asset_properties?: any[];
  [k: string]: any;
}

function getContextIdFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr, location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

function isSteamInventoryUrl(urlStr: string): boolean {
  return (
    urlStr.includes(INVENTORY_PATH_SEGMENT) &&
    urlStr.includes(LANGUAGE_QUERY) &&
    !urlStr.includes(JSON_SEGMENT)
  );
}

function findSteamID(): string | null {
  try {
    const m = location.pathname.match(/\/profiles\/([0-9]{15,20})/);
    if (m) return m[1];

    const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
    if (og) {
      const mm = og.match(/\/profiles\/([0-9]{15,20})/);
      if (mm) return mm[1];
    }

    const html = document.documentElement.innerHTML;
    let mm2 = html.match(/g_steamID\s*=\s*"([0-9]{15,20})"/);
    if (mm2) return mm2[1];
    mm2 = html.match(/"steamid"\s*:\s*"([0-9]{15,20})"/);
    if (mm2) return mm2[1];
  } catch (err) {
    console.warn('[CSTRADEUP] findSteamID error', err);
  }
  return null;
}

// ---------- pagination accumulator ----------

/**
 * Accumulates paginated inventory responses per context.
 *
 * Steam sends pages with `more_items: 1` until the last page.
 * We collect every page, merge assets + dedup descriptions,
 * and only relay once the context is complete (or a safety
 * timeout fires).
 */
class InventoryAccumulator {
  /** Queued pages per contextAppId (e.g. "730:2") */
  private pages = new Map<string, InventoryResponseLike[]>();

  /** Safety-timeout handles per context */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Contexts that have been fully accumulated and relayed */
  readonly completed = new Set<string>();

  /** How long (ms) to wait for the next page before force-relaying */
  private static TIMEOUT_MS = 15_000;

  /**
   * Feed an intercepted page into the accumulator.
   *
   * @param contextAppId  e.g. "730:2"
   * @param data          the raw response for one page
   * @param onComplete    called with the merged inventory when done
   */
  addPage(
    contextAppId: string,
    data: InventoryResponseLike,
    onComplete: (contextAppId: string, merged: InventoryResponseLike) => void,
  ): void {
    if (this.completed.has(contextAppId)) return;

    // Clear any existing safety timeout for this context
    const prev = this.timers.get(contextAppId);
    if (prev) clearTimeout(prev);

    // Store the page
    const pages = this.pages.get(contextAppId) ?? [];
    pages.push(data);
    this.pages.set(contextAppId, pages);

    if (data.more_items) {
      // More pages expected — arm a safety timeout
      const timer = setTimeout(() => {
        this.finalize(contextAppId, onComplete);
      }, InventoryAccumulator.TIMEOUT_MS);
      this.timers.set(contextAppId, timer);
    } else {
      // Last page — merge and relay immediately
      this.finalize(contextAppId, onComplete);
    }
  }

  // ---- internal ----

  private finalize(
    contextAppId: string,
    onComplete: (contextAppId: string, merged: InventoryResponseLike) => void,
  ): void {
    const timer = this.timers.get(contextAppId);
    if (timer) clearTimeout(timer);
    this.timers.delete(contextAppId);

    const pages = this.pages.get(contextAppId);
    this.pages.delete(contextAppId);
    if (!pages || pages.length === 0) return;

    this.completed.add(contextAppId);
    const merged = InventoryAccumulator.mergePages(pages);
    onComplete(contextAppId, merged);
  }

  /**
   * Merge multiple paginated responses into one complete response.
   * Assets are concatenated; descriptions are deduped by classid+instanceid.
   */
  private static mergePages(pages: InventoryResponseLike[]): InventoryResponseLike {
    if (pages.length === 1) {
      // Single page — just strip pagination markers
      const single = { ...pages[0] };
      delete single.more_items;
      delete single.last_assetid;
      return single;
    }

    const first = pages[0];

    // Concatenate all assets
    const allAssets: any[] = [];
    for (const p of pages) {
      if (Array.isArray(p.assets)) allAssets.push(...p.assets);
    }

    // Dedup descriptions by classid + instanceid
    const descMap = new Map<string, any>();
    for (const p of pages) {
      if (!Array.isArray(p.descriptions)) continue;
      for (const desc of p.descriptions) {
        const key = `${desc.classid}_${desc.instanceid ?? '0'}`;
        if (!descMap.has(key)) descMap.set(key, desc);
      }
    }

    const allProperties: any[] = [];
    for (const p of pages) {
      if (Array.isArray(p.asset_properties)) allProperties.push(...p.asset_properties);
    }

    const merged: InventoryResponseLike = {
      success: first.success,
      total_inventory_count: first.total_inventory_count,
      assets: allAssets,
      descriptions: Array.from(descMap.values()),
      asset_properties: allProperties,
    };

    return merged;
  }
}

// ---------- relay to isolated-world content script ----------

/**
 * Post inventory data to the ISOLATED-world content script via
 * window.postMessage.  The content script validates the channel key
 * and forwards it to the background service-worker.
 */
function relayInventoryData(
  steamId: string,
  contextAppId: string,
  data: InventoryResponseLike,
): void {
  window.postMessage(
    {
      channel: CHANNEL,
      type: 'INTERCEPTED_INVENTORY',
      steamId,
      contextAppId,
      data,
    },
    location.origin,          // targetOrigin — only same origin
  );
}

// ---------- central accumulator instance ----------

const accumulator = new InventoryAccumulator();

/**
 * Called for every intercepted inventory page (fetch or XHR).
 * Feeds the page into the accumulator, which merges and relays
 * only when the full inventory for a context is ready.
 */
function handleInterceptedPage(
  contextAppId: string,
  data: InventoryResponseLike,
  source: string,
): void {
  if (!data || !data.success) return;

  accumulator.addPage(contextAppId, data, (ctxId, merged) => {

    const steamId = findSteamID();
    if (steamId) {
      relayInventoryData(steamId, ctxId, merged);
    } else {
      // SteamID not available yet — wait for DOMContentLoaded and retry
      const handler = () => {
        const id = findSteamID();
        if (id) relayInventoryData(id, ctxId, merged);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handler, { once: true });
      } else {
        // DOM already loaded but no ID found — last-resort short delay
        setTimeout(handler, 1500);
      }
    }
  });
}

// ---------- Fetch interceptor ----------

function installFetchInterceptor(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let urlStr: string;
    if (typeof input === 'string') urlStr = input;
    else if (input instanceof Request) urlStr = input.url;
    else urlStr = String(input);

    if (isSteamInventoryUrl(urlStr)) {
      const contextId = getContextIdFromUrl(urlStr);
      if (contextId != null) {
        const contextAppId = `${APP_ID}:${contextId}`;
        if (!accumulator.completed.has(contextAppId)) {
          const response = await originalFetch(input, init);
          try {
            const cloned = response.clone();
            const data: InventoryResponseLike = await cloned.json();
            handleInterceptedPage(contextAppId, data, 'fetch');
          } catch (err) {
            console.debug('[CSTRADEUP] Failed to parse fetch inventory response:', err);
          }
          return response;
        }
      }
    }

    return originalFetch(input, init);
  };
}

// ---------- XHR interceptor ----------

function installXHRInterceptor(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url?: string | URL | null, ...rest: any[]) {
    try {
      (this as any)._cstradeup_url =
        typeof url === 'string' ? url :
        url instanceof URL ? url.toString() :
        undefined;
    } catch { /* ignore */ }
    return originalOpen.apply(this, arguments as any);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ..._args: any[]) {
    try {
      const urlOnInstance: string | undefined = (this as any)._cstradeup_url;
      if (typeof urlOnInstance === 'string' && isSteamInventoryUrl(urlOnInstance)) {
        const contextId = getContextIdFromUrl(urlOnInstance);
        if (contextId != null) {
          const contextAppId = `${APP_ID}:${contextId}`;
          if (!accumulator.completed.has(contextAppId)) {
            this.addEventListener('load', function () {
              try {
                const text = this.responseText;
                if (!text) return;
                const parsed: InventoryResponseLike = JSON.parse(text);
                handleInterceptedPage(contextAppId, parsed, 'XHR');
              } catch (err) {
                console.debug('[CSTRADEUP] Failed to parse XHR inventory response:', err);
              }
            }, { once: true });
          }
        }
      }
    } catch (err) {
      console.debug('[CSTRADEUP] XHR interceptor error:', err);
    }

    return originalSend.apply(this, arguments as any);
  } as typeof XMLHttpRequest.prototype.send;
}

// ---------- bootstrap ----------

installFetchInterceptor();
installXHRInterceptor();
console.debug('[CSTRADEUP] MAIN-world interceptors installed (with pagination support)');