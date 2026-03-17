import { ApiPostPayload, InventoryPayload, InventoryResponse, LogMessage, NotarizeCursorPayload, StartInventoryHistoryPayload, StopOperationPayload } from "../app";
import { Cursor } from "../storage/reducer/cstradeup";

export async function ActionPostApi(steamId: string, results: Record<string, InventoryResponse>) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<ApiPostPayload>({ type: 'POST_TO_API', steamId, results }, (resp) => {
            resolve({ steamId, posted: resp?.ok === true });
        });
    });
}

export async function ActionInventoryHistory(steamId: string, payload: unknown) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<InventoryPayload>({ type: 'INVENTORY_HISTORY', steamId, payload }, (resp) => {
            resolve({ steamId, posted: resp?.ok === true });
        });
    });
}

export async function ActionStartInventoryHistorySync(steamId: string | null, token: string | null, auth: string | null) {
    // Send inventory data to background to POST to API (avoids CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<StartInventoryHistoryPayload>({ type: 'START_INVENTORY_HISTORY', steamId, token, auth }, (resp) => {
            resolve({ posted: resp?.ok === true });
        });
    });
}

export async function ActionStopOperation() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<StopOperationPayload>({ type: 'STOP_OPERATION' }, (resp) => {
            resolve({ stopped: resp?.ok === true });
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

/**
 * Ask the service worker to ensure `memberSince` is populated in the Steam store.
 * Safe to call repeatedly — it no-ops if the value is already present.
 */
export async function ActionEnsureMemberSince(): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'ENSURE_MEMBER_SINCE' }, (resp) => {
            resolve(resp ?? { ok: false });
        });
    });
}

/**
 * Ask the service worker to notarize a specific inventory history cursor.
 * Used by the website frontend to validate individual tradeups on demand.
 */
export async function ActionNotarizeCursor(cursor: Cursor): Promise<{ success: boolean; crafted?: number; error?: string }> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage<NotarizeCursorPayload>({ type: 'NOTARIZE_CURSOR', cursor }, (resp) => {
            resolve(resp ?? { success: false, error: 'No response from service worker' });
        });
    });
}