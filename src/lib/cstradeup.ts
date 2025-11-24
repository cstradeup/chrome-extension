import { PresentationJSON } from "tlsn-js/build/types";
import { Cursor, getStore } from "./storage/reducer/cstradeup";

const HOSTNAME = "http://localhost:3000";
const CSTRADEUP_CURSOR_ROUTE = "/account/inventory/extension/history/cursor";
const CSTRADEUP_UPLOAD_ROUTE = "/account/inventory/extension/history";

export type CursorResponse = {
    last_cursor: Cursor;
    left_cursor: Cursor | null;
    right_cursor: Cursor | null;
}

export async function getHistoryCursor(auth: string | null) : Promise<CursorResponse | null> {

    if (!auth) {
        return null;
    }

    const response = await fetch(`${HOSTNAME}${CSTRADEUP_CURSOR_ROUTE}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Cookie: auth ? `auth=${auth}` : '',
            Authorization: auth ? `${auth}` : ''
        },
    });

    if (!response.ok || response.status !== 200) {
        throw new Error(`Failed to fetch history cursor: ${response.status} ${response.statusText}`);
    }

    return await response.json()
}

type UploadHistoryResponse = {
    verified: boolean;
    crafted: number;
    moved_to_storage: number;
}

export async function uploadHistory(presentation: PresentationJSON, auth: string): Promise<UploadHistoryResponse> {
     
    const payload = {
        presentation,
    };

      // If you are in the background/service worker (recommended), do:
      const r = await fetch(`${HOSTNAME}${CSTRADEUP_UPLOAD_ROUTE}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Cookie: `auth=${auth}`,//why no send this? 🤌
          Authorization: `${auth}`
        },
        body: JSON.stringify(payload),
      });
 
      if (!r.ok || r.status !== 200) {
        throw new Error(`Failed to upload history: ${r.status} ${r.statusText}`);
      }
    
      return await r.json();
}