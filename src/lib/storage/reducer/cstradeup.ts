import {gStore} from '../../storage/store';
import {StorageKey} from '../../storage/keys';

export const DEFAULT_CURSOR: Cursor = {
    time: 0,
    time_frac: 0,
    s: '0',
}

export type Cursor = {
  time: number,
  time_frac: number,
  s: string,
}

/**
 * Cursor timeline:
 *
 *   NOW (newest)                             ACCOUNT CREATION (oldest)
 *    ←————————————————————————————————————————————→
 *         LEFT                    RIGHT
 *     (highest .time)          (lowest .time)
 *     most recent synced       oldest synced
 *
 * The crawl moves backwards: from newest → oldest.  Steam
 * returns a "next" cursor with progressively lower .time values.
 * When Steam has no more pages, it returns a terminal cursor ({0,0,0}).
 *
 * Phase of the active sync operation:
 *   - `catching_up` — syncing newest items (DEFAULT → left edge)
 *   - `historical`  — crawling into older history (right edge → Steam empty)
 *   - `null`        — no active sync
 */
export type SyncPhase = 'catching_up' | 'historical' | null;

export interface CSTRADEUPStore {
    auth?: string;
    updated_at?: number;
    /**
     * Persisted crawl cursor — the deepest (oldest) point we've crawled to.
     * Drives the idle progress bar (how far back into history we've gone).
     */
    history_cursor?: Cursor;
    /** Whether the full backwards crawl reached Steam's end (no more pages). */
    sync_completed?: boolean;
    /** Current sync phase (null when idle). */
    sync_phase?: SyncPhase;
    /** Live cursor position during active sync — updates every page. */
    sync_cursor?: Cursor | null;
    /**
     * The server's left edge (newest synced point) captured at sync start.
     * Used as the stopping boundary during the catching-up phase.
     */
    sync_left_boundary?: Cursor | null;
    /** Number of pages fetched in the current sync session. */
    sync_pages_fetched?: number | null;
    /**
     * When set, Steam returned persistent 500 errors at this cursor position,
     * indicating corrupted inventory history data on Steam's side.
     * The sync terminated early — data may be incomplete around this date.
     */
    sync_corrupted_at?: Cursor | null;
}

/** Returns true if the cursor represents "no data" / terminal position. */
export function isTerminalCursor(cursor: Cursor | null | undefined): boolean {
    if (!cursor) return true;
    // Coerce `s` to string — JSON from the server may deliver it as a number.
    const s = String(cursor.s ?? '');
    return cursor.time === 0 && cursor.time_frac === 0 && (s === '0' || s === '');
}

/**
 * Normalizes a cursor received from the server.
 * Ensures `s` is always a string (JSON may serialize it as a number).
 */
export function normalizeCursor(cursor: Cursor | null | undefined): Cursor | null {
    if (!cursor) return null;
    return { ...cursor, s: String(cursor.s ?? '0') };
}

export async function saveHistoryCursor(cursor: Cursor): Promise<void> {
    const oldStore = await getStore()

    return gStore.setWithStorage<CSTRADEUPStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN, {
        ...oldStore,
        history_cursor: cursor,
    });
}

export async function saveSyncState(update: Partial<Pick<CSTRADEUPStore, 'history_cursor' | 'sync_completed' | 'sync_phase' | 'sync_cursor' | 'sync_left_boundary' | 'sync_pages_fetched' | 'sync_corrupted_at'>>): Promise<void> {
    const oldStore = await getStore();

    return gStore.setWithStorage<CSTRADEUPStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN, {
        ...oldStore,
        ...update,
    });
}

export async function storeAccessToken(auth: string): Promise<void> {

    const oldStore = await getStore()

    // Explicitly use local storage to prevent issues with sync storage quota or connectivity issues
    return gStore.setWithStorage<CSTRADEUPStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN, {
        ...oldStore,
        auth,
        updated_at: Date.now(),
    });
}

export function clearAccessTokenFromStorage(): Promise<void> {
    return gStore.removeWithStorage(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN);
}

export async function getStore(): Promise<CSTRADEUPStore | null> {
    return gStore.getWithStorage<CSTRADEUPStore>(chrome.storage.local, StorageKey.CSTRADEUP_ACCESS_TOKEN);
}


