import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export type Cursor = {
  time: number,
  time_frac: number,
  s: string,
}

export interface CSTradeUpStore {
    auth?: string;
    updated_at?: number;
    history_cursor?: Cursor;
}

export async function saveHistoryCursor(cursor: Cursor): Promise<void> {
    const oldStore = await getStore()

    // Explicitly use local storage to prevent issues with sync storage quota or connectivity issues
    return gStore.setWithStorage<CSTradeUpStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN, {
        ...oldStore,
        history_cursor: cursor,
    });
}

export async function storeAccessToken(auth: string): Promise<void> {

    const oldStore = await getStore()

    // Explicitly use local storage to prevent issues with sync storage quota or connectivity issues
    return gStore.setWithStorage<CSTradeUpStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN, {
        ...oldStore,
        auth,
        updated_at: Date.now(),
    });
}

export function clearAccessTokenFromStorage(): Promise<void> {
    return gStore.removeWithStorage(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN);
}

export async function getStore(): Promise<CSTradeUpStore | null> {
    return gStore.getWithStorage<CSTradeUpStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN);
}


