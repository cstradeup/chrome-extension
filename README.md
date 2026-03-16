# CSTRADEUP Extension

Chrome extension for [cstradeup.net](https://cstradeup.net) — sync your Steam CS2 inventory and trade-up history to track your portfolio, analyze trade-ups, and claim cashback tickets.

## Features

- **Inventory sync** — Automatically picks up your CS2 inventory from Steam and sends it to cstradeup.net so you can simulate tradeups with private skins.
- **History crawl** — Walks through your full Steam inventory history (trade-ups, storage unit moves, etc.) to provide a complete view of portfolio value over time and display statistics on past trade-ups.
- **Cashback tickets** — Claim tickets on trade-ups done after your join date. Uses [TLSNotary](https://tlsnotary.org/) to cryptographically prove the data came from Steam.

## How it works

The extension runs offscreen scripts to `steamcommunity.com` on your behalf to fetch inventory and history data. Data is relayed to your [cstradeup.net](https://cstradeup.net) account and nowhere else.

For cashback tickets, we use TLS Notarization — a process that creates a cryptographic proof that inventory history genuinely came from Steam, without ever exposing your session cookies. This implementation was heavily inspired by [CSFloat's extension](https://github.com/csfloat/extension), and we're very grateful for their work.

## Privacy

Full details in [PRIVACY.md](PRIVACY.md).

## Development

### Setup

```bash
pnpm install
```

### Build

```bash
# Production
pnpm run build:webpack

# Development (source maps, localhost:3000)
pnpm run dev
```

Load the `build/` folder in Chrome via `chrome://extensions` → **Load unpacked**.

## Acknowledgments

- [CSFloat](https://github.com/csfloat/extension) — the notarization flow in this extension is heavily inspired by their open-source implementation.
- [TLSNotary](https://tlsnotary.org/) — the protocol that makes trustless data verification possible.

## License

[MIT](LICENSE)
