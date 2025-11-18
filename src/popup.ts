import { SteamInventoryDataPayload } from "./lib/app";
import { ActionInventoryHistory, ActionPostApi, ActionStartInventoryHistorySync } from "./lib/comms/runtime";
import { findOrCreateSteamTab, findSteamID, findSteamTab } from "./lib/steam";
import { timeDifference } from "./lib/utils";

const APP_ID = "730"

const HOSTNAME = "http://localhost:3000"
const UPADTE_INVENTORY_ROUTE = "/account/inventory/extension" 
const apiUrl = `${HOSTNAME}${UPADTE_INVENTORY_ROUTE}`
const pairs = `${APP_ID}:2,${APP_ID}:16`

async function LoadInterceptedInventory() {
  const tab = await findSteamTab()

    if (!tab || !tab.id){
      // !!! masive error, no tab, not inventory page
      return false;
    }

    const [dataResults] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () : SteamInventoryDataPayload => {
        const windowProxy:any = window; 
        return windowProxy.__steamInventoryData;
      }
    });

    if (!dataResults.result) {
      return false
    }
    console.log("dataResults.result", dataResults.result)

    const steamId = findSteamID()
    if(steamId)
      await ActionPostApi(steamId, dataResults.result as any)

    return true;
}

document.addEventListener('DOMContentLoaded', () => {

  const lastUpdatedEl = document.getElementById('lastUpdated');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('start');
  const startInventoryHistoryBtn = document.getElementById('start_inventory_history');
  const statusInventoryHistoryEl = document.getElementById('status_inventory_history');

  // Load saved values
  chrome.storage.local.get({
    lastUpdated: 0
  }, ({lastUpdated}) => {
    lastUpdatedEl && (lastUpdatedEl.textContent = timeDifference(Date.now(), lastUpdated))
  });

  // Save inputs when changed
  function saveLastUpdate() {
    chrome.storage.local.set({ lastUpdated: Date.now() });
    lastUpdatedEl && (lastUpdatedEl.textContent = timeDifference(Date.now(), Date.now()))
  }

  startBtn && startBtn.addEventListener('click', async () => {

    const tab = await findOrCreateSteamTab()

    if (!tab || !tab.id){
      // !!! masive error, no tab 
      return;
    }

    if(await LoadInterceptedInventory()){
      return;
    }
    
    chrome.tabs.sendMessage(tab.id, {
      type: 'START_CRAWL',
      apiUrl,
      pairs
    }, (response) => {
      if (!statusEl) return;

      if (chrome.runtime.lastError) {
        statusEl.textContent = 'No content script in this tab or not a Steam page.';
        return;
      }
      statusEl.textContent = response?.message || 'Started.';
      saveLastUpdate();
      if (response?.summary) {
        console.log('Crawl summary:', response.summary);
      }
    });
  });

  startInventoryHistoryBtn && startInventoryHistoryBtn.addEventListener('click', async () => {
    statusInventoryHistoryEl && (statusInventoryHistoryEl.textContent = 'Starting inventory history sync');
    await ActionStartInventoryHistorySync()
    statusInventoryHistoryEl && (statusInventoryHistoryEl.textContent = 'Inventory history synced');

  });

  LoadInterceptedInventory()

});
