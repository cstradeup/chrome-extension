import { ApiPostPayload, InventoryPayload, InventoryResponse, LogMessage, StartInventoryHistoryPayload } from "../app";

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

export async function ActionStartInventoryHistorySync(steamId: string | null, token: string | null, auth: string | null) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<StartInventoryHistoryPayload>({ type: 'START_INVENTORY_HISTORY', steamId, token, auth }, (resp) => {
            console.log('ActionStartInventoryHistorySync Background response:', resp);
            resolve({ posted: resp?.ok === true });
        });
    });
}

export async function ActionLogMessage(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    // Send log message to background
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<LogMessage>({ type: 'LOG_MESSAGE', message, level }, (resp) => {
            resolve(resp);
        });
    });
}

export async function ActionUpdateCursor(cursor: Record<string, any>) {
    // Send log message to background
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'UPDATE_CURSOR', cursor }, (resp) => {
            resolve(resp);
        });
    });
}

export async function ActionUpdateAppState(status: string, statusMessage: string) {
    // Send log message to background
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'UPDATE_APP_STATE', status, statusMessage }, (resp) => {
            resolve(resp);
        });
    });
}