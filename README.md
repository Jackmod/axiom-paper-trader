# Axiom Paper Trader

Chrome MV3 extension that adds paper trading with virtual SOL directly to [axiom.trade](https://axiom.trade) — practice trades against real live market data, with zero real transactions ever sent and no wallet connection required.

> **Status: work in progress.** Being built task-by-task from the plan in `docs/`. The core position/PnL engine and storage layer are in place; the UI surfaces and trade interception are not finished yet. Not usable end-to-end yet.

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
