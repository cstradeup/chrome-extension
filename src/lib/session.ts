import { CSTRADEUP_DOMAIN } from "./env";

/**
 * Session-checking utilities for the onboarding flow.
 *
 * Determines whether the user has the required active sessions
 * (Steam Community + CSTRADEUP) before allowing access to the extension.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingState = 'steam_required' | 'cstradeup_required' | 'ready';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates the current cookie state and returns which onboarding step
 * the user should be on.
 *
 *  1. `steam_required`     — No `steamLoginSecure` cookie on steamcommunity.com
 *  2. `cstradeup_required` — Steam is OK but no `auth` cookie for CSTRADEUP
 *  3. `ready`              — Both sessions are active
 */
export async function checkOnboardingState(): Promise<OnboardingState> {
    const hasSteam = await hasSteamSession();
    if (!hasSteam) return 'steam_required';

    const hasCstradeup = await hasCstradeupSession();
    if (!hasCstradeup) return 'cstradeup_required';

    return 'ready';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function hasSteamSession(): Promise<boolean> {
    const cookies = await chrome.cookies.getAll({
        domain: 'steamcommunity.com',
        name: 'steamLoginSecure',
    });
    return cookies.length > 0;
}

async function hasCstradeupSession(): Promise<boolean> {
    const cookies = await chrome.cookies.getAll({ domain: CSTRADEUP_DOMAIN, name: 'auth' });
    return cookies.length > 0;
}

// ---------------------------------------------------------------------------
// Locale Cookie Override
// ---------------------------------------------------------------------------

/**
 * Locale cookies that must be set on steamcommunity.com before any fetch
 * request from the offscreen document (or service worker).
 *
 * The Fetch API treats `Cookie` as a **forbidden header** — Chrome silently
 * drops any manually-set Cookie header and instead attaches cookies from the
 * browser's cookie jar.  By writing our desired locale values into the jar
 * *before* the request fires, we ensure the browser sends English / USD /
 * UTC defaults regardless of the user's Steam profile language setting.
 */
const STEAM_LOCALE_COOKIE_OVERRIDES: Record<string, string> = {
    Steam_Language: 'english',
    steamCurrencyId: '1',        // 1 = USD
    timezoneOffset: '0,0',       // UTC offset (seconds, DST flag)
    timezoneName: 'Etc/UTC',     // IANA timezone
};

const STEAM_COOKIE_URL = 'https://steamcommunity.com';

/**
 * Sets locale cookies on `steamcommunity.com` so that subsequent fetch
 * requests (with `credentials: "include"`) pick them up from the cookie jar.
 *
 * Chrome may already have locale cookies set by Steam on a different
 * domain variant (e.g. `steamcommunity.com` vs `.steamcommunity.com`).
 * We must remove ALL existing instances first, otherwise both get sent
 * and Steam reads the first (user's) value.
 *
 * Must be called from the **service worker** — `chrome.cookies` is not
 * available in offscreen documents.
 */
export async function ensureLocaleCookies(): Promise<void> {
    const names = Object.keys(STEAM_LOCALE_COOKIE_OVERRIDES);

    // 1. Remove every existing instance of these cookies (any domain variant)
    await Promise.all(
        names.map(async (name) => {
            const existing = await chrome.cookies.getAll({
                domain: 'steamcommunity.com',
                name,
            });
            await Promise.all(
                existing.map((c) =>
                    chrome.cookies.remove({
                        url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
                        name: c.name,
                    }),
                ),
            );
        }),
    );

    // 2. Set our overrides
    await Promise.all(
        Object.entries(STEAM_LOCALE_COOKIE_OVERRIDES).map(([name, value]) =>
            chrome.cookies.set({
                url: STEAM_COOKIE_URL,
                domain: '.steamcommunity.com',
                path: '/',
                name,
                value,
                secure: true,
                sameSite: 'lax',
            }),
        ),
    );
}
