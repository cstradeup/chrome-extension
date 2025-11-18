// background.js (service worker)

import {
  isApiPostPayload,
  isInventoryPayload,
  isStartInventoryHistoryPayload,
  MessageType,
  PayloadMessage,
} from "../lib/app";
import { notarizeSteamRequestAndSendToBackend } from "./offscreen/notarize/notarize";
import { hasPermission } from "../lib/permission";
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
      console.log("START INVENTORY HISTORY SYNC RECEIVED");

      const granted = await hasPermission([], ["https://steamcommunity.com/*"]);

      if (!granted) {
        throw new Error(
          "must have steamcommunity.com permissions in order to prove API requests"
        );
      }
      await openOffscreenDocument();

      const existingContexts = await chrome.runtime.getContexts({});

      const offscreenDocument = existingContexts.find(
        (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
      );


      console.log("created offscreen document", offscreenDocument)
      
      await chrome.runtime.sendMessage({
        type: 'load-inventory-history',
        target: 'offscreen',
      });

      console.log("Sent 'load-inventory-history' to offscreen")

      return true;
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
