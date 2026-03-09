/**
 * Pure render functions — each takes data + element refs, updates DOM.
 * No storage reads, no side-effects beyond DOM mutation.
 */

import type { Elements } from './elements';
import type { AppState } from '../lib/storage/reducer/app';
import type { CSTRADEUPStore } from '../lib/storage/reducer/cstradeup';
import type { DevLogs } from '../lib/storage/reducer/logs';
import type { OnboardingState } from '../lib/session';
import { statusLabel, formatElapsed, timeAgo, formatCursorDate, formatShortDate, formatMediumDate, crawlProgress, catchingUpProgress, formatProgress } from './format';

// ---------------------------------------------------------------------------
// Onboarding Gate
// ---------------------------------------------------------------------------

/**
 * Shows exactly one view based on onboarding state:
 *   steam_required     → onboarding step 1
 *   cstradeup_required → onboarding step 2
 *   ready              → main content
 */
export function renderOnboarding(els: Elements, state: OnboardingState) {
    const views = {
        steam_required:     els.onboardingSteam,
        cstradeup_required: els.onboardingCstradeup,
        ready:              els.mainContent,
    };

    for (const [key, el] of Object.entries(views)) {
        if (!el) continue;

        if (key === state) {
            // Remove then re-add to retrigger CSS animation
            el.classList.remove('animate-fade-in');
            void el.offsetWidth;              // force reflow
            el.classList.add('animate-fade-in');
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }
}

// ---------------------------------------------------------------------------
// Status Panel
// ---------------------------------------------------------------------------

/** Show exactly one status section (idle | active | error | warning), hide the others. */
function showStatusSection(els: Elements, section: 'idle' | 'active' | 'error' | 'warning') {
    const map = { idle: els.statusIdle, active: els.statusActive, error: els.statusError, warning: els.statusWarning };
    for (const [key, el] of Object.entries(map)) {
        el?.classList.toggle('hidden', key !== section);
    }
}

export function renderStatus(els: Elements, state: AppState) {
    const { status, statusMessage } = state;

    const isBusy = status === 'updating_inventory' || status === 'updating_history' || status === 'stopping';

    // Button lock-out while any operation is active
    if (els.startBtn) els.startBtn.disabled = isBusy;
    if (els.startInventoryHistory) els.startInventoryHistory.disabled = isBusy;

    // Stop button: visible during active ops, disabled once stopping
    if (els.stopOperation) {
        els.stopOperation.disabled = status === 'stopping';
        els.stopOperation.textContent = status === 'stopping' ? '⏳ Stopping…' : '■ Stop';
    }

    if (status === 'idle') {
        showStatusSection(els, 'idle');
        return;
    }

    if (status === 'error') {
        showStatusSection(els, 'error');
        setText(els.statusErrorMsg, statusMessage);
        return;
    }

    if (status === 'warning') {
        showStatusSection(els, 'warning');
        setText(els.statusWarningMsg, statusMessage);
        return;
    }

    // Active operation (updating_inventory | updating_history | stopping)
    showStatusSection(els, 'active');
    setText(els.statusLabel, `${statusLabel(status)}…`);
    setText(els.statusDetail, statusMessage);
}

// ---------------------------------------------------------------------------
// History Crawl Progress Timeline
// ---------------------------------------------------------------------------

/**
 * Renders the visual progress timeline for history crawling.
 *
 * Dual-mode progress:
 *   - **historical** → progress tracks left edge from Now → Account Created
 *   - **catching_up** → progress tracks gap coverage from Now → Last Synced
 *   - **idle**        → static bar showing historical coverage
 *
 * Also drives the sync-state badge and contextual button label
 * via the internal `updateSyncState` helper.
 */
export function renderHistoryProgress(
    els: Elements,
    status: AppState['status'],
    cstradeup: CSTRADEUPStore | null,
    memberSinceIso: string | null | undefined,
) {
    const syncPhase = cstradeup?.sync_phase ?? null;
    const syncCompleted = cstradeup?.sync_completed ?? false;
    const historyCursorTime = cstradeup?.history_cursor?.time ?? 0;
    const syncCursor = cstradeup?.sync_cursor;
    const leftBoundary = cstradeup?.sync_left_boundary;
    const pagesFetched = cstradeup?.sync_pages_fetched ?? 0;

    // Always update badge + button text
    updateSyncState(els, status, cstradeup, memberSinceIso);

    const hasCursorData = !!historyCursorTime;
    const isHistoryOp = status === 'updating_history' || status === 'stopping';
    const isCatchingUp = syncPhase === 'catching_up';

    // During an active crawl, always show the progress container — even
    // without memberSince the page count and cursor date are useful.
    // When idle, require memberSince + cursor data to render a meaningful bar.
    if (!isHistoryOp && (!memberSinceIso || (!hasCursorData && !syncCompleted))) {
        els.historyProgressContainer?.classList.add('hidden');
        return;
    }

    const accountCreatedMs = memberSinceIso
        ? new Date(memberSinceIso).getTime()
        : NaN;
    if (isNaN(accountCreatedMs) && !isHistoryOp) {
        els.historyProgressContainer?.classList.add('hidden');
        return;
    }

    const now = Date.now();

    // ── Determine the best cursor for progress ───────────────────────
    // During an active sync, `sync_cursor` updates every page (reliable).
    // `history_cursor` only updates when the server's left_cursor changes,
    // which may lag or stay flat — using it alone makes the bar look stuck.
    const activeCursorTime = syncCursor?.time ?? 0;
    const bestCursorTime = (isHistoryOp && activeCursorTime)
        ? activeCursorTime
        : historyCursorTime;

    // ── Progress calculation ─────────────────────────────────────────
    let pct: number;

    if (syncCompleted && !isCatchingUp) {
        pct = 100;
    } else if (isNaN(accountCreatedMs)) {
        // Account creation date not yet loaded — can't compute percentage.
        // The minimum-bar-width rule below keeps the bar visible at 1.5 %.
        pct = 0;
    } else if (isCatchingUp && isHistoryOp && activeCursorTime && leftBoundary && leftBoundary.time > 0) {
        // Catching up: gap coverage from Now → left boundary (newest synced)
        pct = catchingUpProgress(activeCursorTime, leftBoundary.time, now);
    } else {
        // Historical (active or idle) — use whichever cursor is freshest
        pct = crawlProgress(bestCursorTime, accountCreatedMs, now);
    }

    // Show the container
    els.historyProgressContainer?.classList.remove('hidden');

    // Percentage text (adaptive precision: "3.7%" when low, "42%" when high)
    setText(els.progressPercentage, `${formatProgress(pct)}%`);

    // ── Contextual labels ────────────────────────────────────────────
    if (isCatchingUp && isHistoryOp) {
        // Catching-up mode: timeline shows Now → Last Synced
        setText(els.progressRightLabel, 'Last synced');
        // During catching_up, right label is the left edge (newest synced point)
        setText(els.progressAccountDate,
            leftBoundary?.time ? formatShortDate(new Date(leftBoundary.time * 1000)) : '');
        setText(els.progressCursorDate,
            pagesFetched > 0
                ? `Page ${pagesFetched}${activeCursorTime ? ` — ${formatMediumDate(activeCursorTime)}` : ''}`
                : 'Starting…');
    } else {
        // Historical / idle mode: timeline shows Now → Account Created
        setText(els.progressRightLabel, isNaN(accountCreatedMs) ? '' : 'Account created');
        setText(els.progressAccountDate, isNaN(accountCreatedMs) ? '' : formatShortDate(new Date(accountCreatedMs)));

        if (!bestCursorTime && isHistoryOp) {
            setText(els.progressCursorDate, 'Starting…');
        } else if (!isHistoryOp) {
            setText(els.progressCursorDate,
                historyCursorTime ? `At ${formatMediumDate(historyCursorTime)}` : '');
        } else {
            // Active historical crawl — show page count + date
            setText(els.progressCursorDate,
                `Page ${pagesFetched}${activeCursorTime ? ` — ${formatMediumDate(activeCursorTime)}` : ''}`);
        }
    }

    // ── Progress bar ─────────────────────────────────────────────────
    // Minimum 1.5% visual width during active sync so the bar is always
    // visible even when actual progress is < 1%.
    const barPct = isHistoryOp ? Math.max(pct, 1.5) : pct;
    const widthStyle = `${barPct}%`;
    if (els.progressBarFill) els.progressBarFill.style.width = widthStyle;

    // Shimmer: animated during active sync, hidden when idle
    if (els.progressBarShimmer) {
        els.progressBarShimmer.style.width = widthStyle;
        els.progressBarShimmer.style.opacity = isHistoryOp ? '0.6' : '0';
    }

    // Timeline "Now" label (always the left side)
    setText(els.progressNowDate, formatShortDate(new Date(now)));
}

// ---------------------------------------------------------------------------
// Sync State Badge + Contextual Button Label
// ---------------------------------------------------------------------------

/**
 * Updates the history sync-state badge and the button label to reflect the
 * current crawl state:
 *   - Not synced      → "Not synced" badge, "Start Full Sync" button
 *   - Partially synced → "XX%" badge, "Resume Sync" button
 *   - Fully synced     → "Synced" badge, "Sync Latest" button
 *   - Active sync      → animated badge, strategy button
 *   - Error            → "Error" badge, "Retry Sync" button
 */
function updateSyncState(
    els: Elements,
    status: AppState['status'],
    cstradeup: CSTRADEUPStore | null,
    memberSinceIso: string | null | undefined,
) {
    const badge = els.historySyncState;
    const btn = els.startInventoryHistory;

    const syncPhase = cstradeup?.sync_phase ?? null;
    const syncCompleted = cstradeup?.sync_completed ?? false;
    const historyCursorTime = cstradeup?.history_cursor?.time ?? 0;
    const syncCursorTime = cstradeup?.sync_cursor?.time ?? 0;

    const isHistoryActive = status === 'updating_history' || status === 'stopping';

    // Use sync_cursor during active sync (updates every page), fall back to
    // history_cursor when idle (persisted from last sync).
    const bestCursorTime = (isHistoryActive && syncCursorTime) ? syncCursorTime : historyCursorTime;
    const hasCursor = !!bestCursorTime;

    // Calculate completion percentage
    let pct = 0;
    if (hasCursor && memberSinceIso) {
        const accountCreatedMs = new Date(memberSinceIso).getTime();
        if (!isNaN(accountCreatedMs)) {
            pct = crawlProgress(bestCursorTime, accountCreatedMs, Date.now());
        }
    }

    const isFullySynced = syncCompleted || pct >= 99.5;

    if (badge) {
        // Reset to base classes
        badge.className = 'ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full';

        if (isHistoryActive) {
            const phaseLabel = syncPhase === 'catching_up' ? 'Catching up…' : 'Syncing…';
            badge.textContent = phaseLabel;
            badge.classList.add('text-teal-300', 'bg-teal-500/15', 'animate-pulse-gentle');
        } else if (status === 'error') {
            badge.textContent = 'Error';
            badge.classList.add('text-red-400', 'bg-red-500/15');
        } else if (status === 'warning') {
            badge.textContent = 'Incomplete';
            badge.classList.add('text-amber-400', 'bg-amber-500/15');
        } else if (isFullySynced) {
            badge.textContent = 'Synced';
            badge.classList.add('text-green-400', 'bg-green-500/15');
        } else if (hasCursor) {
            badge.textContent = `${formatProgress(pct)}%`;
            badge.classList.add('text-amber-400', 'bg-amber-500/15');
        } else {
            badge.textContent = 'Not synced';
            badge.classList.add('text-slate-500', 'bg-slate-500/10');
        }
    }

    if (btn) {
        if (isHistoryActive) {
            btn.textContent = syncPhase === 'catching_up' ? 'Catching up…' : 'Syncing…';
        } else if (status === 'error') {
            btn.textContent = 'Retry Sync';
        } else if (status === 'warning') {
            btn.textContent = 'Retry Sync';
        } else if (isFullySynced) {
            btn.textContent = 'Sync Latest';
        } else if (hasCursor) {
            btn.textContent = 'Resume Sync';
        } else {
            btn.textContent = 'Start Full Sync';
        }
    }

    // ── Contextual CTA zones ─────────────────────────────────────
    // Determine which state we're in for CTA display:
    //   - intro: never synced, idle (no cursor, not active, not error)
    //   - partial hint: partially synced, idle (has cursor, not fully synced)
    //   - complete: fully synced, idle
    //   - hidden: active sync or error
    const showIntro    = !isHistoryActive && !isFullySynced && !hasCursor && status !== 'error' && status !== 'warning';
    const showComplete = !isHistoryActive && (isFullySynced || status === 'warning') && status !== 'error';
    const showPartial  = !isHistoryActive && hasCursor && !isFullySynced && status !== 'error' && status !== 'warning';

    els.syncCtaIntro?.classList.toggle('hidden', !showIntro);
    els.syncCtaComplete?.classList.toggle('hidden', !showComplete);
    els.syncPartialHint?.classList.toggle('hidden', !showPartial);

    // Hide the metadata row when never synced ("Never" is not useful)
    els.syncMetadata?.classList.toggle('hidden', !hasCursor && !isFullySynced && !isHistoryActive);
}

// ---------------------------------------------------------------------------
// Live Counters (shown both in cards and inside active-status panel)
// ---------------------------------------------------------------------------

export function renderCounts(els: Elements, state: AppState) {
    setText(els.totalItems,    String(state.syncedInventoryItems ?? 0));
    setText(els.tradeupItems,  String(state.syncedTradeupItems ?? 0));
    setText(els.storageItems,  String(state.syncedStorageUnitItems ?? 0));

    // Mirror inside the active status panel
    setText(els.statusItems,    String(state.syncedInventoryItems ?? 0));
    setText(els.statusTradeups, String(state.syncedTradeupItems ?? 0));
    setText(els.statusStorage,  String(state.syncedStorageUnitItems ?? 0));
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

export function renderTimestamps(els: Elements, state: AppState, cstradeup: CSTRADEUPStore | null) {
    const now = Date.now();

    setText(els.inventoryLastUpdated, timeAgo(now, state.lastInventoryUpdate));
    setText(els.historyLastUpdated,   timeAgo(now, state.lastHistoryUpdate));
    setText(els.historyUpdatedUntil,  formatCursorDate(cstradeup?.history_cursor?.time ?? 0));
}

// ---------------------------------------------------------------------------
// Elapsed Time (called on a 1-second ticker)
// ---------------------------------------------------------------------------

export function renderElapsed(els: Elements, operationStartedAt: number) {
    if (!operationStartedAt) {
        setText(els.statusElapsed, '');
        return;
    }
    const elapsed = Date.now() - operationStartedAt;
    setText(els.statusElapsed, `⏱ Running for ${formatElapsed(elapsed)}`);
}

// ---------------------------------------------------------------------------
// Dev Logs
// ---------------------------------------------------------------------------

export function renderLogs(els: Elements, devLogs: DevLogs | null) {
    if (!els.logs || !devLogs) return;

    const formatted = devLogs.logs
        .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.message}`)
        .join('\n');

    if (formatted !== els.logs.textContent) {
        els.logs.textContent = formatted;
        els.logs.scrollTop = els.logs.scrollHeight;
    }
}

// ---------------------------------------------------------------------------
// Dev Store Debug
// ---------------------------------------------------------------------------

export function renderDebug(els: Elements, steam: Record<string, unknown> | null, cstradeup: Record<string, unknown> | null) {
    if (!els.debug) return;
    els.debug.textContent = [
        `steam_access_token: ${steam?.token ?? 'not set'}`,
        `steam_id: ${steam?.steam_id ?? 'not set'}`,
        `cstradeup_access_token: ${cstradeup?.auth ?? 'not set'}`,
        `profile_part: ${steam?.profile_part ?? 'not set'}`,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Devtools — Options
// ---------------------------------------------------------------------------

/** Sync the "Notarize Trade Ups" checkbox with persisted AppState. */
export function renderDevtoolsOptions(els: Elements, state: AppState) {

}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setText(el: HTMLElement | null, text: string) {
    if (el) el.textContent = text;
}
