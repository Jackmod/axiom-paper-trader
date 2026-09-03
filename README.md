# Axiom Paper Trader

Chrome MV3 extension for accurate, persistent paper trading with virtual SOL on axiom.trade.

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
