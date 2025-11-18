// content_script.js
// Runs in the page, has access to DOM and can fetch with the user's cookies.

import { InventoryResponse, isTypePayloadMessage, PayloadMessage, CSTradeUpMessage } from "../lib/app";
import { ActionPostApi } from "../lib/comms/runtime";
import { findSteamID } from "../lib/steam";

/* (async function() {
  // When the script loads, attempt an auto crawl if conditions are met.
  try {
    // Only proceed if this is an inventory page (simple heuristic)
    if (location.pathname.includes('/inventory') || location.pathname.match(/\/profiles\/[0-9]{5,}\/?/)) {
      // load settings
      chrome.storage.local.get({
        apiUrl: '',
        pairs: '730:2',
        autoCrawl: false,
        cooldown: 2
      }, async (settings) => {
        if (settings.autoCrawl && settings.apiUrl) {
          // Only run on explicit inventory pages to avoid random profile loads
          if (isInventoryPage()) {
            try {
              await attemptedAutoCrawl(settings);
            } catch (err) {
              console.warn('Auto crawl failed:', err);
            }
          }
        }
      });
    }
  } catch (e) {
    console.error('Auto-init error', e);
  }
})(); */

/* chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'START_CRAWL') {
    console.log('Content script received START_CRAWL', msg);

    crawlAndSend(msg.pairs, msg.apiUrl)
      .then((summary) => sendResponse({ message: 'Crawl finished', summary }))
      .catch((err) => sendResponse({ message: 'Crawl failed: ' + err.message }));
    return true; // respond asynchronously
  }
}); */

function isInventoryPage() {
  // Heuristic: path contains /inventory or query contains inventory
  return location.pathname.includes('/inventory') || location.href.includes('/inventory/');
}

async function attemptedAutoCrawl(settings: any) {
  // Determine steamid
  const steamid = findSteamID();
  if (!steamid) {
    console.warn('AutoCrawl: could not determine steamid64');
    return;
  }

  // Build key for cooldown checking
  const pairsKey = encodeURIComponent((settings.pairs || '').replace(/\s+/g, ''));
  const lastCrawlKey = `lastCrawl_${steamid}_${pairsKey}`;

  // check last crawl timestamp
  chrome.storage.local.get([lastCrawlKey], async (res) => {
    const last = res[lastCrawlKey] || 0;
    const now = Date.now();
    const cooldownMs = Math.max(0, (parseInt(settings.cooldown, 10) || 0) * 1000);
    if (now - last < cooldownMs) {
      console.log('AutoCrawl: skipped due to cooldown');
      return;
    }
    // update last crawl timestamp immediately to avoid races
    const upd:any = {};
    upd[lastCrawlKey] = now;
    chrome.storage.local.set(upd, async () => {
      // execute crawl
      try {
        const summary = await crawlAndSend(settings.pairs, settings.apiUrl, steamid);
        console.log('AutoCrawl completed', summary);
      } catch (err) {
        console.error('AutoCrawl error', err);
        // on error, clear the lastCrawl so retries can happen sooner
        chrome.storage.local.remove(lastCrawlKey);
      }
    });
  });
}

async function crawlAndSend(pairsCsv: string, apiUrl: string, providedSteamid: string | null = null) {
  const pairs = parsePairs(pairsCsv);
  const steamid = providedSteamid || findSteamID();
  if (!steamid) throw new Error('Could not determine steamid64 from this page. Open numeric profile URL (https://steamcommunity.com/profiles/<steamid>/) for best results.');

  const results:Record<string, InventoryResponse> = {};
  for (const { appid, contextid } of pairs) {
    try {
      const inv = await fetchInventory(steamid, appid, contextid);
      results[`${appid}:${contextid}`] = inv;
    } catch (err: any) {
      console.error("Error geting inventory context ",contextid,": ", err)
    }
  }

  // Send inventory data to background to POST to your API (avoids CORS)
  return ActionPostApi(steamid, results)
}

function parsePairs(csv: string) {
  // csv like "730:2,440:2"
  if (!csv) return [];
  return csv.split(',').map(s => {
    const p = s.trim().split(':').map(x => x.trim());
    return { appid: p[0], contextid: p[1] || '2' };
  }).filter(p => p.appid);
}

async function fetchInventory(steamid: string, appid: string, contextid: string) : Promise<InventoryResponse> {
  // Steam inventory JSON endpoint:
  // https://steamcommunity.com/inventory/<steamid>/<appid>/<contextid>?l=english&count=5000
  const url = `https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}?l=english&count=75`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    throw new Error(`Inventory fetch failed: ${r.status} ${r.statusText}`);
  }

  const json = await r.json(); // contains assets, descriptions, more
  
  // todo: pagina rest of pages with last_assetid
  
  return json;
}
