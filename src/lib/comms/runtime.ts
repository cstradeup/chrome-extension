import { ApiPostPayload, InventoryPayload, InventoryResponse, StartInventoryHistoryPayload } from "../app";

export async function ActionPostApi(steamId: string, results: Record<string, InventoryResponse>) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<ApiPostPayload>({ type: 'POST_TO_API', steamId, results }, (resp) => {
            console.log('ActionPostApi Background response:', resp);
            resolve({ steamId, posted: resp?.ok === true });
        });
    });
}

export async function ActionInventoryHistory(steamId: string, payload: unknown) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<InventoryPayload>({ type: 'INVENTORY_HISTORY', steamId, payload }, (resp) => {
            console.log('ActionInventoryHistory Background response:', resp);
            resolve({ steamId, posted: resp?.ok === true });
        });
    });
}

export async function ActionStartInventoryHistorySync() {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<StartInventoryHistoryPayload>({ type: 'START_INVENTORY_HISTORY', }, (resp) => {
            console.log('ActionStartInventoryHistorySync Background response:', resp);
            resolve({ posted: resp?.ok === true });
        });
    });
}