import { StartInventoryHistoryPayload } from "../../lib/app";
import { ActionLogMessage, ActionUpdateAppState } from "../../lib/comms/runtime";
import { getHistoryCursor } from "../../lib/cstradeup";
import { hasPermission } from "../../lib/permission";
import { updateStatus } from "../../lib/storage/reducer/app";
import { Cursor, DEFAULT_CURSOR } from "../../lib/storage/reducer/cstradeup";
import { withTimeout } from "../../lib/utils";
import { openOffscreenDocument } from "../service-worker";

const TIMEOUT = 60000;

export async function loadInventoryHistory(msg: StartInventoryHistoryPayload) {
  await ActionLogMessage(`Loading inventory history for steamId ${msg.steamId}`);

  let startCursor: Cursor | null = DEFAULT_CURSOR;
  await updateStatus('updating_history', `Loading inventory history for steamId ${msg.steamId}`);

  const maxRetries = 3;
  let attempt = 0;

  try {

    while (startCursor !== null) {

      await ActionLogMessage(`Fetching history chunk for steamId ${msg.steamId} with cursor: ${JSON.stringify(startCursor)}, waiting up to ${TIMEOUT/1000}s for offscreen response.`);
      
      try {
        await withTimeout(sendToOffscreen(msg.steamId, msg.token, msg.auth, startCursor), TIMEOUT);
      } catch (e) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new Error(`Failed to load inventory history after ${maxRetries} attempts: ${e}`);
        }
        await ActionLogMessage(`Attempt ${attempt} failed for steamId ${msg.steamId} with cursor: ${JSON.stringify(startCursor)}. Retrying...`);
        continue;
      }
      
      const response = await getHistoryCursor(msg.auth);
      startCursor = response?.last_cursor ?? null;

      if (startCursor?.time! < response?.left_cursor?.time! || response?.last_cursor.time === 0 && response?.right_cursor?.time !== 0) {
        await ActionLogMessage(`Reached the beginning of history for steamId ${msg.steamId}, going to the end of history to continue loading.`);
        startCursor = response?.right_cursor ?? null;
      } 

      await ActionLogMessage(`next cursor: ${JSON.stringify(startCursor)}`);
    }

  } catch (e) {
    await ActionLogMessage(`Error loading inventory history for steamId ${msg.steamId}: ${e}`, 'error');
    await updateStatus('error', `Error loading inventory history for steamId ${msg.steamId}: ${e}`);
    return;
  } finally {
    await ActionLogMessage(`Finished loading inventory history for steamId ${msg.steamId}`);
  }

  await updateStatus('idle', 'Idle');
}

export async function sendToOffscreen(steamId: string | null, token: string | null, auth: string | null, startCursor: Cursor | null) {
    const granted = await hasPermission([], ["https://steamcommunity.com/*"]);

    if (!granted) {
        throw new Error(
            "must have steamcommunity.com permissions in order to prove API requests"
        );
    }
    await openOffscreenDocument();

    const resp = await chrome.runtime.sendMessage({
        type: 'load-inventory-history',
        target: 'offscreen',
        steamId,
        token,
        auth,
        startCursor,
    });

    // Check if offscreen signaled it should be closed (WASM workaround for tlsn issue #959)
    if (resp?.shouldShutdown) {
        const hasExistingContext = await chrome.offscreen.hasDocument();

        if (hasExistingContext) {  
            await ActionLogMessage("Closing offscreen document to reset WASM state (preventing thread overflow panic)");
            await chrome.offscreen.closeDocument();
        }
    }

    // Check if the notarization itself failed
    if (resp?.success === false && resp?.error) {
        throw new Error(`Offscreen notarization failed: ${resp.error}`);
    }

    console.log("Sent 'load-inventory-history' to offscreen");

    return true;
}