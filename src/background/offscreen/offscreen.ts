import {
  GetParmsFromCursor,
  initThreads,
  notarizeSteamRequestAndSendToBackend,
} from "./notarize/notarize";
import {
  ActionLogMessage,
  ActionUpdateAppState,
} from "../../lib/comms/runtime";
import { getHistoryCursor } from "../../lib/cstradeup";
import { Cursor } from "../../lib/storage/reducer/cstradeup";

initThreads();

async function loadInventoryHistory(
  steamId: string | null,
  token: string | null,
  auth: string | null,
  startCursor: Cursor | null
) {
  await ActionLogMessage(`Loading inventory history for steamId ${steamId}`);

  await ActionLogMessage(`Using cursor: ${JSON.stringify(startCursor)}`);

  try {
    await notarizeSteamRequestAndSendToBackend(
      steamId ?? undefined,
      "steamLoginSecure=" + encodeURIComponent(token ?? ""),
      auth ?? "",
      GetParmsFromCursor(startCursor ?? {})
    );
  } catch (e) {
    await ActionUpdateAppState(
      "error",
      `Error loading inventory history for steamId ${steamId}: ${e}`
    );
    await ActionLogMessage(
      `Error loading inventory history for steamId ${steamId}: ${e}`,
      "error"
    );
  } finally {
    await ActionLogMessage(
      `Finished loading inventory history for steamId ${steamId}`
    );
    await ActionUpdateAppState("idle", "Idle");
  }
}

let totalProveRequests = 0;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== "offscreen") {
    return;
  }

  try {
    await ActionLogMessage(`Received message: ${JSON.stringify(message)}`);

    switch (message.type) {
      case "load-inventory-history":
        totalProveRequests++;
        await ActionUpdateAppState(
          "updating_history",
          "Loading inventory history..."
        );
        await loadInventoryHistory(
          message.steamId ?? null,
          message.token ?? null,
          message.auth ?? null,
          message.startCursor ?? null
        );
        break;
    }
  } catch (e) {
    await ActionUpdateAppState("error", `Error in message listener: ${e}`);
    await ActionLogMessage(`Error in message listener: ${e}`, "error");
  } finally {
    await ActionUpdateAppState("idle", "Idle");

    if (totalProveRequests >= 5) {
      await ActionLogMessage(
        "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! Reached maximum prove requests, shutting down offscreen document."
      );
      return { shouldShutdown: true };
    }
  }
});
