// background.js (service worker)

import {
  isApiPostPayload,
  isAppStateUpdate,
  isEnsureMemberSince,
  isInventoryPayload,
  isLogMessage,
  isNotarizeCursorPayload,
  isOffscreenPayloadMessage,
  isStartInventoryHistoryPayload,
  isStopOperationPayload,
  isUpdateCursor,
  MessageType,
  PayloadMessage,
} from "../lib/app";
import { hasPermission } from "../lib/permission";
import {
  getAppState,
  updateNotarizedTradeupItems,
  updateStatus,
  updateSyncedInventoryItems,
  updateSyncedStorageUnitItems,
  updateSyncedTradeupItems,
} from "../lib/storage/reducer/app";
import { getStore, saveMemberSince } from "../lib/storage/reducer/steam";
import { appendDevLog } from "../lib/storage/reducer/logs";
import { loadInventoryHistory, requestStop } from "./services/notary";
import { getStore as getCstradeupStore, saveHistoryCursor } from "../lib/storage/reducer/cstradeup";
import { SteamAccountAge } from "./offscreen/user/badges";
import { syncBadge } from "../lib/badge";
import { CSTRADEUP_HOSTNAME } from "../lib/env";
const HOSTNAME = CSTRADEUP_HOSTNAME;
const UPDATE_INVENTORY_ROUTE = "/account/inventory/extension/update";
const INVENTORY_HISTORY_ROUTE = "/account/inventory/extension/history";


// Initialize badge to match persisted app state on service worker startup
getAppState().then(state => syncBadge(state.status));
chrome.runtime.onMessage.addListener(
  (msg: MessageType, sender, sendResponse) => {

    if (isApiPostPayload(msg)) {
      (async () => {
        try {
          const resp = await postToApi(UPDATE_INVENTORY_ROUTE, {
            steamId: msg.steamId,
            results: msg.results,
          });

          try {
            const respJson = await resp.json();

            if (respJson.total) {
              await updateSyncedInventoryItems(respJson.total);
            }
          } catch (e) {
            console.error("Failed to parse API response as JSON:", e);
          }

          sendResponse({ ok: resp.ok });
        } catch (e) {
          console.error("API post error:", e);
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true; // keep port open for async sendResponse
    }

    if (isStartInventoryHistoryPayload(msg)) {
      loadInventoryHistory(msg);
      return; // fire-and-forget, no sendResponse needed
    }

    if (isStopOperationPayload(msg)) {
      const stopped = requestStop();
      updateStatus("stopping", "Stopping…").then(() => {
        sendResponse({ ok: stopped });
      });
      return true; // keep port open
    }

    if (isLogMessage(msg)) {
      appendDevLog(msg.message);
      return; // fire-and-forget
    }

    if (isUpdateCursor(msg)) {
      saveHistoryCursor(msg.cursor);
      return; // fire-and-forget
    }

    if (isAppStateUpdate(msg)) {
      const { status, statusMessage } = msg;
      updateStatus(status, statusMessage);
      return; // fire-and-forget
    }

    if (isEnsureMemberSince(msg)) {
      ensureMemberSince().then((ok) => sendResponse({ ok }));
      return true; // keep port open
    }

    if (isNotarizeCursorPayload(msg)) {
      handleNotarizeCursor(msg.cursor).then(sendResponse);
      return true; // keep port open
    }

    if (isOffscreenPayloadMessage(msg)) {
      (async () => {
        if (msg.type === "ADD_APP_SYNCED_TRADEUP_ITEMS") {
          const appState = await getAppState();
          const newCount = appState.syncedTradeupItems + msg.amount;
          await updateSyncedTradeupItems(newCount);
        }

        if (msg.type === "ADD_APP_SYNCED_STORAGE_UNIT_ITEMS") {
          const appState = await getAppState();
          const newCount = appState.syncedStorageUnitItems + msg.amount;
          await updateSyncedStorageUnitItems(newCount);
        }

        if (msg.type === "ADD_NOTARIZED_TRADEUP_ITEMS") {
          const appState = await getAppState();
          const newCount = appState.notarizedTradeupItems + msg.amount;
          await updateNotarizedTradeupItems(newCount);
        }
      })();
      return; // fire-and-forget
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

// ---------------------------------------------------------------------------
// On-demand notarization (triggered by website frontend)
// ---------------------------------------------------------------------------

/**
 * Resolves the Steam profile URL by following redirects (custom URL → canonical).
 */
async function resolveProfileBaseUrl(steamId: string, token: string): Promise<string> {
  const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
  const cookie = `steamLoginSecure=${encodeURIComponent(token)}`;

  try {
    const response = await fetch(profileUrl, {
      method: "HEAD",
      credentials: "include",
      headers: { Cookie: cookie },
      redirect: "follow",
    });
    const finalUrl = new URL(response.url);
    const pathParts = finalUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
      return `${finalUrl.origin}/${pathParts[0]}/${pathParts[1]}`;
    }
    return `${finalUrl.origin}${finalUrl.pathname}`.replace(/\/$/, "");
  } catch {
    return profileUrl;
  }
}

import { Cursor } from "../lib/storage/reducer/cstradeup";

async function handleNotarizeCursor(
  cursor: Cursor,
): Promise<{ success: boolean; crafted?: number; error?: string }> {
  try {
    // 1. Resolve credentials from extension storage
    const steamStore = await getStore();
    const cstradeupStore = await getCstradeupStore();

    if (!steamStore?.token || !steamStore?.steam_id) {
      return { success: false, error: "Steam session not found. Please log in to Steam." };
    }

    if (!cstradeupStore?.auth) {
      return { success: false, error: "CSTRADEUP auth token not found. Please log in." };
    }

    // 2. Resolve Steam profile URL
    const profileBaseUrl = await resolveProfileBaseUrl(steamStore.steam_id, steamStore.token);

    // 3. Open offscreen document and forward request
    await openOffscreenDocument();

    const resp = await chrome.runtime.sendMessage({
      type: "notarize-cursor",
      target: "offscreen",
      profileBaseUrl,
      token: steamStore.token,
      auth: cstradeupStore.auth,
      cursor,
    });

    // Handle WASM restart signal (same pattern as existing notarization)
    if (resp?.shouldShutdown) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        await chrome.offscreen.closeDocument();
      }
    }

    if (!resp?.success) {
      return { success: false, error: resp?.error ?? "Notarization failed" };
    }

    return { success: true, crafted: resp.crafted };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[CSTRADEUP] handleNotarizeCursor error:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

let creating: Promise<void> | null = null;

export async function openOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
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

      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Workers for multi-threading",
      });

      await ready;
    })();
    await creating;
    creating = null;
  }
}

