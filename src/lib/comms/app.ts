export async function ActionAddAppSyncedTradeupItems(amount: number) {
    // Send log message to background
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'ADD_APP_SYNCED_TRADEUP_ITEMS', amount }, (resp) => {
            resolve(resp);
        });
    });
}

export async function ActionAddAppSyncedStorageUnitItems(amount: number) {
    // Send log message to background
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'ADD_APP_SYNCED_STORAGE_UNIT_ITEMS', amount }, (resp) => {
            resolve(resp);
        });
    });
}