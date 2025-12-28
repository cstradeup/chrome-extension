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
import { getAppState, updateStatus, updateSyncedInventoryItems } from "./lib/storage/reducer/app";

const APP_ID = "730";

const HOSTNAME = "http://localhost:3000";
const UPADTE_INVENTORY_ROUTE = "/account/inventory/extension";
const apiUrl = `${HOSTNAME}${UPADTE_INVENTORY_ROUTE}`;
const pairs = `${APP_ID}:2,${APP_ID}:16`;

async function LoadInterceptedInventory() {

  const steamData = await getStore();

  const tab = await findSteamTab(`https://steamcommunity.com/${steamData?.profile_part}/inventory#${APP_ID}`);

  if (!tab || !tab.id) {
    // !!! masive error, no tab, not inventory page
    console.error("No Steam tab found or tab ID is missing.");
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
    console.error("No inventory data found in the Steam tab.");
    return false;
  }

  const itemCount = Object.keys(dataResults.result).reduce(
    (acc, key) => acc + dataResults?.result?.[key].assets.length, // TODO: take in account quantity
    0
  );

  const steamId = findSteamID();
  if (steamId) await ActionPostApi(steamId, dataResults.result as any);

  updateSyncedInventoryItems(itemCount);

  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("start");
  const startInventoryHistoryBtn = document.getElementById(
    "start_inventory_history"
  );

  const nukeStorageBtn = document.getElementById("nuke_storage");

  const logsEl = document.getElementById("logs");
  const clearLogs = document.getElementById("clear_logs");
  
  const debugEl = document.getElementById("debug");
  const showDebugBtn = document.getElementById("show_debug");

  const openOptionsBtn = document.getElementById("open_options");
  const devtoolsModal = document.getElementById("devtools");

  const closeDevtoolsBtn = document.getElementById("close_devtools");


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
  });

  
 startBtn &&
    startBtn.addEventListener("click", async () => {
      const tab = await findOrCreateSteamTab();

      if (!tab || !tab.id) {
        return;
      }

      await LoadInterceptedInventory();
    });

  startInventoryHistoryBtn &&
    startInventoryHistoryBtn.addEventListener("click", async () => {

      const steamData = await getStore()
      const cstradeupSteamData = await cstradeupAccessToken()
      
      cstradeupSteamData && steamData && await ActionStartInventoryHistorySync(
        steamData.steam_id ?? null,
        steamData.token ?? null,
        cstradeupSteamData.auth ?? null,
      );

    });

  LoadInterceptedInventory();
});


async function loadAppStatus() {
  const statusEl = document.getElementById("app_status");
  const statusMessageEl = document.getElementById("app_status_message");
  const inventoryLastUpdatedEl = document.getElementById("inventory_last_updated");
  const inventoryHistoryLastUpdatedEl = document.getElementById("inventory_history_last_updated");
  const inventoryHistoryupdatedUntilEl = document.getElementById("inventory_history_updated_until");
  
  const startInventoryHistoryBtn = document.getElementById(
    "start_inventory_history"
  ) as HTMLButtonElement;
  const startBtn = document.getElementById("start") as HTMLButtonElement;

  const appState = await getAppState();
  const cstradeupSteamData = await cstradeupAccessToken()
  
  if (appState.status == 'updating_history') {
    startInventoryHistoryBtn.disabled = true;
  } else  {
    startInventoryHistoryBtn.disabled = false;
  }

  if (appState.status == 'updating_inventory') {
    startBtn.disabled = true;
  } else  {
    startBtn.disabled = false;
  }


  if (statusEl && appState) {
    statusEl.textContent = appState.status;
    statusMessageEl && (statusMessageEl.textContent = appState.statusMessage);
  }

  if (inventoryLastUpdatedEl && appState.lastInventoryUpdate) {
    inventoryLastUpdatedEl.textContent = timeDifference(Date.now(), appState.lastInventoryUpdate);
  }

  if (inventoryHistoryLastUpdatedEl && appState.lastHistoryUpdate) {
    inventoryHistoryLastUpdatedEl.textContent = timeDifference(Date.now(), appState.lastHistoryUpdate);
  }

  if (inventoryHistoryupdatedUntilEl && cstradeupSteamData?.history_cursor) {
    // add to inventoryHistoryupdatedUntilEl.textContent the converted unix timestamp from cstradeupSteamData.history_cursor.time
    const cursorTime = cstradeupSteamData.history_cursor.time;
    inventoryHistoryupdatedUntilEl.textContent = new Date(cursorTime * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      /* hour: '2-digit',
      minute: '2-digit',
      hour12: true */
    });


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
        const formatedLogs = devLogs.logs
          .map(
            (entry) =>
              `[${new Date(entry.timestamp).toLocaleTimeString()}] ${
                entry.message
              }`
          )
          .join("\n");


          if (formatedLogs !== logsEl.textContent) {
            logsEl.textContent = formatedLogs;
            logsEl.scrollTop = logsEl.scrollHeight;
          }
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
cstradeup_access_token: ${cstradeupSteamData ? cstradeupSteamData.auth : 'not set'}
profile_part: ${steamData ? steamData.profile_part : 'not set'}`;
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
