# CSTRADEUP Extension

<p align="center">
  <a href="https://cstradeup.net/">
    <img width="500" src="https://github.com/user-attachments/assets/7592a51b-efcc-4f62-acab-8b9cb2cc7c7d"/>
  </a>
</p>

[![Chrome Web Store Last Updated](https://img.shields.io/chrome-web-store/last-updated/mgaanpfefgbbefngpkijphdbklkmedbj?style=flat)](https://chromewebstore.google.com/detail/mgaanpfefgbbefngpkijphdbklkmedbj)
[![Chrome Web Store Version](https://img.shields.io/chrome-web-store/v/mgaanpfefgbbefngpkijphdbklkmedbj?style=flat)](https://chromewebstore.google.com/detail/mgaanpfefgbbefngpkijphdbklkmedbj)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/cstradeup?style=flat)](https://www.reddit.com/r/cstradeup/)
[![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCwi3vkYFm5A4EurtpizlM4g?style=flat)](https://www.youtube.com/@CSTRADEUP)
[![X Follow](https://img.shields.io/twitter/follow/cstradeupnet?style=flat)](https://twitter.com/cstradeupnet)

Chrome extension for [cstradeup.net](https://cstradeup.net) — sync your Steam CS2 inventory and trade-up history to track your portfolio and analyze trade-ups.

## Features

- **Inventory sync** — Automatically picks up your CS2 inventory from Steam and sends it to cstradeup.net so you can simulate tradeups with private skins.
- **History crawl** — Walks through your full Steam inventory history (trade-ups, storage unit moves, etc.) to provide a complete view of portfolio value over time and display statistics on past trade-ups.

## How it works

The extension runs offscreen scripts to `steamcommunity.com` on your behalf to fetch inventory and history data. Data is relayed to your [cstradeup.net](https://cstradeup.net) account and nowhere else.

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

## License

[MIT](LICENSE)
