import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export interface AppState {
    lastInventoryUpdate: number;
    lastHistoryUpdate: number;
    syncedInventoryItems: number;
    syncedTradeupItems: number;
    syncedStorageUnitItems: number;
    statusMessage: string;
    status: 'idle' | 'updating_inventory' | 'updating_history' | 'error';
}

const DEFAULT_APP_STATE: AppState = {
    lastInventoryUpdate: 0,
    lastHistoryUpdate: 0,
    syncedInventoryItems: 0,
    syncedTradeupItems: 0,
    syncedStorageUnitItems: 0,
    statusMessage: 'Idle',
    status: 'idle',
};

export async function getAppState(): Promise<AppState> {
    return await gStore.getWithStorage<AppState>(chrome.storage.local, StorageKey.APP_STATE) ?? DEFAULT_APP_STATE;
}

export async function clearAppStateFromStorage(): Promise<void> {
    return gStore.removeWithStorage(chrome.storage.local, StorageKey.APP_STATE);
}

export async function saveAppState(state: AppState): Promise<void> {
    return gStore.setWithStorage<AppState>(chrome.storage.local, StorageKey.APP_STATE, state);
}

export async function updateStatus(status: AppState['status'], message: string): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        status,
        statusMessage: message,
    };

    return saveAppState(newState);
}

export async function updateLastInventoryUpdate(timestamp: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        lastInventoryUpdate: timestamp,
    };

    return saveAppState(newState);
}

export async function updateLastHistoryUpdate(timestamp: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        lastHistoryUpdate: timestamp,
    };

    return saveAppState(newState);
}

export async function updateSyncedInventoryItems(count: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        syncedInventoryItems: count,
    };

    return saveAppState(newState);
}

export async function updateSyncedTradeupItems(count: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        syncedTradeupItems: count,
    };

    return saveAppState(newState);
}

export async function updateSyncedStorageUnitItems(count: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        syncedStorageUnitItems: count,
    };

    return saveAppState(newState);
}
