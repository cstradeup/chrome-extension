// crawl_inventory_history.ts
// Content script: crawl the Steam inventory history page, collect JSON, send to background.

import { notarizeSteamRequestAndSendToBackend } from "../background/offscreen/notarize/notarize";

/**
 * Configuration
 */
const CONFIG = {
  maxScrolls: 60,            // maximum number of "load more" iterations to avoid infinite loops
  scrollDelayMs: 1200,      // wait after scroll for new nodes to load (adjust as needed)
  mutationTimeoutMs: 8000,  // how long to wait for new nodes before assuming done
  sendChunkSize: 200        // if extremely large, optionally chunk payloads (not used by default)
};

type InventoryHistoryEntry = {
  id?: string;
  timestamp?: string;       // ISO or raw string if parsing fails
  action?: string;          // e.g. "Traded", "Sold", "Added", etc.
  itemName?: string;
  itemLink?: string | null;
  itemImage?: string | null;
  otherUser?: string | null; // other party in trade/sale
  price?: string | null;     // textual price if present
  rawHtml?: string;         // raw node HTML for debugging/backup
};

type InventoryHistoryPayload = {
  profileUrl: string;
  crawledAt: string;
  entries: InventoryHistoryEntry[];
  meta?: {
    scrollsPerformed: number;
    pageUrl: string;
  };
};

/**
 * Utility: sleep
 */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find candidate history item nodes on the page.
 * This function uses multiple selectors to be tolerant across small DOM changes.
 */
function collectHistoryNodes(): Element[] {
  const nodes: Element[] = [];

  // Common patterns observed (fallbacks)
  // - Steam might append rows with classes/id; we try a few selectors
  const selectors = [
    '#history_rows .history_item',            // hypothetical
    '.inventoryhistory_page .historyRow',     // hypothetical
    '.inventory_history_row',                 // hypothetical
    '[id^="history_item_"]',                  // nodes with id prefix
    '.tradehistory_row',                      // alternate naming
    '.history_row'                            // generic
  ];

  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => nodes.push(el));
    } catch (err) {
      // ignore selector errors
    }
  }

  // If we found nothing, fallback to searching for list items inside main inventory history container
  if (nodes.length === 0) {
    // Try to find a container that looks like inventory history
    const fallbacks = [
      document.querySelector('#inventory_history'),
      document.querySelector('#inventory_history_rows'),
      document.querySelector('#historyRows'),
      document.querySelector('div#inventoryhistory'),
      document.querySelector('div.inventoryhistory')
    ];
    for (const container of fallbacks) {
      if (!container) continue;
      container.querySelectorAll('div, li, tr').forEach((el) => {
        // heuristics: must contain a date/time or item link or image
        const t = el.textContent || '';
        if (t.match(/\b(?:AM|PM|\d{1,2}:\d{2})\b/) || el.querySelector('a') || el.querySelector('img')) {
          nodes.push(el);
        }
      });
      if (nodes.length > 0) break;
    }
  }

  // last resort: query all nodes and pick those that look like history (very broad)
  if (nodes.length === 0) {
    document.querySelectorAll('div, li').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (text.length > 30 && /steam/i.test(location.hostname || '') ) {
        // cheap heuristic to avoid grabbing tiny nodes
        if (text.match(/\d{1,2}:\d{2}/) || text.match(/received|sent|trade|sold|bought|added/i)) {
          nodes.push(el);
        }
      }
    });
  }

  // Deduplicate and return
  return Array.from(new Set(nodes));
}

/**
 * Parse a single DOM node into an InventoryHistoryEntry.
 * This uses robust selectors and fallbacks. You will likely want to tweak selectors
 * to the exact Steam structure in your account.
 */
function parseHistoryNode(node: Element): InventoryHistoryEntry {
  const entry: InventoryHistoryEntry = {
    rawHtml: node.outerHTML
  };

  // Attempt to extract an id
  try {
    const idAttr = (node as HTMLElement).id;
    if (idAttr) entry.id = idAttr;
  } catch (e) {}

  // Attempt to find timestamp text (common formats)
  const timeCandidates = Array.from(node.querySelectorAll('time, .time, .history_time, .date, .timestamp'));
  if (timeCandidates.length > 0) {
    entry.timestamp = (timeCandidates[0].getAttribute('datetime') || timeCandidates[0].textContent || '').trim();
  } else {
    // try to regex from text
    const txt = (node.textContent || '').trim();
    const m = txt.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/);
    if (m) entry.timestamp = m[0];
  }

  // Action (verb) heuristics
  const text = (node.textContent || '').trim();
  const actionMatch = text.match(/\b(traded|sold|bought|received|sent|added|transferred)\b/i);
  if (actionMatch) entry.action = actionMatch[0];

  // Item name and link: search for anchor tags with titles or links to market or item pages
  const anchors = Array.from(node.querySelectorAll('a'));
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const title = (a.getAttribute('title') || a.textContent || '').trim();
    // heuristics: item links often point to '/market/listings/' or '/profiles/' or contain '/static/'
    if (title && title.length > 0 && /item|listing|market|inventory|Steam/.test(href) || title.length > 3) {
      if (!entry.itemName) {
        entry.itemName = title;
        entry.itemLink = href ? new URL(href, location.href).toString() : null;
      }
    }
  }

  // If no anchor matched, try to pull from some spans
  if (!entry.itemName) {
    const itemSpan = node.querySelector('.item_name, .history_item_name, .market_name');
    if (itemSpan) entry.itemName = (itemSpan.textContent || '').trim();
  }

  // Image (if present)
  const img = node.querySelector('img');
  if (img) {
    entry.itemImage = (img.getAttribute('src') || img.getAttribute('data-src') || '').trim() || null;
  }

  // Other user involved
  const userAnchor = anchors.find(a => (a.getAttribute('href') || '').includes('/profiles/') || (a.getAttribute('href') || '').includes('/id/'));
  if (userAnchor) {
    entry.otherUser = (userAnchor.textContent || '').trim();
  }

  // Price / value heuristics
  const priceMatch = text.match(/(\$|€|£)\s?\d+(?:\.\d{1,2})?/);
  if (priceMatch) entry.price = priceMatch[0];

  return entry;
}

