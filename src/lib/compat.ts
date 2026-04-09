/**
 * compat.ts — Build-time browser target constants.
 *
 * Values are injected by webpack DefinePlugin (see webpack.config.js).
 * Dead-code elimination removes unused branches at build time, so
 * Chrome-only code never ships in the Firefox bundle and vice-versa.
 *
 * Usage:
 *   import { IS_CHROME, IS_FIREFOX } from '../lib/compat';
 *
 *   if (IS_CHROME) {
 *     // Chrome-only code — tree-shaken from Firefox builds
 *   }
 */

declare const __BROWSER__: 'chrome' | 'firefox';

export const BROWSER: 'chrome' | 'firefox' = __BROWSER__;
export const IS_CHROME = BROWSER === 'chrome';
export const IS_FIREFOX = BROWSER === 'firefox';
