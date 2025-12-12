import {
  GetParmsFromCursor,
  notarizeSteamRequestAndSendToBackend,
  initThreads,
} from "./notarize/notarize";
import {
  ActionLogMessage,
  ActionUpdateAppState,
} from "../../lib/comms/runtime";
let totalProveRequests = 0;

async function notarizeInventoryHistory(message: any) {
  try {
    switch (message.type) {
      case "load-inventory-history":
        totalProveRequests++;
        await notarizeSteamRequestAndSendToBackend(
          message.steamId ?? undefined,
          "steamLoginSecure=" + encodeURIComponent(message.token ?? ""),
          message.auth ?? "",
          GetParmsFromCursor(message.startCursor ?? {})
        );
    }
  } catch (e) {
    await ActionUpdateAppState("error", `Error in message listener: ${e}`);
    await ActionLogMessage(`Error in message listener: ${e}`, "error");
  }
}

async function initialize() {
  await initThreads();

  chrome.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
    if (request.target !== "offscreen") {
      return;
    }

    notarizeInventoryHistory(request).then(() => {
      if (totalProveRequests >= 5) {
        sendResponse({ shouldShutdown: true });
      } else {
        sendResponse({ shouldShutdown: false });
      }
    });

    // Keep message channel open for async response
    return true;
  });

  // Signal to service worker that offscreen is ready
  chrome.runtime.sendMessage({ type: "offscreen_ready" });
}

initialize();