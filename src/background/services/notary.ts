import { StartInventoryHistoryPayload } from "../../lib/app";
import { ActionLogMessage, ActionUpdateAppState } from "../../lib/comms/runtime";
import { getHistoryCursor } from "../../lib/cstradeup";
import { hasPermission } from "../../lib/permission";
import { Cursor } from "../../lib/storage/reducer/cstradeup";
import { openOffscreenDocument } from "../service-worker";

export async function loadInventoryHistory(msg: StartInventoryHistoryPayload) {
  await ActionLogMessage(`Loading inventory history for steamId ${msg.steamId}`);

  const savedCursors = await getHistoryCursor(msg.auth);
  let startCursor = savedCursors?.last_cursor ?? null;

  await ActionLogMessage(`Using cursor: ${JSON.stringify(savedCursors)}`);

  try {

    do{
      await ActionLogMessage(`Fetching history chunk for steamId ${msg.steamId} with cursor: ${JSON.stringify(startCursor)}`);
      
      await sendToOffscreen(msg.steamId, msg.token, msg.auth, startCursor);

      const response = await getHistoryCursor(msg.auth);
      startCursor = response?.last_cursor ?? null;

      if (startCursor?.time! < response?.left_cursor?.time!) {
        await ActionLogMessage(`Reached the beginning of history for steamId ${msg.steamId}, going to the end of history to continue loading.`);
        startCursor = response?.right_cursor ?? null;
      } 

    }while(true)

  } catch (e) {
    await ActionUpdateAppState('error', `Error loading inventory history for steamId ${msg.steamId}: ${e}`);
    await ActionLogMessage(`Error loading inventory history for steamId ${msg.steamId}: ${e}`, 'error');
  } finally {
    await ActionLogMessage(`Finished loading inventory history for steamId ${msg.steamId}`);
    await ActionUpdateAppState('idle', 'Idle');
  }
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

    if (resp.shouldShutdown) {
        const hasExistingContext = await chrome.offscreen.hasDocument();

        if (hasExistingContext) {  
            await ActionLogMessage("Closing offscreen document as instructed by offscreen script.");
            await chrome.offscreen.closeDocument();
        }

    }

    console.log("Sent 'load-inventory-history' to offscreen")

    return true;
}