/**
 * Aggregate parse over a node list.
 */
function parseNodes(nodes: Element[]): InventoryHistoryEntry[] {
  // Simple mapping + filter; keep only entries that have at least some data
  const entries = nodes.map(parseHistoryNode).filter(e => !!(e.itemName || e.timestamp || e.rawHtml));
  return entries;
}

/**
 * Scroll-and-wait crawler:
 * - scrolls to bottom
 * - waits for new nodes (via MutationObserver or timeout)
 * - repeats until no more new nodes or maxScrolls reached
 */
async function crawlUntilComplete(): Promise<{ entries: InventoryHistoryEntry[]; scrolls: number }> {
  const seenOuterHTML = new Set<string>();
  let lastCount = 0;
  let scrolls = 0;
  let stableIterations = 0;

  // Initial collect
  let nodes = collectHistoryNodes();
  for (const n of nodes) seenOuterHTML.add(n.outerHTML);

  // Helper to wait for DOM changes
  const waitForMutation = (timeoutMs: number) => {
    return new Promise<boolean>((resolve) => {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length > 0) {
            obs.disconnect();
            resolve(true);
            return;
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  };

  // Loop: scroll and wait for new nodes
  while (scrolls < CONFIG.maxScrolls) {
    scrolls++;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });

    // Wait a bit for Steam to kick off loading
    const changed = await waitForMutation(CONFIG.mutationTimeoutMs);

    // Give any JS a bit more time to render nodes
    await wait(CONFIG.scrollDelayMs);

    nodes = collectHistoryNodes();

    const newNodes = nodes.filter(n => !seenOuterHTML.has(n.outerHTML));
    if (newNodes.length > 0) {
      // mark as seen
      newNodes.forEach(n => seenOuterHTML.add(n.outerHTML));
      stableIterations = 0;
    } else {
      stableIterations++;
    }

    // Terminate if we have had a few successive iterations with no new nodes
    if (stableIterations >= 2) break;
  }

  // Final parse of everything seen
  const finalNodes = Array.from(seenOuterHTML).map(html => {
    // Recreate an element to parse using parseHistoryNode (since we stored outerHTML)
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild as Element;
  }).filter(Boolean);

  const entries = parseNodes(finalNodes);
  return { entries, scrolls };
}

/**
 * Send compiled inventory history payload to background
 */
function sendToBackground(payload: InventoryHistoryPayload): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'INVENTORY_HISTORY', payload }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('sendMessage error:', chrome.runtime.lastError.message);
      }
      resolve(resp);
    });
  });
}

/**
 * Public entry: crawl, parse, and send
 */
export async function crawlInventoryHistoryAndSend() {
  try {
    const profileUrl = location.href;
    const startedAt = new Date().toISOString();
    console.log('[cstradeup] Starting inventory history crawl at', startedAt);

    const { entries, scrolls } = await crawlUntilComplete();

    const payload: InventoryHistoryPayload = {
      profileUrl,
      crawledAt: startedAt,
      entries,
      meta: {
        scrollsPerformed: scrolls,
        pageUrl: profileUrl
      }
    };

    console.log('[cstradeup] Crawled entries count:', entries.length);

    // Send to background for POST (background will do the network request to avoid CORS)
    const resp = await sendToBackground(payload);
    console.log('[cstradeup] background response:', resp);
    return resp;
  } catch (err) {
    console.error('[cstradeup] crawl failed:', err);
    throw err;
  }
}

/**
 * Optional: run automatically if script is executed on the inventoryhistory page.
 * If you prefer a manual trigger, remove this auto-run and call crawlInventoryHistoryAndSend() from a popup or devtools UI.
 */
(async () => {
  // Only auto-run if we detect inventoryhistory in the URL (safe-guard)
 
    try {
      // slight delay so page initializations finish
      //await wait(800);
      // You can comment out the auto-run if you prefer manual control
      //await crawlInventoryHistoryAndSend();

      const params = {
        ajax: '1',
        'cursor[time]': '1762787852',
        'cursor[time_frac]': '0',
        'cursor[s]': '0',
        sessionid: '1cff4eee8daedd2b7d1aa464',
        'app[]': '730',
      }

      const resp = await notarizeSteamRequestAndSendToBackend()

      console.log("Notarize response: ", resp)

    } catch (e) {
      console.error('auto crawl failed', e);
    }
  
})();
