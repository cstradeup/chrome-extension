// background.js (service worker)

import {
  isApiPostPayload,
  isAppStateUpdate,
  isInventoryPayload,
  isLogMessage,
  isOffscreenPayloadMessage,
  isStartInventoryHistoryPayload,
  isUpdateCursor,
  MessageType,
  PayloadMessage,
} from "../lib/app";
import { hasPermission } from "../lib/permission";
import { getAppState, updateStatus, updateSyncedStorageUnitItems, updateSyncedTradeupItems } from "../lib/storage/reducer/app";
import { saveHistoryCursor } from "../lib/storage/reducer/cstradeup";
import { appendDevLog } from "../lib/storage/reducer/logs";
import { loadInventoryHistory } from "./services/notary";
const HOSTNAME = "http://localhost:3000";
const UPDATE_INVENTORY_ROUTE = "/account/inventory/extension/update";
const INVENTORY_HISTORY_ROUTE = "/account/inventory/extension/history";



console.log("background loaded");
chrome.runtime.onMessage.addListener(
  async (msg: MessageType, sender, sendResponse) => {
    console.log("CALLED BACKGROUD!! ", msg);
    if (isApiPostPayload(msg)) {
      postToApi(UPDATE_INVENTORY_ROUTE, {
        steamId: msg.steamId,
        results: msg.results,
      })
        .then((res) => {
          sendResponse({ ok: true, status: res.status });
        })
        .catch((err) => {
          console.error("POST error", err);
          sendResponse({ ok: false, error: err.message });
        });
      return true; // async
    }

    if (isInventoryPayload(msg)) {
      /* postToApi(INVENTORY_HISTORY_ROUTE,{ payload: msg.payload,})
      .then(res => {
        sendResponse({ ok: true, status: res.status });
      })
      .catch(err => {
        console.error('POST error', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async */
      openOffscreenDocument();
    }

    if (isStartInventoryHistoryPayload(msg)) {
      await loadInventoryHistory(msg)

      return true;
    }

    if (isLogMessage(msg)) {
      await appendDevLog(msg.message);
      return true;
    }

    if (isUpdateCursor(msg)) {
      saveHistoryCursor(msg.cursor)
      return true;
    }

    if (isAppStateUpdate(msg)) {
      const { status, statusMessage } = msg;
      
      updateStatus(status, statusMessage);
      return true;
    }

    if(isOffscreenPayloadMessage(msg)) {

      if (msg.type === 'ADD_APP_SYNCED_TRADEUP_ITEMS') {

        const appState = await getAppState()
        const newCount = appState.syncedTradeupItems + msg.amount

        await updateSyncedTradeupItems(newCount);
        return true
      }

      if (msg.type === 'ADD_APP_SYNCED_STORAGE_UNIT_ITEMS') {
        // update synced storage unit items count
        const appState = await getAppState()
        const newCount = appState.syncedStorageUnitItems + msg.amount

        await updateSyncedStorageUnitItems(newCount);
        return true
      }

    }

  }
);

async function postToApi(route: string, payload: unknown) {
  // Minimal POST. Add auth headers if needed.
  const resp = await fetch(`${HOSTNAME}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp;
}

const OFFSCREEN_DOCUMENT_PATH =
  "offscreen.html";

let creating: Promise<void> | null = null;

export async function openOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({});

  const offscreenDocument = existingContexts.find(
    (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
  );

   if (!offscreenDocument && !creating) {
    // Create an offscreen document.
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['WORKERS'],
      justification: 'Create offscreen document for inventory history processing',
    });
  }

  if (creating) {
    await creating;
    creating = null;
  }

  /* const offscreenUrl = chrome.runtime.getURL(
    LOAD_INVENTORY_HISTORY_DOCUMENT_PATH
  );
  const hasExistingContext = await chrome.offscreen.hasDocument();
  if (hasExistingContext) {
    return;
  }
  if (creating) {
    await creating;
  } else {
    creating = (async () => {
      const ready = new Promise<void>((resolve) => {
        const listener = (
          request: any,
          sender: chrome.runtime.MessageSender
        ) => {
          if (
            request?.type === "offscreen_ready" &&
            sender.url === offscreenUrl
          ) {
            chrome.runtime.onMessage.removeListener(listener);
            resolve();
          }
        };
        chrome.runtime.onMessage.addListener(listener);
      });
      try {
        await chrome.offscreen.createDocument({
          url: LOAD_INVENTORY_HISTORY_DOCUMENT_PATH,
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: "LoadInventoryHistory Workers for multi-threading",
        });
      } catch (e) {
        console.error("Failed to create offscreen document", e);
      }

      await ready;
      console.log("Offscreen document ready");
    })();
    await creating;
    creating = null;
  } */
}
