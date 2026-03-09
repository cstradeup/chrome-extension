/**
 * badge.ts — Extension badge management, tightly coupled to AppStatus.
 *
 * The badge gives users an at-a-glance indicator of what the extension
 * is doing: blue pulsing page count during sync, green when idle,
 * orange for warnings, red for errors.  Designed to reduce anxiety
 * during long-running background operations.
 */
import type { AppStatus } from './storage/reducer/app';

// ── Visual mapping ──────────────────────────────────────────────────────────

type BadgeVisual = 'idle' | 'loading' | 'warning' | 'error';

const STATUS_TO_VISUAL: Record<AppStatus, BadgeVisual> = {
    idle:                'idle',
    updating_inventory:  'loading',
    updating_history:    'loading',
    stopping:            'loading',
    error:               'error',
    warning:             'warning',
};

/** Calm, material-inspired palette. Blue for "working" reduces anxiety. */
const VISUAL_COLORS: Record<BadgeVisual, string> = {
    idle:    '#4CAF50',   // green  — all good
    loading: '#2196F3',   // blue   — working, relax
    warning: '#FF9800',   // orange — heads up
    error:   '#F44336',   // red    — something broke
};

/** Default badge text when no explicit text is provided. */
const DEFAULT_TEXT: Record<AppStatus, string> = {
    idle:                '',
    updating_inventory:  '…',
    updating_history:    '…',
    stopping:            '⏸',
    error:               '!',
    warning:             '⚠',
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Synchronize the extension badge with the current application status.
 *
 * @param appStatus  Current AppStatus value.
 * @param text       Optional override for badge text (e.g. page count "12").
 *                   When omitted, a sensible default per-status is used.
 */
export function syncBadge(appStatus: AppStatus, text?: string): void {
    const visual   = STATUS_TO_VISUAL[appStatus] ?? 'idle';
    const badgeText = text ?? DEFAULT_TEXT[appStatus] ?? '';
    const color    = VISUAL_COLORS[visual];

    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    chrome.action.setBadgeText({ text: badgeText });
}

/**
 * Clear the badge entirely (e.g. on extension startup before state is known).
 */
export function clearBadge(): void {
    chrome.action.setBadgeText({ text: '' });
}
