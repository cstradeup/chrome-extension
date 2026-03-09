/**
 * Environment configuration — values are injected at build time via
 * webpack DefinePlugin (see webpack.config.js).
 *
 * During development:
 *   CSTRADEUP_HOSTNAME  = "http://localhost:3000"
 *   CSTRADEUP_DOMAIN    = "localhost"
 *
 * During production:
 *   CSTRADEUP_HOSTNAME  = "https://cstradeup.net"
 *   CSTRADEUP_DOMAIN    = "cstradeup.net"
 */

declare const __CSTRADEUP_HOSTNAME__: string;
declare const __CSTRADEUP_DOMAIN__: string;
declare const __IS_DEV__: boolean;

export const CSTRADEUP_HOSTNAME: string = __CSTRADEUP_HOSTNAME__;
export const CSTRADEUP_DOMAIN: string = __CSTRADEUP_DOMAIN__;
export const IS_DEV: boolean = __IS_DEV__;
