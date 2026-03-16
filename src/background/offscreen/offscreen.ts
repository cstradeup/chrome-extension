import {
  notarizeSteamRequestAndSendToBackend,
  initThreads,
} from "./inventory_history/notarize";
import {
  ActionLogMessage,
  ActionUpdateAppState,
} from "../../lib/comms/runtime";
import { getAccountAge, SteamAccountAge } from "./user/badges";
import { GetParmsFromCursor, SteamHttpError } from "./inventory_history/helpers";
import { doSteamRequestAndSendToBackend } from "./inventory_history/request";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Maximum prove requests before restarting the offscreen document.
 * Workaround for https://github.com/tlsnotary/tlsn/issues/959
 * The WASM module panics after multiple runs due to thread-local storage not being cleaned up.
 */
const MAX_PROVE_REQUESTS_BEFORE_RESTART = 10;

// =============================================================================
// State
// =============================================================================

let totalProveRequests = 0;

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

type NotarizeCursorRequest = {
  target: "offscreen";
  type: "notarize-cursor";
  profileBaseUrl: string;
  token: string;
  auth: string;
  cursor: Record<string, string | number>;
};

type OffscreenRequest = InventoryHistoryRequest | AccountAgeRequest | NotarizeCursorRequest;

type InventoryHistoryResponse = {
  success: boolean;
  error?: string;
  shouldShutdown: boolean;
  httpStatus?: number;
};

type AccountAgeResponse = {
  success: boolean;
  age?: SteamAccountAge | null;
};

type NotarizeCursorResponse = {
  success: boolean;
  crafted?: number;
  error?: string;
  shouldShutdown: boolean;
};

// =============================================================================
// Request Handlers
// =============================================================================

async function handleInventoryHistoryRequest(
  request: InventoryHistoryRequest
): Promise<InventoryHistoryResponse> {
  totalProveRequests++;

  try {
    await doSteamRequestAndSendToBackend(
      request.profileBaseUrl ?? "",
      request.token ?? "",
      request.auth ?? "",
      GetParmsFromCursor(request.startCursor ?? {}),
    );

    const shouldShutdown = totalProveRequests >= MAX_PROVE_REQUESTS_BEFORE_RESTART;

    if (shouldShutdown) {
      await ActionLogMessage(
        `Offscreen reached ${totalProveRequests} requests, signaling for restart to avoid WASM panic`
      );
    }

    return { success: true, shouldShutdown: false };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    const httpStatus = e instanceof SteamHttpError ? e.httpStatus : undefined;

    // Do NOT set app-level error state here — the service worker retry loop
    // owns all state transitions during the crawl.  Setting 'error' here
    // would race with the retry logic and overwrite pending warning/retry states.
    await ActionLogMessage(`Offscreen error (HTTP ${httpStatus ?? '?'}): ${errorMsg}`, "error");

    return { success: false, error: errorMsg, shouldShutdown: false, httpStatus };
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

async function handleNotarizeCursorRequest(
  request: NotarizeCursorRequest
): Promise<NotarizeCursorResponse> {
  totalProveRequests++;

  try {
    const result = await notarizeSteamRequestAndSendToBackend(
      request.profileBaseUrl,
      request.token,
      request.auth,
      GetParmsFromCursor(request.cursor),
    );

    const shouldShutdown = totalProveRequests >= MAX_PROVE_REQUESTS_BEFORE_RESTART;

    if (shouldShutdown) {
      await ActionLogMessage(
        `Offscreen reached ${totalProveRequests} requests, signaling for restart to avoid WASM panic`
      );
    }

    return { success: true, crafted: result.crafted, shouldShutdown };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await ActionLogMessage(`Notarize cursor error: ${errorMsg}`, "error");
    return { success: false, error: errorMsg, shouldShutdown: true };
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

        case "notarize-cursor":
          handleNotarizeCursorRequest(request).then(sendResponse);
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
  chrome.runtime.sendMessage({ type: "offscreen_ready" });
}

// =============================================================================
// Initialization
// =============================================================================

async function initialize(): Promise<void> {
  await initThreads();
  setupMessageListener();
  signalReady();
}

initialize();
