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

//const CHANNEL = '__CSTRADEUP_API__';

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

  const runtimeMsg = buildRuntimeMessage(msg.action, msg.payload);
  if (!runtimeMsg) {
    // Unknown action — respond immediately with an error
    const errResponse: ApiResponse = {
      channel: CHANNEL,
      direction: 'response',
      requestId: msg.requestId,
      payload: { success: false, error: `Unknown action: ${msg.action}` },
    };
    window.postMessage(errResponse, '*');
    return;
  }

  // Forward to service worker and relay the response back
  chrome.runtime.sendMessage(runtimeMsg, (response) => {
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
