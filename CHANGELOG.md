# Changelog

## 0.2.0 — 2026-11-07

- Support the 3.17 client prompt layout, with extraction checked against official 3.17.1 and 3.17.2 bundles. Read client versions from package/ASAR metadata or explicit `provision --app-version`.
- Replace retired billing/current discovery with billing/balance plans and capability buckets, preserving activation times and plan selection.
- Discover free grants from billing previews and explicit marketing banner/popup claim actions. Enable scheduled claims by default, with `ZCODE_AUTO_CLAIM=false` as an opt-out.
- Persist actual grant expiry and bounded retry holds so undated recurring offers are revisited. Respect provider server time, Retry-After, CAPTCHA, authentication and risk responses.
- Add `promos` for discovery without claims and `claim` for one maintenance cycle. Expose sanitized offers, campaigns and per-source failures through existing authenticated usage/plan APIs.
- Keep legacy private templates, encrypted account data and all existing API protocols compatible. No npm production dependencies added.

Live verification covered current billing, marketing, process health and HTTP authentication. The available account had no active grant; successful live claims and inference with 3.17.2 were not verified. See [verification](docs/verification.md).
