import { Cursor } from "../lib/storage/reducer/cstradeup";

const CHANNEL = '__CSTRADEUP_API__';

// =============================================================================
// Message helpers
// =============================================================================

/** Monotonically increasing request id so we can match responses. */
let nextRequestId = 1;

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

function isApiResponse(d: unknown): d is ApiResponse {
  return (
    d != null &&
    typeof d === 'object' &&
    (d as any).channel === CHANNEL &&
    (d as any).direction === 'response' &&
    typeof (d as any).requestId === 'number'
  );
}

/**
 * Sends a request to the ISOLATED-world relay content script and waits for
 * the matching response.  Returns a Promise that resolves with the response
 * payload or rejects after a timeout.
 */
function sendToRelay<T = unknown>(action: string, payload: unknown, timeoutMs = 120_000): Promise<T> {
  const requestId = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(`[cstradeup] Relay timeout for action "${action}" (id=${requestId})`));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      const msg = event.data;
      if (!isApiResponse(msg) || msg.requestId !== requestId) return;

      clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(msg.payload as T);
    }

    window.addEventListener('message', handler);

    const request: ApiRequest = {
      channel: CHANNEL,
      direction: 'request',
      requestId,
      action,
      payload,
    };

    window.postMessage(request, '*');
  });
}

// =============================================================================
// Public API exposed to the website
// =============================================================================

const loadInventory = async (...params: any[]) => {
  //TODO: open inventory tab to trigger inventory interception.
}

type NotarizeResult = { success: boolean; crafted?: number; error?: string };

const notarizeTradeupItems = async (cursor: Cursor): Promise<NotarizeResult> => {
  return sendToRelay<NotarizeResult>('NOTARIZE_CURSOR', cursor);
}

// @ts-ignore
window.cstradeup = {
  loadInventory,
  notarizeTradeupItems,
  isInstalled: true,
  lastUpdatedDate: undefined,
};
