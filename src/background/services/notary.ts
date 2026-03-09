import { StartInventoryHistoryPayload } from "../../lib/app";
import { ActionLogMessage } from "../../lib/comms/runtime";
import { getHistoryCursor } from "../../lib/cstradeup";
import { hasPermission } from "../../lib/permission";
import { getAppState, updateStatus } from "../../lib/storage/reducer/app";
import { syncBadge } from "../../lib/badge";
import { Cursor, DEFAULT_CURSOR, isTerminalCursor, normalizeCursor, saveSyncState, SyncPhase } from "../../lib/storage/reducer/cstradeup";
import { sleep, withTimeout } from "../../lib/utils";
import { getStore as getSteamStore, saveMemberSince } from "../../lib/storage/reducer/steam";
import { openOffscreenDocument } from "../service-worker";

// =============================================================================
// Configuration
// =============================================================================

const TIMEOUT = 60000;
const MAX_RETRIES = 3;

/**
 * Error thrown when the offscreen document reports a Steam HTTP server error (5xx).
 * Carries the status code so the retry loop can distinguish transient failures
 * from persistent cursor corruption.
 */
class SteamServerError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = 'SteamServerError';
  }
}

// =============================================================================
// Abort Controller — module-level cancellation signal
// =============================================================================

let activeAbort: AbortController | null = null;

/** Request cancellation of the current operation. */
export function requestStop(): boolean {
  if (!activeAbort) return false;
  activeAbort.abort();
  return true;
}

/** Returns true if an operation is currently in progress. */
export function isOperationRunning(): boolean {
  return activeAbort !== null;
}

/** Throws if the signal has been aborted. Call between iterations. */
function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Operation stopped by user", "AbortError");
  }
}

const STEAM_CONFIG = {
  baseUrl: "https://steamcommunity.com",
  profilePath: (steamId: string) => `/profiles/${steamId}`,
  inventoryHistoryPath: "/inventoryhistory/",
} as const;

// =============================================================================
// Types
// =============================================================================

type ResolvedSteamProfile = {
  baseUrl: string; // The resolved profile base URL (handles custom URLs)
  steamId: string;
};

// =============================================================================
// Steam Profile Resolution
// =============================================================================

/**
 * Resolves the actual Steam profile URL by checking for redirects.
 * Steam profiles can redirect from /profiles/{steamId} to /id/{customUrl}.
 * This should be called ONCE before the sync cycle starts.
 */
async function resolveSteamProfileUrl(
  steamId: string,
  token: string
): Promise<ResolvedSteamProfile> {
  const profileUrl = `${STEAM_CONFIG.baseUrl}${STEAM_CONFIG.profilePath(steamId)}`;
  const cookie = `steamLoginSecure=${encodeURIComponent(token)}`;

  await ActionLogMessage(`Resolving Steam profile URL for steamId ${steamId}...`);

  try {
    const response = await fetch(profileUrl, {
      method: "HEAD",
      credentials: "include",
      headers: {
        Cookie: cookie,
      },
      redirect: "follow",
    });

    // Extract the base profile URL (without any trailing paths)
    const finalUrl = new URL(response.url);
    const pathParts = finalUrl.pathname.split("/").filter(Boolean);
    
    // Build the base profile URL (e.g., /profiles/123 or /id/customname)
    let baseUrl: string;
    if (pathParts.length >= 2) {
      baseUrl = `${finalUrl.origin}/${pathParts[0]}/${pathParts[1]}`;
    } else {
      baseUrl = `${finalUrl.origin}${finalUrl.pathname}`.replace(/\/$/, "");
    }

    if (baseUrl !== profileUrl.replace(/\/$/, "")) {
      await ActionLogMessage(`Profile redirected: ${profileUrl} -> ${baseUrl}`);
    } else {
      await ActionLogMessage(`Profile URL confirmed: ${baseUrl}`);
    }

    return { baseUrl, steamId };
  } catch (error) {
    await ActionLogMessage(
      `Failed to resolve profile URL, using default: ${error}`,
      "warn"
    );
    return { baseUrl: profileUrl, steamId };
  }
}

// =============================================================================
// Inventory History Loading
// =============================================================================

/** Compact cursor string for log messages. */
function fmtCursor(cursor: Cursor | null | undefined): string {
  if (!cursor) return 'null';
  return `{time: ${cursor.time}, frac: ${cursor.time_frac}, s: "${cursor.s}"}`;
}

