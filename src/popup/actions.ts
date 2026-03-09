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


// ---------------------------------------------------------------------------
// Wire event listeners
// ---------------------------------------------------------------------------

export function wireActions(els: Elements) {
    // Load Inventory
    els.startBtn?.addEventListener('click', async () => {
        const tab = await findOrCreateSteamTab();
        if (!tab?.id) return;
    });

    // Load Inventory History
    els.startInventoryHistory?.addEventListener('click', async () => {
        const steamData = await getSteamStore();
        const cstradeupData = await getCstradeupStore();

        if (cstradeupData && steamData) {
            await ActionStartInventoryHistorySync(
                steamData.steam_id ?? null,
                steamData.token ?? null,
                cstradeupData.auth ?? null,
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
