/**
 * User-action handlers — wired once during bootstrap.
 * Each handler is a pure function that receives the elements it needs.
 */

import type { Elements } from './elements';
import type { SteamInventoryDataPayload } from '../lib/app';
import { ActionStartInventoryHistorySync, ActionStopOperation } from '../lib/comms/runtime';
import { findOrCreateSteamTab, findSteamTab, findSteamID } from '../lib/steam';
import { ActionPostApi } from '../lib/comms/runtime';
import { getStore as getSteamStore } from '../lib/storage/reducer/steam';
import { getStore as getCstradeupStore } from '../lib/storage/reducer/cstradeup';
import { refreshSessions } from '../lib/session';
import { renderOnboarding } from './render';


// ---------------------------------------------------------------------------
// Wire event listeners
// ---------------------------------------------------------------------------

export function wireActions(els: Elements) {
    // Load Inventory
    els.startBtn?.addEventListener('click', async () => {
        // Pre-flight: ensure Steam session is still active
        const session = await refreshSessions();
        if (session !== 'ready') {
            renderOnboarding(els, session);
            return;
        }
        const tab = await findOrCreateSteamTab();
        if (!tab?.id) return;
    });

    // Load Inventory History
    els.startInventoryHistory?.addEventListener('click', async () => {
        // Pre-flight: ensure both sessions are fresh before starting
        const session = await refreshSessions();
        if (session !== 'ready') {
            renderOnboarding(els, session);
            return;
        }

        const steamData = await getSteamStore();
        const cstradeupData = await getCstradeupStore();

        if (cstradeupData?.auth && steamData?.token && steamData?.steam_id) {
            await ActionStartInventoryHistorySync(
                steamData.steam_id,
                steamData.token,
                cstradeupData.auth,
            );
        }
    });

    // Stop current operation
    els.stopOperation?.addEventListener('click', async () => {
        await ActionStopOperation();
    });

    // Devtools modal
    els.openOptions?.addEventListener('click', () => {
        if (els.devtools) els.devtools.style.display = 'block';
    });
    els.closeDevtools?.addEventListener('click', () => {
        if (els.devtools) els.devtools.style.display = 'none';
    });

    // Clear logs
    els.clearLogs?.addEventListener('click', async () => {
        await chrome.storage.local.remove('dev_logs');
        if (els.logs) els.logs.textContent = '';
    });

    // Nuke storage
    els.nukeStorage?.addEventListener('click', () => chrome.storage.local.clear());

}
