/**
 * popup.ts — Slim entry-point for the extension popup.
 *
 * Responsibilities:
 *   1. Read cookies and persist auth tokens
 *   2. Query DOM elements once
 *   3. Wire user-action handlers
 *   4. Subscribe to chrome.storage.onChanged (replaces polling)
 *   5. Run a single 1-second ticker for elapsed-time display only
 *
 * All rendering lives in popup/render.ts, all actions in popup/actions.ts.
 */

import { StorageKey } from './lib/storage/keys';
import { getAppState, updateStatus, AppState } from './lib/storage/reducer/app';
import { clearBadge } from './lib/badge';
import { getStore as getSteamStore }           from './lib/storage/reducer/steam';
import { storeAccessToken as storeSteamToken } from './lib/storage/reducer/steam';
import { getStore as getCstradeupStore }       from './lib/storage/reducer/cstradeup';
import { storeAccessToken as storeCstradeupToken } from './lib/storage/reducer/cstradeup';
import { getDevLogs }                          from './lib/storage/reducer/logs';
import { isRunningOffscreen }                  from './lib/utils';
import { checkOnboardingState }                from './lib/session';
import { CSTRADEUP_DOMAIN }                    from './lib/env';

import { queryElements }                       from './popup/elements';
import { wireActions }                         from './popup/actions';
import { renderOnboarding, renderStatus, renderCounts, renderTimestamps, renderElapsed, renderLogs, renderDebug, renderHistoryProgress, renderDevtoolsOptions } from './popup/render';
import { ActionEnsureMemberSince }             from './lib/comms/runtime';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    const els = queryElements();

    // 1. Persist auth cookies
    await persistCookies();

    // 2. Onboarding gate — block popup until both sessions are active
    const onboardingState = await checkOnboardingState();
    renderOnboarding(els, onboardingState);

    // Wire recheck buttons (always, even if hidden)
    wireRecheckButtons(els);

    if (onboardingState !== 'ready') {
        // Nothing else to do until sessions are established
        return;
    }

    // 3. Wire user-action handlers
    // Ensure memberSince is populated every time the popup opens
    ActionEnsureMemberSince();
    bootMainContent(els);
});

// ---------------------------------------------------------------------------
// Recheck buttons — re-evaluate onboarding after user signs in externally
// ---------------------------------------------------------------------------

function wireRecheckButtons(els: ReturnType<typeof queryElements>) {
    const recheck = async () => {
        await persistCookies();
        const state = await checkOnboardingState();
        renderOnboarding(els, state);

        if (state === 'ready') {
            // Ensure the service worker has memberSince for the
            // now-authenticated Steam user before booting the UI
            ActionEnsureMemberSince();
            bootMainContent(els);
        }
    };

    els.recheckSteam?.addEventListener('click', recheck);
    els.recheckCstradeup?.addEventListener('click', recheck);
}

// ---------------------------------------------------------------------------
// Boot main content — called once when onboarding is complete
// ---------------------------------------------------------------------------

let mainContentBooted = false;

async function bootMainContent(els: ReturnType<typeof queryElements>) {
    if (mainContentBooted) return;
    mainContentBooted = true;

    // 1. Render current state (read-only, no user interaction yet)
    await fullRender(els);

    // 2. Attach storage listener so no changes are missed
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        onStorageChanged(els, changes);
    });

    setInterval(() => tickElapsed(els), 1_000);

    // 3. Idle cleanup — must complete before user can interact.
    //    If the offscreen document is still alive (e.g. from a
    //    previous crawl), skip the reset so we don't overwrite
    //    a legitimately active status.
    if (!(await isRunningOffscreen())) {
        await updateStatus('idle', 'Ready');
    }

    // 4. Wire click handlers LAST — guarantees the listener is
    //    attached and the idle cleanup is done before the user
    //    can trigger a new operation (prevents race condition
    //    where updateStatus('idle') overwrites 'updating_history').
    wireActions(els);

    // Dismiss terminal-state badges (error / warning) on popup open.
    // The user can see the full status message in the UI now — no need
    // to keep the badge flashing at them.
    const appState = await getAppState();
    if (appState.status === 'error' || appState.status === 'warning' || appState.status === 'idle') {
        clearBadge();
    }
}

