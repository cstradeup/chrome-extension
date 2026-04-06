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
import { getStore as getCstradeupStore }       from './lib/storage/reducer/cstradeup';
import { getDevLogs }                          from './lib/storage/reducer/logs';
import { isRunningOffscreen }                  from './lib/utils';
import { refreshSessions, checkOnboardingState } from './lib/session';

import { queryElements }                       from './popup/elements';
import { wireActions }                         from './popup/actions';
import { renderOnboarding, renderStatus, renderCounts, renderTimestamps, renderElapsed, renderLogs, renderDebug, renderHistoryProgress, renderDevtoolsOptions } from './popup/render';
import { ActionEnsureMemberSince }             from './lib/comms/runtime';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    const els = queryElements();

    // 1. Sync cookie state → storage and determine onboarding step.
    //    This both persists fresh cookies AND clears tokens whose
    //    cookies have expired, ensuring stored tokens stay in sync.
    const onboardingState = await refreshSessions();
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
        const state = await refreshSessions();
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
    // ── Session health check ─────────────────────────────────────
    // When a stored token changes, inspect whether the auth credential
    // was removed (session expired).  If so, verify with live cookies
    // and re-show onboarding when the session is truly gone.
    if (StorageKey.STEAM_ACCESS_TOKEN in changes || StorageKey.CSTRADEUP_ACCESS_TOKEN in changes) {
        const [steamData, cstradeupData] = await Promise.all([
            getSteamStore(),
            getCstradeupStore(),
        ]);

        if (!steamData?.token || !cstradeupData?.auth) {
            // Double-check with cookies (authoritative source).
            // Avoids false positives when storage was nuked but
            // cookies are still alive.
            const onboardingState = await checkOnboardingState();
            if (onboardingState !== 'ready') {
                renderOnboarding(els, onboardingState);
                return; // Skip normal renders while onboarding is showing
            }
        }
    }

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
