import { isLogMessage, MessageType, SteamInventoryDataPayload } from "./lib/app";
import {
  ActionInventoryHistory,
  ActionPostApi,
  ActionStartInventoryHistorySync,
} from "./lib/comms/runtime";
import { findOrCreateSteamTab, findSteamID, findSteamTab } from "./lib/steam";
import { storeAccessToken, getStore } from "./lib/storage/reducer/steam";
import {
  storeAccessToken as cstradeupStoreAccessToken,
  getStore as cstradeupAccessToken,
} from "./lib/storage/reducer/cstradeup";
import { isRunningOffscreen, timeDifference } from "./lib/utils";
import { getDevLogs } from "./lib/storage/reducer/logs";
import { getAppState, updateStatus } from "./lib/storage/reducer/app";

const APP_ID = "730";

const HOSTNAME = "http://localhost:3000";
const UPADTE_INVENTORY_ROUTE = "/account/inventory/extension";
const apiUrl = `${HOSTNAME}${UPADTE_INVENTORY_ROUTE}`;
const pairs = `${APP_ID}:2,${APP_ID}:16`;

async function LoadInterceptedInventory() {
  const tab = await findSteamTab();

  if (!tab || !tab.id) {
    // !!! masive error, no tab, not inventory page
    return false;
  }

  const [dataResults] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (): SteamInventoryDataPayload => {
      const windowProxy: any = window;
      return windowProxy.__steamInventoryData;
    },
  });

  if (!dataResults.result) {
    return false;
  }
  console.log("dataResults.result", dataResults.result);

  const steamId = findSteamID();
  if (steamId) await ActionPostApi(steamId, dataResults.result as any);

  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  const lastUpdatedEl = document.getElementById("lastUpdated");
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("start");
  const startInventoryHistoryBtn = document.getElementById(
    "start_inventory_history"
  );
  const statusInventoryHistoryEl = document.getElementById(
    "status_inventory_history"
  );
  const nukeStorageBtn = document.getElementById("nuke_storage");

  const logsEl = document.getElementById("logs");
  const clearLogs = document.getElementById("clear_logs");
  
  const debugEl = document.getElementById("debug");
  const showDebugBtn = document.getElementById("show_debug");

  const openOptionsBtn = document.getElementById("open_options");
  const devtoolsModal = document.getElementById("devtools");

  const closeDevtoolsBtn = document.getElementById("close_devtools");

  const totalItemsEl = document.getElementById("total_items");
  const tradeupItemsEl = document.getElementById("tradeup_items");
  const storeageUnitItemsEl = document.getElementById("storeage_unit_items");
  
  closeDevtoolsBtn?.addEventListener("click", () => {
      devtoolsModal && (devtoolsModal.style.display = 'none');
  });

  openOptionsBtn?.addEventListener("click", () => {
      devtoolsModal && (devtoolsModal.style.display = 'block');
  });

  clearLogs?.addEventListener("click", async () => {
    
    if (logsEl) {
      await chrome.storage.local.remove('dev_logs');
      logsEl.textContent = '';
    }
  });

  showDebugBtn?.addEventListener("click", async () => {
    if (debugEl) {
      debugEl.style.display = debugEl.style.display === 'block' ? 'none' : 'block';
    }
  });

  nukeStorageBtn?.addEventListener("click", async () => {
    await chrome.storage.local.clear();
    alert("Storage cleared");
  });

  
 startBtn &&
    startBtn.addEventListener("click", async () => {
      const tab = await findOrCreateSteamTab();

      if (!tab || !tab.id) {
        // !!! masive error, no tab
        return;
      }

      if (await LoadInterceptedInventory()) {
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        {
          type: "START_CRAWL",
          apiUrl,
          pairs,
        },
        (response) => {
          if (!statusEl) return;

          if (chrome.runtime.lastError) {
            statusEl.textContent =
              "No content script in this tab or not a Steam page.";
            return;
          }
          statusEl.textContent = response?.message || "Started.";
          
          if (response?.summary) {
            console.log("Crawl summary:", response.summary);
          }
        }
      );
    });

  startInventoryHistoryBtn &&
    startInventoryHistoryBtn.addEventListener("click", async () => {

      const steamData = await getStore()
      const cstradeupSteamData = await cstradeupAccessToken()
      
      statusInventoryHistoryEl &&
        (statusInventoryHistoryEl.textContent =
          "Starting inventory history sync");

      cstradeupSteamData && steamData && await ActionStartInventoryHistorySync(
        steamData.steam_id,
        steamData.token,
        cstradeupSteamData.auth ?? null,
      );

      statusInventoryHistoryEl &&
        (statusInventoryHistoryEl.textContent = "Inventory history synced");
    });

  LoadInterceptedInventory();
});

async function loadAppStatus() {
  const statusEl = document.getElementById("app_status");
  const statusMessageEl = document.getElementById("app_status_message");
  const appState = await getAppState();

  if (statusEl && appState) {
    statusEl.textContent = appState.status;
    statusMessageEl && (statusMessageEl.textContent = appState.statusMessage);
  }
}

async function updateStatusCounts() {
  const appState = await getAppState();

  const totalItemsEl = document.getElementById("total_items");
  const tradeupItemsEl = document.getElementById("tradeup_items");
  const storeageUnitItemsEl = document.getElementById("storeage_unit_items");

  if (totalItemsEl && appState) {
    totalItemsEl.textContent = appState.syncedInventoryItems?.toString();
  }

  if (tradeupItemsEl && appState) {
    tradeupItemsEl.textContent = appState.syncedTradeupItems?.toString();
  }

  if (storeageUnitItemsEl && appState) {
    storeageUnitItemsEl.textContent = appState.syncedStorageUnitItems?.toString();
  }
}

async function loadDevLogs() {
  const logsEl = document.getElementById("logs");

  getDevLogs().then((devLogs) => {
      if (logsEl && devLogs) {
        logsEl.textContent = devLogs.logs
          .map(
            (entry) =>
              `[${new Date(entry.timestamp).toLocaleTimeString()}] ${
                entry.message
              }`
          )
          .join("\n");
          logsEl.scrollTop = logsEl.scrollHeight;
      }
    });
}

async function loadDevStoreData() {
  const debugEl = document.getElementById("debug");
  const steamData = await getStore();
    const cstradeupSteamData = await cstradeupAccessToken();
    
    if (debugEl) {
      debugEl.textContent = `steam_access_token: ${steamData ? steamData.token : 'not set'}
steam_id: ${steamData ? steamData.steam_id : 'not set'}
cstradeup_access_token: ${cstradeupSteamData ? cstradeupSteamData.auth : 'not set'}`;
    }
}

(async () => {
  
 
  chrome.cookies.getAll(
    { domain: "steamcommunity.com", name: "steamLoginSecure" },
    async (cookies) => {
      if (cookies.length > 0) {
        await storeAccessToken(cookies[0].value);
      }
    }
  );

  chrome.cookies.getAll(
    { domain: "localhost", name: "auth" },
    async (cookies) => {
      if (cookies.length > 0) {
        await cstradeupStoreAccessToken(cookies[0].value);
      }
    }
  );


  await loadDevLogs();
  await loadDevStoreData();
  await loadAppStatus();
  await updateStatusCounts();
  setInterval(async () => {

    await loadDevLogs();
    await loadDevStoreData();
    await loadAppStatus();
    await updateStatusCounts();
  }, 1000);

  if (!(await isRunningOffscreen())) {
    await updateStatus("idle", "Time to choose...");
  }

  console.log("Popup initialized", await getAppState());

})();