// ---------------------------------------------------------------------------
// Cookie persistence
// ---------------------------------------------------------------------------

async function persistCookies() {
    const [steamCookies, cstradeupCookies] = await Promise.all([
        chrome.cookies.getAll({ domain: 'steamcommunity.com', name: 'steamLoginSecure' }),
        chrome.cookies.getAll({ domain: CSTRADEUP_DOMAIN, name: 'auth' }),
    ]);

    if (steamCookies.length > 0)    await storeSteamToken(steamCookies[0].value);
    if (cstradeupCookies.length > 0) await storeCstradeupToken(cstradeupCookies[0].value);
}

// ---------------------------------------------------------------------------
// Full render — called once on boot
// ---------------------------------------------------------------------------

async function fullRender(els: ReturnType<typeof queryElements>) {
    const [appState, steamData, cstradeupData, devLogs] = await Promise.all([
        getAppState(),
        getSteamStore(),
        getCstradeupStore(),
        getDevLogs(),
    ]);

    renderStatus(els, appState);
    renderCounts(els, appState);
    renderTimestamps(els, appState, cstradeupData);
    renderElapsed(els, appState.operationStartedAt);
    renderDevtoolsOptions(els, appState);
    renderHistoryProgress(
        els,
        appState.status,
        cstradeupData,
        steamData?.memberSince,
    );
    renderLogs(els, devLogs);
    renderDebug(els, steamData as any, cstradeupData as any);
}

// ---------------------------------------------------------------------------
// Reactive re-render on storage changes
// ---------------------------------------------------------------------------

function tryParse<T>(raw: unknown): T | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as T; } catch { return raw as T; }
    }
    return raw as T;
}

async function onStorageChanged(
    els: ReturnType<typeof queryElements>,
    changes: { [key: string]: chrome.storage.StorageChange },
) {
    if (StorageKey.APP_STATE in changes) {
        const state = tryParse<AppState>(changes[StorageKey.APP_STATE].newValue);
        if (state) {
            renderStatus(els, state);
            renderCounts(els, state);
            renderDevtoolsOptions(els, state);
            cachedOperationStartedAt = state.operationStartedAt;

            const cstradeupData = await getCstradeupStore();
            renderTimestamps(els, state, cstradeupData);

            // Re-render progress whenever status changes (show/hide + update)
            const steamData = await getSteamStore();
            renderHistoryProgress(
                els,
                state.status,
                cstradeupData,
                steamData?.memberSince,
            );
        }
    }

    if (StorageKey.CSTRADEUP_ACCESS_TOKEN in changes) {
        const cstradeupData = tryParse<any>(changes[StorageKey.CSTRADEUP_ACCESS_TOKEN].newValue);
        const appState = await getAppState();
        renderTimestamps(els, appState, cstradeupData);

        // Cursor lives inside cstradeup store — re-render progress on every cursor update
        const steamData = await getSteamStore();
        renderHistoryProgress(
            els,
            appState.status,
            cstradeupData,
            steamData?.memberSince,
        );
    }

    if (StorageKey.DEV_LOGS in changes) {
        const logs = tryParse<any>(changes[StorageKey.DEV_LOGS].newValue);
        renderLogs(els, logs);
    }

    if (StorageKey.STEAM_ACCESS_TOKEN in changes || StorageKey.CSTRADEUP_ACCESS_TOKEN in changes) {
        const [steamData, cstradeupData] = await Promise.all([
            getSteamStore(),
            getCstradeupStore(),
        ]);
        renderDebug(els, steamData as any, cstradeupData as any);

        // Re-render progress when steam data changes (memberSince may have
        // become available after the crawl started).
        if (StorageKey.STEAM_ACCESS_TOKEN in changes) {
            const appState = await getAppState();
            renderHistoryProgress(els, appState.status, cstradeupData, steamData?.memberSince);
        }
    }
}

// ---------------------------------------------------------------------------
// Elapsed-time ticker
// ---------------------------------------------------------------------------

let cachedOperationStartedAt = 0;

async function tickElapsed(els: ReturnType<typeof queryElements>) {
    if (cachedOperationStartedAt === 0) {
        const state = await getAppState();
        cachedOperationStartedAt = state.operationStartedAt;
    }
    renderElapsed(els, cachedOperationStartedAt);
}
