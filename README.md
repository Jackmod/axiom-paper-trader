# Axiom Paper Trader

Chrome MV3 extension that adds paper trading with virtual SOL directly to [axiom.trade](https://axiom.trade) — practice trades against real live market data, with zero real transactions ever sent and no wallet connection required.

> **Status: feature-complete, pending one live-site step.** All 27 planned tasks are
> built and committed, with 298 passing tests, clean lint, and a working production
> build.
>
> **It is not usable on axiom.trade yet, and the reason is deliberate.** The CSS
> selectors in [`src/content/dom-scraper.js`](src/content/dom-scraper.js) are
> placeholders. axiom.trade serves logged-out visitors a marketing page and puts token
> pages behind a bot challenge, so they could not be read automatically — only a human
> on a logged-in token page can fill in the real ones. Until then `findBuyButton()`
> returns `null`, the extension shows its "trade interception unavailable" banner, and
> records nothing. Everything beneath that layer — position engine, storage, price
> sourcing, background refresh, all UI surfaces — is independently tested and does not
> depend on it.

## What it does

- **Intercepts Axiom's own Buy/Sell buttons** in paper mode, so trades feel native instead of happening in a bolted-on side UI — no real transaction is ever built or signed.
- **One position per token, properly aggregated.** Buying the same token repeatedly merges into a single position with a weighted-average entry price, rather than stacking a new row per purchase.
- **Positions persist and keep updating in the background** via `chrome.alarms`, and re-sync against live prices the moment you reopen the extension — so leaving the page (or closing Chrome) doesn't freeze or lose your positions.
- **Real market data throughout**, not synthetic numbers: Jupiter quote API for the actual execution price at your trade size (so real liquidity/price impact applies), with DexScreener and pump.fun fallbacks for brand-new bonding-curve tokens.
- **Portfolio view** in a Chrome Side Panel and toolbar popup: open positions, trade history, PnL trend graph and daily PnL calendar.

## Setup

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # production build to dist/ — load this unpacked via chrome://extensions
npm test         # Vitest: pure-logic unit tests + Preact component tests
npm run lint      # ESLint
npm run format    # Prettier
```

## Layout

- `src/lib/` — pure logic (position engine, storage, price sourcing). Zero chrome.*/DOM dependency, fully unit tested.
- `src/background/` — the MV3 service worker: message router, alarm-driven price refresh, balance actions.
- `src/content/` — content script: DOM scraping of axiom.trade, trade interception, the on-page widget.
- `src/popup/`, `src/sidepanel/` — the two persistent-portfolio UI surfaces (Preact).
- `src/ui/` — shared design tokens and motion primitives.

## Docs

- Design spec: `docs/superpowers/specs/2026-09-03-axiom-paper-trader-design.md`
- Product context: `PRODUCT.md`

## Finishing the live-site hookup

One human step remains. On a logged-in axiom.trade token page, open DevTools and read
the real selectors for the Buy button, the sell-percentage buttons, the SOL amount
input, the token name/symbol/image, the displayed price, market cap, rug badge, priority
fee and slippage. Put them in `SELECTORS` in `src/content/dom-scraper.js`, then update
the matching fixtures in `src/content/dom-scraper.test.js` and
`src/content/trade-interceptor.test.js` so the tests keep describing the real markup.

Then load `dist/` unpacked via `chrome://extensions` (Developer Mode) and walk it once:
fresh install → boot animation → onboarding → buy via Axiom's own button → buy the same
token again and confirm it merges into one averaged position rather than a second row →
sell a percentage → close Chrome entirely, reopen, and confirm prices re-sync.
