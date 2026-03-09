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
