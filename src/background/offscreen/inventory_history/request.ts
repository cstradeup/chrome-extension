import { ActionAddAppSyncedStorageUnitItems, ActionAddAppSyncedTradeupItems } from "../../../lib/comms/app";
import { ActionLogMessage } from "../../../lib/comms/runtime";
import { uploadUnsignedHistory } from "../../../lib/cstradeup";
import { Cursor } from "../../../lib/storage/reducer/cstradeup";
import { buildCookie, buildHeaders, DEFAULT_HISTORY_PARAMS, HistoryParams, InventoryHistoryUploadResult, STEAM_CONFIG, SteamHttpError } from "./helpers";

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

/**
 * Processes Steam inventory history and uploads it to the backend.
 *
 * Flow:
 * 1. Fetch inventory history from Steam using pre-resolved URL
 * 2. Upload to backend for indexing (trade-ups, storage unit moves)
 * 3. Update sync counts
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

  // Step 2: Upload history for backend indexing
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
