import {
  GetParmsFromCursor,
  notarizeSteamRequestAndSendToBackend,
  initThreads,
} from "./notarize/notarize";
import {
  ActionLogMessage,
  ActionUpdateAppState,
} from "../../lib/comms/runtime";

// Track total prove requests to determine when to restart the offscreen document
// This is a workaround for https://github.com/tlsnotary/tlsn/issues/959
// The WASM module panics after multiple runs due to thread-local storage not being cleaned up
const MAX_PROVE_REQUESTS_BEFORE_RESTART = 5;
let totalProveRequests = 0;

async function notarizeInventoryHistory(message: any): Promise<{ success: boolean; error?: string }> {
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
        return { success: true };
    }
    return { success: false, error: "Unknown message type" };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await ActionUpdateAppState("error", `Error in message listener: ${errorMsg}`);
    await ActionLogMessage(`Error in message listener: ${errorMsg}`, "error");
    return { success: false, error: errorMsg };
  }
}

async function initialize() {
  await initThreads();

  chrome.runtime.onMessage.addListener((request: any, sender, sendResponse) => {
    if (request.target !== "offscreen") {
      return;
    }

    notarizeInventoryHistory(request)
      .then((result) => {
        // Signal to the service worker whether the offscreen document should be closed
        // After MAX_PROVE_REQUESTS_BEFORE_RESTART requests, we need to restart to avoid WASM panic
        const shouldShutdown = totalProveRequests >= MAX_PROVE_REQUESTS_BEFORE_RESTART;
        
        if (shouldShutdown) {
          ActionLogMessage(`Offscreen reached ${totalProveRequests} requests, signaling for restart to avoid WASM panic`);
        }

        sendResponse({ 
          ...result,
          shouldShutdown 
        });
      })
      .catch((e) => {
        // Even on error, still signal shutdown if we've hit the limit
        const shouldShutdown = totalProveRequests >= MAX_PROVE_REQUESTS_BEFORE_RESTART;
        sendResponse({ 
          success: false, 
          error: e instanceof Error ? e.message : String(e),
          shouldShutdown 
        });
      });

    // Keep message channel open for async response
    return true;
  });

  // Signal to service worker that offscreen is ready
  chrome.runtime.sendMessage({ type: "offscreen_ready" });
}

initialize();