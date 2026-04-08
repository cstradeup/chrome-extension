import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export interface SteamStore {
    token?: string;
    steam_id?: string | null;
    updated_at?: number;
    profile_part?: string | null;
    /** ISO-8601 date string of when the account was created (e.g. '2011-05-21T23:00:00.000Z') */
    memberSince?: string | null;
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

export async function saveMemberSince(memberSince: Date | string): Promise<void> {
    const oldStore = await getStore();
    const iso = typeof memberSince === 'string' ? memberSince : memberSince.toISOString();
    return gStore.setWithStorage(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN, {
        ...oldStore,
        memberSince: iso,
    } as SteamStore);
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

/**
 * Soft-clears the stored Steam access token while preserving identity
 * metadata (steam_id, memberSince, profile_part).  Unlike
 * `clearAccessTokenFromStorage` which nukes the entire key, this only
 * removes the auth credential so the extension can detect the session
 * is gone and re-show onboarding.
 *
 * Called automatically when the `steamLoginSecure` cookie expires or
 * is removed.
 */
export async function invalidateToken(): Promise<void> {
    const oldStore = await getStore();
    if (!oldStore?.token) return; // Already invalidated, no-op

    return gStore.setWithStorage(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN, {
        ...oldStore,
        token: undefined,
        updated_at: Date.now(),
    } as SteamStore);
}

export function getStore(): Promise<SteamStore | null> {
    return gStore.getWithStorage<SteamStore>(chrome.storage.local, StorageKey.STEAM_ACCESS_TOKEN);
}


