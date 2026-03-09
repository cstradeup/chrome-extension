
import { ActionLogMessage } from "../../../lib/comms/runtime";
import { Cursor } from "../../../lib/storage/reducer/cstradeup";
import { HttpMethod } from "./request";

export type HistoryParams = {
  ajax: string;
  "cursor[time]": string;
  "cursor[time_frac]": string;
  "cursor[s]": string;
  "app[]": string;
};

export type SteamHeaders = {
  Connection: string;
  Host: string;
  "Accept-Encoding": string;
  Cookie: string;
};

export type InventoryHistoryUploadResult = {
    success: boolean;
    crafted: number;
    movedToStorage: number;
    cursor: Cursor;
};

export type NotarizationResult = {
  notarized: boolean;
  crafted: number;
};

/** Typed error for HTTP failures from Steam, preserving the status code. */
export class SteamHttpError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'SteamHttpError';
  }
}

export const DEFAULT_HISTORY_PARAMS: HistoryParams = {
  ajax: "1",
  "cursor[time]": "0",
  "cursor[time_frac]": "0",
  "cursor[s]": "0",
  "app[]": "730",
};

export const STEAM_CONFIG = {
  baseUrl: "https://steamcommunity.com",
  host: "steamcommunity.com",
  inventoryHistoryPath: "/inventoryhistory/",
} as const;

export const STEAM_LOCALE_COOKIES = {
  Steam_Language: "english",
  steamCurrencyId: "1",       // 1 = USD
  timezoneOffset: "0,0",      // UTC offset (seconds, DST flag)
  timezoneName: "Etc/UTC",    // IANA timezone
} as const;

export function GetParmsFromCursor(cursor: Record<string, string | number>): HistoryParams {
  return {
    ajax: "1",
    "cursor[time]": String(cursor.time ?? 0),
    "cursor[time_frac]": String(cursor.time_frac ?? 0),
    "cursor[s]": String(cursor.s ?? 0),
    "app[]": "730",
  };
}

export function buildCookie(token: string): string {
  const authCookie = `steamLoginSecure=${encodeURIComponent(token)}`;
  const localeCookies = Object.entries(STEAM_LOCALE_COOKIES)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("; ");
  return `${authCookie}; ${localeCookies}`;
}

export function buildHeaders(cookie: string): SteamHeaders {
  return {
    Connection: "close",
    Host: STEAM_CONFIG.host,
    "Accept-Encoding": "gzip",
    Cookie: cookie,
  };
}

/**
 * Checks if a URL redirects and returns the final URL if so.
 */
export async function isRedirect(
  url: string,
  method: HttpMethod,
  headers: Record<string, string>,
  body?: string
): Promise<string | null> {
  const opts: RequestInit = {
    method,
    headers,
    credentials: "include",
  };

  if (body) {
    opts.body = body;
  }

  try {
    const response = await fetch(url, opts);

    await ActionLogMessage(`Redirect check response URL: ${response.url}`);

    // Check if we were redirected (URL changed)
    if (response.url !== url) {
      return response.url;
    }

    // Check for 3xx redirect status with Location header
    if (response.status >= 300 && response.status < 400) {
      return response.headers.get("Location");
    }

    return null;
  } catch (error) {
    await ActionLogMessage(
      `Fetch error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error"
    );
    return null;
  }
}