/**
 * Pure formatting helpers — no DOM access, no side effects.
 */

import type { AppStatus } from '../lib/storage/reducer/app';

/** Human-readable label for each operation phase. */
const STATUS_LABELS: Record<AppStatus, string> = {
    idle:               'Ready',
    updating_inventory: 'Syncing Inventory',
    updating_history:   'Syncing History',
    stopping:           'Stopping',
    error:              'Error',
    warning:            'History Incomplete',
};

export function statusLabel(status: AppStatus): string {
    return STATUS_LABELS[status] ?? status;
}

/** 
 * Formats elapsed milliseconds as "Xm Ys" or "Xs".
 * Returns empty string for non-positive values.
 */
export function formatElapsed(ms: number): string {
    if (ms <= 0) return '';

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/**
 * Relative time string: "3 minutes ago", "just now", etc.
 */
export function timeAgo(current: number, previous: number): string {
    if (!previous || previous === 0) return 'never';
    if (current === previous) return 'just now';

    const MS_MINUTE = 60_000;
    const MS_HOUR   = MS_MINUTE * 60;
    const MS_DAY    = MS_HOUR * 24;
    const MS_MONTH  = MS_DAY * 30;
    const MS_YEAR   = MS_DAY * 365;

    const elapsed = current - previous;

    if (elapsed < MS_MINUTE) return `${Math.round(elapsed / 1000)}s ago`;
    if (elapsed < MS_HOUR)   return `${Math.round(elapsed / MS_MINUTE)}m ago`;
    if (elapsed < MS_DAY)    return `${Math.round(elapsed / MS_HOUR)}h ago`;
    if (elapsed < MS_MONTH)  return `~${Math.round(elapsed / MS_DAY)}d ago`;
    if (elapsed < MS_YEAR)   return `~${Math.round(elapsed / MS_MONTH)}mo ago`;
    return `~${Math.round(elapsed / MS_YEAR)}y ago`;
}

/**
 * Formats a UNIX timestamp (seconds) as a locale date string.
 */
export function formatCursorDate(unixSeconds: number): string {
    if (!unixSeconds) return 'Never';
    return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * Compact date format for the progress timeline (e.g. "May 2011").
 */
export function formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Slightly longer date for the cursor indicator (e.g. "Jan 15, 2018").
 */
export function formatMediumDate(unixSeconds: number): string {
    if (!unixSeconds) return '';
    return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/**
 * Calculates crawl progress as a 0–100 percentage (full precision).
 *
 * The crawl moves backward from "now" toward the account creation date.
 *   progress = (now − cursorTime) / (now − accountCreated)
 *
 * Returns 0 when no cursor data is available, capped at 100.
 *
 * @param cursorTimeUnix  Current cursor position in UNIX seconds
 * @param accountCreatedMs  Account creation timestamp in milliseconds (Date.getTime())
 * @param nowMs  Reference "now" timestamp in milliseconds (defaults to Date.now())
 */
export function crawlProgress(
    cursorTimeUnix: number,
    accountCreatedMs: number,
    nowMs: number = Date.now(),
): number {
    if (!cursorTimeUnix || !accountCreatedMs) return 0;

    const cursorMs = cursorTimeUnix * 1000;
    const totalSpan = nowMs - accountCreatedMs;

    if (totalSpan <= 0) return 100; // edge: account created in the future

    const covered = nowMs - cursorMs;
    const pct = (covered / totalSpan) * 100;

    return Math.min(100, Math.max(0, pct));
}

/**
 * Formats a progress percentage for display.
 * - < 10 %: 1 decimal  ("3.7%")
 * - 10–99%: integer     ("42%")
 * - ≥ 99.5: "100"       (snap to finished)
 */
export function formatProgress(pct: number): string {
    if (pct <= 0) return '0';
    if (pct >= 99.5) return '100';
    if (pct < 10) return pct.toFixed(1);
    return Math.round(pct).toString();
}

/**
 * Calculates gap coverage progress for incremental sync (0–100).
 * Used when catching up newest items down to the existing left edge.
 *
 * @param syncCursorTimeUnix  Current crawl position (UNIX seconds)
 * @param boundaryTimeUnix  Target boundary — the left edge / newest synced point (UNIX seconds)
 * @param nowMs  Reference "now" in milliseconds
 */
export function catchingUpProgress(
    syncCursorTimeUnix: number,
    boundaryTimeUnix: number,
    nowMs: number = Date.now(),
): number {
    if (!syncCursorTimeUnix || !boundaryTimeUnix) return 0;

    const gapMs = nowMs - boundaryTimeUnix * 1000;
    if (gapMs <= 0) return 100;

    const coveredMs = nowMs - syncCursorTimeUnix * 1000;
    const pct = (coveredMs / gapMs) * 100;

    return Math.min(100, Math.max(0, pct));
}
