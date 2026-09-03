# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Retail Solana/memecoin traders who use axiom.trade, especially novice
traders who want to practice trade execution and strategy before risking
real capital. Confirmed directly by the user: "this is a tool for new
trader to use to practice before using real cap."

## Product Purpose

A Chrome extension that adds accurate, persistent paper (simulated) trading
with virtual SOL directly on axiom.trade. It exists to replace an existing
low-quality "Axiom Paper Trader" extension (2,000 installs, 3.0 stars off a
single review) whose two core failures this product fixes by construction:
no position aggregation (a new row per purchase instead of one averaged
position) and no persistent background state (positions freeze/break when
the user navigates away). Success means a trader can hold a realistic,
always-accurate simulated portfolio that behaves exactly like a real Axiom
account would, without ever touching real funds.

## Positioning

Unlike the incumbent extension, this one treats the on-page buy/sell panel
as a 1:1 replica of Axiom's own native widget (not a bolted-on separate UI),
consolidates trades into real weighted-average positions, and keeps prices
syncing in the background/on reopen via `chrome.alarms` and a disk-backed
store — so it behaves like a real trading account would, just with virtual
SOL.

## Operating Context

Used directly on axiom.trade token pages (on-page widget for placing
trades) and via a toolbar popup / Chrome Side Panel (persistent portfolio
view: positions, history, analytics, settings) that stays live regardless
of which page is open. No wallet connection or real transaction is ever
involved.

## Capabilities and Constraints

- Manifest V3 Chrome extension. No backend/server — all state in
  `chrome.storage.local`.
- Price data: Jupiter Price API (primary, incl. SOL/USD), DexScreener
  (fallback), pump.fun frontend API + `pumpportal.fun` websocket (for
  brand-new bonding-curve tokens; websocket only live while the Side
  Panel/popup is open).
- Token identity (name, image, MC, rug badge) is scraped from Axiom's own
  DOM rather than a separate API, to keep the permission/dependency surface
  small and stay visually in sync with what the user already sees.
- Must visually and behaviorally mirror Axiom's actual buy/sell widget:
  same preset SOL amounts, same sell percentages, same color language
  (green buy / pink sell), same responsiveness (instant optimistic UI
  update, no waiting on network).
- Out of scope for v1: limit/stop-loss/take-profit orders, real wallet
  connection, multi-chain support, cloud sync, RugCheck API integration.
- Full design spec: `docs/superpowers/specs/2026-09-03-axiom-paper-trader-design.md`.

## Brand Commitments

- Product name: "Axiom Paper Trader" (working name — same as the incumbent
  it replaces, since it's a personal-use replacement, not a store listing
  decision made yet).
- The on-page trading widget must match Axiom's actual visual identity
  (dark navy theme, pill-shaped buttons) as closely as possible — this is a
  binding constraint, not a stylistic suggestion.
- The persistent portfolio view (popup/Side Panel) should read as a clean
  asset list in the spirit of Phantom wallet's own UI (icon, name, balance,
  value rows), per user-supplied reference screenshot.
- Explicit anti-brief: no generic "AI slop" UI — no default gradient-heavy,
  generic-shadcn-looking design. Must feel modern, sleek, and
  motion-rich/fluid, with a distinctive extension icon/favicon.

## Evidence on Hand

- User-supplied screenshots (this conversation): Axiom's native buy/sell
  panel; the incumbent extension's broken per-purchase-row position list;
  Phantom wallet's asset list UI as a reference for the portfolio view.
- Incumbent extension listing:
  https://chromewebstore.google.com/detail/axiom-paper-trader/mekfkgmbopojjcmeajkciacfefnblgjk

## Product Principles

1. Simulate Axiom 1:1 — every visual and behavioral choice defaults to
   matching what Axiom's real UI already does, not inventing a parallel
   design language.
2. One position per token, always — never re-introduce the incumbent's
   per-purchase-row bug.
3. State is never allowed to go stale silently — background refresh plus
   sync-on-reopen keeps PnL accurate whether the user was gone a minute or
   a week.
4. Trades feel instant — optimistic local updates first, persistence and
   network calls happen invisibly after.
5. Practice tool, not a toy — accuracy and realism (real prices, real
   token identity, real market movement) matter more than gamification.

## Accessibility & Inclusion

Not yet established — no specific requirement raised by the user.
