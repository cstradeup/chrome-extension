import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export interface SteamStore {
    token?: string;
    steam_id?: string | null;
    updated_at?: number;
    profile_part?: string | null;
}


export async function storeAccessToken(token: string): Promise<void> {
    const steamID = extractSteamID(token);

    if (!token || !steamID) {
        throw new Error('user is not logged into the expected steam account');
    }

    try {
        await saveAccessToken(token, steamID);
    } catch (e) {
        console.error('failed to save access token to storage', e);
    }

}

function extractSteamID(token: string|null): string | null {
    
    const [steamId] = token?.split('%7C%7C') || token?.split('||') || [];

    if (!steamId || Number.isNaN(Number(steamId))) {
        return null;
    }

    return steamId;
}

export async function saveAccessToken(token: string, steamID: string | null): Promise<void> {

    const oldStore = await getStore()

    // Explicitly use local storage to prevent issues with sync storage quota or connectivity issues
    return gStore.setWithStorage(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN, {
        ...oldStore,
        token,
        steam_id: steamID,
        updated_at: Date.now(),
    } as SteamStore);
}

export async function updateProfilePart(profilePart: string | null): Promise<void> {
    const oldStore = await getStore()

    // Explicitly use local storage to prevent issues with sync storage quota or connectivity issues
    return gStore.setWithStorage<SteamStore>(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN, {
        ...oldStore,
        profile_part: profilePart,
    });
}

export function clearAccessTokenFromStorage(): Promise<void> {
    return gStore.removeWithStorage(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN);
}

export function getStore(): Promise<SteamStore | null> {
    return gStore.getWithStorage<SteamStore>(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN);
}