// ---------------------------------------------------------------------------
// Ensure memberSince is populated — safe to call repeatedly
// ---------------------------------------------------------------------------

/**
 * Loads the Steam account creation date ("Member since") and persists it.
 *
 * The function is idempotent: if `memberSince` is already stored for the
 * current `steam_id`, it returns immediately.  This allows it to be called
 * from many trigger points (install, startup, token change, popup recheck)
 * without redundant network requests.
 *
 * @param force  When `true`, re-fetch even if a value is already stored.
 *               Useful when the Steam user has changed.
 * @returns `true` if `memberSince` is now available, `false` otherwise.
 */
async function ensureMemberSince(force = false): Promise<boolean> {
  try {
    await openOffscreenDocument();

    const steamData = await getStore();

    if (!steamData?.steam_id || !steamData?.token) {
      return false;
    }

    // Skip fetch when we already have a value for the current user
    if (!force && steamData.memberSince) {
      return true;
    }

    const resp = await chrome.runtime.sendMessage({
      type: "load-account-age",
      target: "offscreen",
      steamId: steamData.steam_id,
      token: steamData.token,
    });

    if (resp?.success && typeof resp.age === "object") {
      const { memberSince } = resp.age as SteamAccountAge;
      await saveMemberSince(memberSince);
      return true;
    }

    console.warn("ensureMemberSince: fetch failed for", steamData.steam_id);
    return false;
  } catch (e) {
    console.error("ensureMemberSince: unexpected error", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle listeners
// ---------------------------------------------------------------------------

// Extension installed or updated
chrome.runtime.onInstalled.addListener(async () => {
  await ensureMemberSince();
});

// Browser / profile restart (service worker wakes up)
chrome.runtime.onStartup.addListener(async () => {
  await ensureMemberSince();
});

// ---------------------------------------------------------------------------
// React to Steam token changes — covers the case where the user signs in to
// Steam *after* the extension was installed.  Also handles user switches:
// when steam_id changes we force-refresh memberSince.
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (!("steam_access_token" in changes)) return;

  const prev = changes["steam_access_token"].oldValue as
    | { steam_id?: string; memberSince?: string }
    | undefined;
  const next = changes["steam_access_token"].newValue as
    | { steam_id?: string; memberSince?: string }
    | undefined;

  if (!next?.steam_id) return; // logged out — nothing to do

  // Different user → force refresh
  const userChanged = prev?.steam_id !== next.steam_id;
  await ensureMemberSince(userChanged);
});
