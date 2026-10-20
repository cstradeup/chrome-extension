# Privacy Policy

**Last updated:** March 2026

## Overview

This extension reads your Steam CS2 inventory and history from `steamcommunity.com` and sends it to `cstradeup.net` — nowhere else. The source code is public; you can verify every network call yourself.

## Data collected

- **Steam inventory** — items and descriptions, read from the Steam Community inventory API.
- **Inventory history** — trade-ups and storage unit movements, read from your Steam inventory history page.
- **Steam account age** — your "Member since" date, used for the profile progress bar.
- **Session cookies** — `steamLoginSecure` (Steam) and `auth` (cstradeup.net) are checked locally to determine whether you are logged in. They are never sent to any third party.

## Where data goes

All data is sent exclusively to **`https://cstradeup.net`**. No analytics, no trackers, no third-party services.

## Local storage

The extension stores the following in `chrome.storage.local`:

- Steam session info (Steam ID, profile URL, account creation date)
- CSTRADEUP auth token and sync cursor
- UI state (sync timestamps, item counts, operation status)
- Debug logs (timestamps and messages — no credentials)

## Cookie overrides

Before fetching inventory history, the extension temporarily sets locale cookies on `steamcommunity.com` (`Steam_Language`, `steamCurrencyId`, `timezoneOffset`, `timezoneName`) to get consistent English/USD/UTC responses.

## Your data on cstradeup.net

- You can **delete** your data at any time from the website.
- You can **export** your data as CSV at any time from the website.
- Local extension storage persists until you uninstall the extension or clear it manually.

## Contact

Open an issue on the [GitHub repository](https://github.com/cstradeup/extension) or reach out through [cstradeup.net](https://cstradeup.net).