/**
 * Three sync strategies, determined by server state at startup:
 *
 *   **fresh**       — No data on server. DEFAULT_CURSOR → crawl backwards
 *                    through all history until Steam has no more pages.
 *
 *   **resume**      — Partial data exists; left edge is NOT terminal.
 *                    Continue from left edge deeper into history.
 *
 *   **incremental** — Full history already imported (left IS terminal).
 *                    DEFAULT_CURSOR → crawl backwards until reaching
 *                    the right edge of already-synced data.
 *
 * Progress:
 *   - fresh/resume  → `history_cursor` tracks left edge, drives progress bar
 *                     (0 % → 100 % from now toward account creation).
 *   - incremental   → `sync_cursor` tracks live position, progress bar shows
 *                     coverage of the gap between now and the right edge.
 */
export async function loadInventoryHistory(msg: StartInventoryHistoryPayload) {
  // Prevent concurrent runs
  if (activeAbort) {
    await ActionLogMessage("Operation already in progress, ignoring duplicate request");
    return;
  }

  const abort = new AbortController();
  activeAbort = abort;

  await ActionLogMessage(`Loading inventory history for steamId ${msg.steamId}`);
  await updateStatus("updating_history", `Loading inventory history for steamId ${msg.steamId}`);

  // Hoisted to function scope so the final status guard can read it
  // after the try-catch-finally block.
  let corruptionDetected = false;

  try {
    // Ensure account creation date is available for popup progress display.
    // onInstalled may not have loaded it yet (e.g. first run before steam
    // credentials were persisted to storage).
    const steamStore = await getSteamStore();
    if (!steamStore?.memberSince && msg.steamId && msg.token) {
      try {
        await openOffscreenDocument();
        const ageResp = await chrome.runtime.sendMessage({
          type: 'load-account-age',
          target: 'offscreen',
          steamId: msg.steamId,
          token: msg.token,
        });
        if (ageResp?.success && typeof ageResp.age === 'object' && ageResp.age.memberSince) {
          await saveMemberSince(ageResp.age.memberSince);
          await ActionLogMessage(`Loaded account creation date: ${ageResp.age.memberSince}`);
        }
      } catch (e) {
        await ActionLogMessage(`Could not load account age for progress: ${e}`, 'warn');
      }
    }

    // Pre-process: Resolve the actual profile URL once before the cycle
    const profile = await resolveSteamProfileUrl(msg.steamId!, msg.token!);

    // ── Query server for current sync edges ──────────────────────────
    //
    //  Timeline:  NOW (newest) ←————————————→ ACCOUNT CREATION (oldest)
    //                  LEFT                RIGHT
    //              (highest .time)      (lowest .time)
    //
    const serverState = await getHistoryCursor(msg.auth!);
    const initialLeft  = normalizeCursor(serverState?.left_cursor);   // newest synced
    const initialRight = normalizeCursor(serverState?.right_cursor);  // oldest synced
    const hasExistingData = !isTerminalCursor(initialLeft);

    // ── Determine initial phase ──────────────────────────────────────
    //
    //  fresh (no data)        → historical:  DEFAULT → Steam empty
    //  has data, right real   → catching_up: DEFAULT → left edge,
    //                           THEN historical: right edge → Steam empty
    //  has data, right done   → catching_up: DEFAULT → left edge only
    //
    let phase: SyncPhase;
    let startCursor: Cursor;
    let catchUpTarget: Cursor | null = null;

    if (!hasExistingData) {
      phase = 'historical';
      startCursor = DEFAULT_CURSOR;
      await ActionLogMessage(`Strategy: fresh — full history import`);
    } else {
      phase = 'catching_up';
      startCursor = DEFAULT_CURSOR;
      catchUpTarget = initialLeft;
      const willChain = !isTerminalCursor(initialRight);
      await ActionLogMessage(
        `Strategy: incremental${willChain ? ' + resume' : ''} | ` +
        `left: ${fmtCursor(initialLeft)}, right: ${fmtCursor(initialRight)}`
      );
    }

    // ── Initialize sync state ────────────────────────────────────────
    await saveSyncState({
      sync_phase: phase,
      sync_left_boundary: catchUpTarget,
      sync_pages_fetched: 0,
      sync_cursor: null,
      sync_corrupted_at: null, // Clear any previous corruption flag
    });

    await updateStatus("updating_history",
      phase === 'catching_up'
        ? 'Syncing latest items…'
        : 'Starting full history import…',
    );

    // ── Main crawl loop ──────────────────────────────────────────────
    let currentCursor = startCursor;
    let pagesCount = 0;
    let previousCursorKey = '';
    let syncCompleted = false;

    while (true) {
      throwIfAborted(abort.signal);

      // Loop guard: detect same cursor fetched twice
      const cursorKey = `${currentCursor.time}:${currentCursor.time_frac}:${currentCursor.s}`;
      if (cursorKey === previousCursorKey) {
        await ActionLogMessage(
          `Cursor unchanged (${cursorKey}) — stopping to prevent infinite loop`, 'warn'
        );
        break;
      }
      previousCursorKey = cursorKey;

      await ActionLogMessage(
        `[${phase}] Page ${pagesCount + 1} — cursor: ${fmtCursor(currentCursor)}`
      );

      // ── Fetch one chunk via offscreen (with retry) ─────────────────
      let attempt = 0;
      let consecutive500s = 0;

      while (true) {
        try {
          await withTimeout(
            sendToOffscreen(profile.baseUrl, msg.token, msg.auth, currentCursor),
            TIMEOUT,
          );
          await sleep(2500);
          break; // success
        } catch (e) {
          if (abort.signal.aborted) {
            throw new DOMException("Operation stopped by user", "AbortError");
          }
          attempt++;

          // Track consecutive Steam 500 errors on this cursor
          if (e instanceof SteamServerError && e.httpStatus >= 500) {
            consecutive500s++;
          }

          if (attempt >= MAX_RETRIES) {
            if (consecutive500s >= MAX_RETRIES) {
              // All retries returned 5xx on this cursor — likely corrupted
              corruptionDetected = true;
              break;
            }
            throw new Error(`Failed after ${MAX_RETRIES} attempts: ${e}`);
          }

          // Back off before retrying — Steam throttles rapid requests.
          // Longer delay for server errors to give Steam time to recover.
          const isServerError = e instanceof SteamServerError && e.httpStatus >= 500;
          const retryDelay = isServerError ? 8000 : 3000;
          await ActionLogMessage(
            `Attempt ${attempt} failed${isServerError ? ` (HTTP ${(e as SteamServerError).httpStatus})` : ''}: ${e}. ` +
            `Retrying in ${retryDelay / 1000}s…`
          );
          await sleep(retryDelay);
        }
      }

      // ── Handle corrupted cursor ────────────────────────────────────
      if (corruptionDetected) {
        const corruptedDate = currentCursor.time
          ? new Date(currentCursor.time * 1000).toLocaleDateString('en-US', {
              month: 'long', day: 'numeric', year: 'numeric',
            })
          : 'an unknown date';

        await ActionLogMessage(
          `Steam returned 500 errors ${MAX_RETRIES} consecutive times at cursor ` +
          `${fmtCursor(currentCursor)} — likely corrupted inventory history ` +
          `around ${corruptedDate}`,
          'warn',
        );

        await saveSyncState({
          sync_corrupted_at: currentCursor,
          ...(phase === 'historical' ? { history_cursor: currentCursor } : {}),
        });

        await updateStatus('warning',
          `Steam's inventory history appears corrupted around ${corruptedDate}. ` +
          `Your portfolio and trade-up history are available but may be missing ` +
          `some historical data.`,
        );
        break; // Exit the main crawl loop
      }

      pagesCount++;
      syncBadge('updating_history', `${pagesCount}`);
      throwIfAborted(abort.signal);

      // ── Query server for updated state ─────────────────────────────
      const response = await getHistoryCursor(msg.auth!);
      const nextCursor = normalizeCursor(response?.last_cursor);

      // Use actual crawl position for progress — server's cursors may
      // not update reliably per-page.  When nextCursor is terminal
      // (no more pages), keep currentCursor as the deepest valid point.
      const progressCursor =
        nextCursor && !isTerminalCursor(nextCursor) ? nextCursor : currentCursor;

      // ── Update live progress ───────────────────────────────────────
      await saveSyncState({
        sync_cursor: progressCursor,
        sync_pages_fetched: pagesCount,
        // During historical phase, persist deepest crawl position so
        // history_cursor stays in sync with sync_cursor.  When sync
        // ends and sync_cursor is cleared, the bar falls back to
        // history_cursor seamlessly.
        ...(phase === 'historical' ? { history_cursor: progressCursor } : {}),
      });

      // ── Stop: no more pages from Steam ─────────────────────────────
      if (!nextCursor || isTerminalCursor(nextCursor)) {
        if (phase === 'historical') {
          syncCompleted = true;
          await ActionLogMessage(
            `History complete after ${pagesCount} pages — no more Steam data`
          );
          break;
        }

        // catching_up hit terminal — Steam has no newer pages
        await ActionLogMessage(
          `Caught up (Steam empty) after ${pagesCount} pages`
        );

        // Chain into historical if right edge hasn't been fully crawled
        if (!isTerminalCursor(initialRight)) {
          phase = 'historical';
          currentCursor = initialRight!;
          previousCursorKey = '';
          await saveSyncState({ sync_phase: 'historical', sync_left_boundary: null });
          await updateStatus("updating_history",
            `Resuming deeper history from ${initialRight!.time ? new Date(initialRight!.time * 1000).toLocaleDateString() : 'saved position'}…`
          );
          await ActionLogMessage(
            `Chaining to historical from right edge ${fmtCursor(initialRight)}`
          );
          continue;
        }
        break; // right was terminal — full sync already done, just caught up
      }

      // ── Caught up to existing data (catching_up phase only) ────────
      if (phase === 'catching_up' && catchUpTarget && nextCursor.time <= catchUpTarget.time) {
        await ActionLogMessage(
          `Caught up to left edge (${fmtCursor(catchUpTarget)}) after ${pagesCount} pages`
        );

        // Chain into historical if right edge hasn't been fully crawled
        if (!isTerminalCursor(initialRight)) {
          phase = 'historical';
          currentCursor = initialRight!;
          previousCursorKey = '';
          await saveSyncState({ sync_phase: 'historical', sync_left_boundary: null });
          await updateStatus("updating_history",
            `Resuming deeper history from ${initialRight!.time ? new Date(initialRight!.time * 1000).toLocaleDateString() : 'saved position'}…`
          );
          await ActionLogMessage(
            `Chaining to historical from right edge ${fmtCursor(initialRight)}`
          );
          continue;
        }
        break; // right was terminal — everything already synced
      }

      currentCursor = nextCursor;
      await ActionLogMessage(`Next cursor: ${fmtCursor(nextCursor)}`);
    }

    // ── Finalize sync state ──────────────────────────────────────────
    // syncCompleted = true only if historical phase reached Steam's end.
    // If right was already terminal before we started, the full history
    // was imported in a prior run — preserve that status.
    const rightWasAlreadyDone = hasExistingData && isTerminalCursor(initialRight);
    const isNowComplete = syncCompleted || rightWasAlreadyDone;
    await saveSyncState({
      ...(isNowComplete ? { sync_completed: true } : {}),
      ...(phase === 'historical' ? { history_cursor: currentCursor } : {}),
    });

  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      await ActionLogMessage("Operation stopped by user", "warn");
      await updateStatus("idle", "Stopped by user");
      return;
    }

    await ActionLogMessage(`Error loading inventory history: ${e}`, "error");
    await updateStatus("error", `Error loading inventory history: ${e}`);
    return;
  } finally {
    activeAbort = null;
    // Clear transient sync state; preserve history_cursor + sync_completed
    await saveSyncState({ sync_phase: null, sync_cursor: null, sync_left_boundary: null, sync_pages_fetched: null });
    await ActionLogMessage(`Finished loading inventory history for steamId ${msg.steamId}`);
  }

  // Don't overwrite the 'warning' status that was set inside the loop
  if (!corruptionDetected) {
    await updateStatus("idle", "Idle");
  }
}

