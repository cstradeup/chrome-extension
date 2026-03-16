import { PresentationJSON } from "tlsn-js/build/types";
import { Cursor } from "./storage/reducer/cstradeup";
import { CSTRADEUP_HOSTNAME } from "./env";

// =============================================================================
// Configuration
// =============================================================================

const HOSTNAME = CSTRADEUP_HOSTNAME;

const ROUTES = {
  cursor: "/account/inventory/extension/history/cursor",
  upload: "/account/inventory/extension/history",
  uploadSigned: "/account/inventory/extension/history/signed",
} as const;

// =============================================================================
// Types
// =============================================================================

export type CursorResponse = {
  last_cursor: Cursor;
  left_cursor: Cursor | null;
  right_cursor: Cursor | null;
};

export type UploadHistoryResponse = {
  verified: boolean;
  crafted: number;
  moved_to_storage: number;
};

export type UploadSignedHistoryResponse = {
  verified: boolean;
  crafted: number;
  moved_to_storage: number;
};

// =============================================================================
// Helper Functions
// =============================================================================

function createAuthHeaders(auth: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Cookie: `auth=${auth}`,
    Authorization: auth,
  };
}

async function postJSON<T>(url: string, auth: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: createAuthHeaders(auth),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {

    // try getting error from body json
    let errorMsg = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData && errorData.error) {
        errorMsg += ` - ${errorData.error}`;
      }
    } catch {
      // ignore JSON parsing errors and use the default message
    }

    throw new Error(errorMsg);
  
  }

  return response.json();
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetches the current history cursor from the backend.
 */
export async function getHistoryCursor(auth: string | null): Promise<CursorResponse | null> {
  if (!auth) {
    return null;
  }

  const response = await fetch(`${HOSTNAME}${ROUTES.cursor}`, {
    method: "GET",
    credentials: "include",
    headers: createAuthHeaders(auth),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch history cursor: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Uploads unsigned inventory history to check if notarization is needed.
 * Returns crafted count - if positive, the request should be notarized.
 */
export async function uploadUnsignedHistory(
  historyData: unknown,
  auth: string
): Promise<UploadHistoryResponse> {
  return postJSON<UploadHistoryResponse>(
    `${HOSTNAME}${ROUTES.upload}`,
    auth,
    historyData
  );
}

/**
 * Uploads notarized/signed presentation for verified history.
 * Only called when crafted items are detected.
 */
export async function uploadSignedHistory(
  presentation: PresentationJSON,
  auth: string
): Promise<UploadSignedHistoryResponse> {
  return postJSON<UploadSignedHistoryResponse>(
    `${HOSTNAME}${ROUTES.uploadSigned}`,
    auth,
    { presentation }
  );
}