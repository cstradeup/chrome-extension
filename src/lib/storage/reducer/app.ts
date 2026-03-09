import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';
import {syncBadge} from '../../badge';

export type AppStatus = 'idle' | 'updating_inventory' | 'updating_history' | 'stopping' | 'error' | 'warning';

export interface AppState {
    lastInventoryUpdate: number;
    lastHistoryUpdate: number;
    syncedInventoryItems: number;
    syncedTradeupItems: number;
    syncedStorageUnitItems: number;
    statusMessage: string;
    status: AppStatus;
    operationStartedAt: number;
    notarizedTradeupItems: number;
}

const DEFAULT_APP_STATE: AppState = {
    lastInventoryUpdate: 0,
    lastHistoryUpdate: 0,
    syncedInventoryItems: 0,
    syncedTradeupItems: 0,
    syncedStorageUnitItems: 0,
    statusMessage: 'Idle',
    status: 'idle',
    operationStartedAt: 0,
    notarizedTradeupItems: 0,
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

    const isStarting = oldState.status === 'idle' && status !== 'idle' && status !== 'error';
    const isStopping = oldState.status !== 'idle' && (status === 'idle' || status === 'error' || status === 'warning');

    const newState: AppState = {
        ...oldState,
        status,
        statusMessage: message,
        operationStartedAt: isStarting ? Date.now() : isStopping ? 0 : oldState.operationStartedAt,
    };

    syncBadge(status);
    return saveAppState(newState);
}

export async function updateSyncedInventoryItems(count: number): Promise<void> {
    if (isNaN(count) || count < 0) {
        throw new Error('Invalid count for synced inventory items');
    }

    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        syncedInventoryItems: count,
        lastInventoryUpdate: Date.now(),
    };

    return saveAppState(newState);
}

export async function updateSyncedTradeupItems(count: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        syncedTradeupItems: count,
        lastHistoryUpdate: Date.now(),
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

export async function updateNotarizedTradeupItems(count: number): Promise<void> {
    const oldState = await getAppState();

    const newState: AppState = {
        ...oldState,
        notarizedTradeupItems: count,
    };

    return saveAppState(newState);
}