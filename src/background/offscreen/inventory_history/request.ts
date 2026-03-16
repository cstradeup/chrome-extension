import { ActionAddAppSyncedStorageUnitItems, ActionAddAppSyncedTradeupItems } from "../../../lib/comms/app";
import { ActionLogMessage } from "../../../lib/comms/runtime";
import { uploadUnsignedHistory } from "../../../lib/cstradeup";
import { Cursor } from "../../../lib/storage/reducer/cstradeup";
import { buildCookie, buildHeaders, DEFAULT_HISTORY_PARAMS, HistoryParams, InventoryHistoryUploadResult, NotarizationResult, STEAM_CONFIG, SteamHttpError } from "./helpers";

// =============================================================================
// Types
// =============================================================================

export type HttpMethod = "GET" | "POST";

// =============================================================================
// Response Size Calculation
// =============================================================================

/**
 * Calculates the expected response size for notarization buffer allocation.
 * Makes an actual request to determine headers and body size.
 */
export async function calculateResponseSize(
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body?: string
): Promise<{ maxRecvData: number }> {
  const opts: RequestInit = { method, headers, credentials: "include" };
  if (body) {
    opts.body = body;
  }

  const response = await fetch(url, opts);

  await ActionLogMessage(`Response status for size calculation: ${response.status}`);

  // Calculate headers size
  const statusLine = `HTTP/1.1 ${response.status} ${response.statusText}`;
  let headersSize = statusLine.length + 2; // +2 for CRLF (\r\n)

  response.headers.forEach((value, name) => {
    headersSize += name.length + value.length + 4; // ": " and "\r\n"
  });

  // Headers not included in fetch but present in network response
  headersSize += "Connection: close".length + 2;
  headersSize += "X-N: S".length + 2;

  // Final CRLF separating headers from body
  headersSize += 2;

  // Calculate body size
  const contentLength = response.headers.get("content-length");
  if (!contentLength) {
    throw new Error("No content length in response headers");
  }

  const bodySize = parseInt(contentLength, 10);

  return { maxRecvData: headersSize + bodySize };
}

// =============================================================================
// Request Size Calculation
// =============================================================================

/**
 * Calculates the request size for notarization buffer allocation.
 */
export function calculateRequestSize(
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body?: string
): number {
  const encoder = new TextEncoder();

  const requestLineSize = encoder.encode(`${method} ${url} HTTP/1.1\r\n`).length;

  const headersSize = encoder.encode(
    Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join("")
  ).length;

  const bodySize = body ? encoder.encode(JSON.stringify(body)).length : 0;

  // +2 for CRLF after headers
  return requestLineSize + headersSize + 2 + bodySize;
}

/**
 * Fetches Steam inventory history using a pre-resolved profile URL.
 * No redirect checking needed - URL is already resolved by the caller.
 */
export async function fetchSteamHistory(
  profileBaseUrl: string,
  token: string,
  params: HistoryParams
): Promise<{ data: unknown; cursor: Cursor; }> {
  const cookie = buildCookie(token);
  const headers = buildHeaders(cookie);
  
  // Build full URL from pre-resolved base
  const search = new URLSearchParams(params as Record<string, string>).toString();
  const url = `${profileBaseUrl}${STEAM_CONFIG.inventoryHistoryPath}?${search}`;

  await ActionLogMessage(`Fetching history from: ${url}`);

  // Fetch the history data
  // NOTE: Cookie header in `headers` is a forbidden header and will be
  // silently dropped by Chrome.  The browser attaches cookies from the
  // cookie jar instead (locale overrides are set by ensureLocaleCookies
  // in the service worker before this offscreen request is dispatched).
  const response = await fetch(url, {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    throw new SteamHttpError(
      `Failed to fetch Steam history: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const data = await response.json();
  const cursor: Cursor = data?.cursor ?? { time: 0, time_frac: 0, s: '0' };

  return { data, cursor};
}

// =============================================================================
// Request
// =============================================================================


/**
 * Processes Steam inventory history without notarization.
 *
 * Flow:
 * 1. Fetch inventory history from Steam using pre-resolved URL
 * 2. Upload unsigned to backend to check for crafted items
 * 3. Update cursor and sync counts
 *
 * @param profileBaseUrl - Pre-resolved Steam profile base URL (redirect already handled)
 * @param token - Steam login token
 * @param auth - Backend auth token
 * @param requestParams - Cursor parameters for pagination
 */
export async function doSteamRequestAndSendToBackend(
  profileBaseUrl: string,
  token: string,
  auth: string,
  requestParams: HistoryParams = DEFAULT_HISTORY_PARAMS,
): Promise<InventoryHistoryUploadResult> {

  // Step 1: Fetch Steam history using pre-resolved URL
  await ActionLogMessage("Fetching Steam inventory history...");
  const { data: historyData, cursor } = await fetchSteamHistory(profileBaseUrl, token, requestParams);

  // Step 2: Upload history to check if notarization is needed
  await ActionLogMessage("Uploading history to backend...");
  const unsignedResult = await uploadUnsignedHistory(historyData, auth);

  await ActionAddAppSyncedTradeupItems(unsignedResult.crafted);
  await ActionAddAppSyncedStorageUnitItems(unsignedResult.moved_to_storage);

  await ActionLogMessage("Chunk processing complete");

  return {
    success: true,
    crafted: unsignedResult.crafted,
    movedToStorage: unsignedResult.moved_to_storage,
    cursor,
  };
}