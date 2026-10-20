import {
  ActionLogMessage,
} from "../../lib/comms/runtime";
import { getAccountAge, SteamAccountAge } from "./user/badges";
import { GetParmsFromCursor, SteamHttpError } from "./inventory_history/helpers";
import { doSteamRequestAndSendToBackend } from "./inventory_history/request";

import { IS_CHROME } from "../../lib/compat";

// =============================================================================
// Types
// =============================================================================

type InventoryHistoryRequest = {
  target: "offscreen";
  type: "load-inventory-history";
  profileBaseUrl?: string; // Resolved Steam profile URL (no redirect needed)
  token?: string;
  auth?: string;
  startCursor?: Record<string, string | number>;
};

type AccountAgeRequest = {
  target: "offscreen";
  type: "load-account-age";
  steamId: string;
  token: string;
};

type OffscreenRequest = InventoryHistoryRequest | AccountAgeRequest;

type InventoryHistoryResponse = {
  success: boolean;
  error?: string;
  httpStatus?: number;
};

type AccountAgeResponse = {
  success: boolean;
  age?: SteamAccountAge | null;
};

// =============================================================================
// Request Handlers
// =============================================================================

async function handleInventoryHistoryRequest(
  request: InventoryHistoryRequest
): Promise<InventoryHistoryResponse> {
  try {
    await doSteamRequestAndSendToBackend(
      request.profileBaseUrl ?? "",
      request.token ?? "",
      request.auth ?? "",
      GetParmsFromCursor(request.startCursor ?? {}),
    );

    return { success: true };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    const httpStatus = e instanceof SteamHttpError ? e.httpStatus : undefined;

    // Do NOT set app-level error state here — the service worker retry loop
    // owns all state transitions during the crawl.  Setting 'error' here
    // would race with the retry logic and overwrite pending warning/retry states.
    await ActionLogMessage(`Offscreen error (HTTP ${httpStatus ?? '?'}): ${errorMsg}`, "error");

    return { success: false, error: errorMsg, httpStatus };
  }
}

async function handleAccountAgeRequest(
  request: AccountAgeRequest
): Promise<AccountAgeResponse> {
  try {
    const age = await getAccountAge(request.steamId, request.token);
    return { success: true, age };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await ActionLogMessage(`Error fetching account age: ${errorMsg}`, "error");
    return { success: false };
  }
}

// =============================================================================
// Message Router
// =============================================================================

function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener(
    (request: OffscreenRequest, _sender, sendResponse) => {
      if (request.target !== "offscreen") {
        return false;
      }

      switch (request.type) {
        case "load-inventory-history":
          handleInventoryHistoryRequest(request).then(sendResponse);
          break;

        case "load-account-age":
          handleAccountAgeRequest(request).then(sendResponse);
          break;

        default:
          return false;
      }

      // Keep message channel open for async response
      return true;
    }
  );
}

function signalReady(): void {
  // On Chrome, the service worker waits for this signal before proceeding.
  // On Firefox, both scripts run in the same background page — no signal needed.
  if (IS_CHROME) {
    chrome.runtime.sendMessage({ type: "offscreen_ready" });
  }
}

// =============================================================================
// Initialization
// =============================================================================

setupMessageListener();
signalReady();
