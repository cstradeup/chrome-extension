/**
 * relay.ts — Runs in the ISOLATED world on cstradeup.net / localhost.
 *
 * Bridges window.postMessage from the MAIN-world inject-api.ts to the
 * extension's service worker via chrome.runtime.sendMessage, and relays
 * the response back to the page.
 *
 * Flow:
 *   inject-api.ts (MAIN) → window.postMessage → relay.ts (ISOLATED)
 *   → chrome.runtime.sendMessage → service-worker.ts
 *   → response → window.postMessage → inject-api.ts (MAIN)
 */
// @ts-ignore
const CHANNEL = '__CSTRADEUP_API__';

// =============================================================================
// Types (mirrors inject-api.ts)
// =============================================================================

interface ApiRequest {
  channel: typeof CHANNEL;
  direction: 'request';
  requestId: number;
  action: string;
  payload: unknown;
}

interface ApiResponse {
  channel: typeof CHANNEL;
  direction: 'response';
  requestId: number;
  payload: unknown;
}

function isApiRequest(d: unknown): d is ApiRequest {
  return (
    d != null &&
    typeof d === 'object' &&
    (d as any).channel === CHANNEL &&
    (d as any).direction === 'request' &&
    typeof (d as any).requestId === 'number' &&
    typeof (d as any).action === 'string'
  );
}

// =============================================================================
// Extension context helpers
// =============================================================================

/**
 * Returns true when the extension context is still alive.
 * After an extension reload/update, content scripts stay on the page but
 * chrome.runtime becomes undefined (or chrome.runtime.id disappears).
 */
function isExtensionContextValid(): boolean {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/** Send an error response back to inject-api.ts via postMessage. */
function sendErrorResponse(requestId: number, error: string): void {
  const errResponse: ApiResponse = {
    channel: CHANNEL,
    direction: 'response',
    requestId,
    payload: { success: false, error },
  };
  window.postMessage(errResponse, '*');
}

// =============================================================================
// Action routing
// =============================================================================

/** Maps an inject-api action to a chrome.runtime message for the service worker. */
function buildRuntimeMessage(action: string, payload: unknown): Record<string, unknown> | null {
  switch (action) {
    case 'NOTARIZE_CURSOR':
      return { type: 'NOTARIZE_CURSOR', cursor: payload };

    default:
      console.warn(`[CSTRADEUP relay] Unknown action: ${action}`);
      return null;
  }
}

// =============================================================================
// Listener
// =============================================================================

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;

  const msg = event.data;
  if (!isApiRequest(msg)) return;

  // Guard: extension context may have been invalidated after a reload/update
  if (!isExtensionContextValid()) {
    console.error('[CSTRADEUP relay] Extension context invalidated — please refresh the page.');
    sendErrorResponse(msg.requestId, 'Extension context invalidated. Please refresh the page.');
    return;
  }

  const runtimeMsg = buildRuntimeMessage(msg.action, msg.payload);
  if (!runtimeMsg) {
    sendErrorResponse(msg.requestId, `Unknown action: ${msg.action}`);
    return;
  }

  // Forward to service worker and relay the response back
  chrome.runtime.sendMessage(runtimeMsg, (response) => {
    // Check for messaging errors (e.g. port closed, extension unloaded mid-flight)
    if (chrome.runtime.lastError) {
      console.error('[CSTRADEUP relay] runtime.lastError:', chrome.runtime.lastError.message);
      sendErrorResponse(msg.requestId, chrome.runtime.lastError.message ?? 'Extension messaging error');
      return;
    }

    const apiResponse: ApiResponse = {
      channel: CHANNEL,
      direction: 'response',
      requestId: msg.requestId,
      payload: response ?? { success: false, error: 'No response from service worker' },
    };
    window.postMessage(apiResponse, '*');
  });
});

console.log('[CSTRADEUP] Relay content script loaded');