// =============================================================================
// Offscreen Communication
// =============================================================================

/**
 * Sends inventory history request to offscreen document.
 * @param profileBaseUrl - The resolved Steam profile base URL (already redirect-resolved)
 * @param token - Steam login token
 * @param auth - Backend auth token
 * @param startCursor - Pagination cursor
 */
export async function sendToOffscreen(
  profileBaseUrl: string,
  token: string | null,
  auth: string | null,
  startCursor: Cursor | null,
) {
  const granted = await hasPermission([], ["https://steamcommunity.com/*"]);

  if (!granted) {
    throw new Error(
      "Must have steamcommunity.com permissions to access inventory history"
    );
  }

  await openOffscreenDocument();

  const resp = await chrome.runtime.sendMessage({
    type: "load-inventory-history",
    target: "offscreen",
    profileBaseUrl, // Pass resolved URL instead of steamId
    token,
    auth,
    startCursor,
  });

    // Check if offscreen signaled it should be closed (WASM workaround for tlsn issue #959)
    if (resp?.shouldShutdown) {
        const hasExistingContext = await chrome.offscreen.hasDocument();

        if (hasExistingContext) {  
            await ActionLogMessage("Closing offscreen document to reset WASM state (preventing thread overflow panic)");
            await chrome.offscreen.closeDocument();
        }
    }

  if (resp?.success === false && resp?.error) {
    // Preserve Steam HTTP status for corruption detection in the retry loop
    if (resp.httpStatus && resp.httpStatus === 500) {
      throw new SteamServerError(resp.error, resp.httpStatus);
    }
    throw new Error(`Offscreen processing failed: ${resp.error}`);
  }

  return true;
}