# Axiom Paper Trader — Design Spec

Date: 2026-09-03
Status: Approved for implementation planning

## 1. Overview

A Chrome extension (Manifest V3) that adds accurate, persistent paper (simulated)
trading with virtual SOL directly on axiom.trade. It replaces an existing
low-quality extension of the same kind, whose two core bugs this design fixes
by construction:

1. **No position aggregation** — the existing extension creates a new row per
   purchase of the same token instead of merging into one position with a
   weighted-average entry price.
2. **No persistent background state** — positions stop updating and the
   extension breaks when the user navigates away from the token's page or
   closes the tab.

## 2. Goals

- Simulate buying/selling tokens on axiom.trade with virtual SOL, with **zero
  real transactions ever sent** (no wallet connection required for the trade
  itself).
- One consolidated position per token (mint address), not one row per trade.
- Positions and their PnL keep updating live in the background regardless of
  which page/tab is open.
- Buy/sell actions feel instant — the UI updates optimistically from the
  price already on screen, not gated on a network round-trip.
- Visually and behaviorally match Axiom's native buy/sell panel as closely as
  possible (same preset amounts, same sell percentages, hover tooltips
  showing the exact amount before committing, same color language).
- A separate persistent portfolio view (Chrome Side Panel) shows all open
  positions with live PnL, styled as a clean asset list (Phantom-wallet-style
  rows: icon, name, quantity, USD value, PnL), independent of which
  axiom.trade page is currently open.
- A toolbar **popup** (quick account/balance glance, like a wallet extension)
  as a second entry point, with a one-click expand into the full Side Panel.
- Onboarding lets the user set their starting virtual balance either in SOL
  directly (presets + custom) or in USD, converted to SOL at the live market
  rate.
- The user can top up or withdraw virtual SOL from their balance at any time
  after onboarding, in addition to a full account reset.
- A portfolio analytics view with a PnL trend graph and a PnL calendar
  (daily heatmap), switchable, so this doubles as a practice/journaling tool
  for new traders before they risk real capital.
- Token identity (name, image/icon) is scraped from Axiom's own DOM so
  positions in our UI show the same icon/name the user sees on Axiom,
  reinforcing the "feels native" goal.
- Trade fills use real market data throughout, not synthetic numbers:
  Jupiter's quote API for the real execution price at the given trade size
  (so it reflects real liquidity/price impact), and Axiom's own displayed
  priority fee deducted at the real amount — everything grounded in real
  data, nothing fabricated.

## 3. Non-goals (explicitly deferred)

- No limit orders, stop-loss, take-profit, or trailing-stop order types —
  market buy/sell only for v1.
- No real wallet connection or real transactions, ever.
- No multi-DEX/multi-chain support — Solana/axiom.trade only.
- No cloud sync — all data is local to the browser profile
  (`chrome.storage.local`).
- No RugCheck API integration — the Rug badge is read from Axiom's own DOM,
  same as name/image/MC. Keeps the permission surface and API dependency
  count down; can be revisited if Axiom's own badge proves unreliable.

## 4. Architecture

Five pieces, Manifest V3:

1. **Content script** — injected into axiom.trade token pages. Owns trade
   interception, DOM scraping (price, token name/image/MC/rug badge), and
   the on-page buy/sell widget replica.
2. **Background service worker** — owns the position/PnL engine as the
   authoritative source of truth, and periodic background price refresh via
   `chrome.alarms`.
3. **Popup UI** — toolbar-icon quick view (balance, top positions), with a
   button to expand into the full Side Panel.
4. **Side Panel UI** — persistent, portfolio-wide view (Chrome Side Panel
   API), stays open across navigation and tab switches. Positions,
   History, Analytics (trend/calendar), Settings.
5. **`chrome.storage.local`** — single persisted store for `settings`,
   `balanceSol`, `positions`, `tradeHistory`, and `portfolioSnapshots`.

```
content script (per token page)      popup (quick view)   side panel (persistent)
  - intercept buy/sell click                                - all open positions
  - scrape name/image/MC/rug                                - trade history
  - read trade params from DOM                               - analytics (trend/calendar)
  - optimistic local update                                  - settings, balance top-up/reset
  - render on-page widget
        |                                    |                        |
        v                                    v                        v
        --------------- background service worker ---------------------
                    - position/PnL engine (shared module)
                    - chrome.storage.local read/write
                    - chrome.alarms -> price refresh loop + snapshot capture
                    - price API client: Jupiter (primary, incl. SOL/USD)
                      -> DexScreener (fallback) -> pump.fun API (bonding-curve
                      tokens not yet indexed elsewhere)
```

## 5. Trade interception (content script)

A capturing click listener attaches to Axiom's real Buy/Sell buttons
(selectors identified during implementation by inspecting the live site).
When paper-mode is enabled:

- `preventDefault` / `stopPropagation` fires before Axiom's own handler, so
  no real transaction is ever built or sent to a wallet.
- Trade params are read directly from the surrounding DOM at click time:
  token mint/symbol, SOL amount (from the selected preset or custom input),
  and Axiom's own currently displayed priority fee (SOL) and slippage
  tolerance (%) for that trade — real values Axiom itself shows, not
  invented ones.
- The fill price itself is not just the flat displayed spot price: the
  content script calls Jupiter's quote API with the real trade size to get
  the actual expected execution price for that size, which inherently
  reflects real liquidity/price impact for the token — larger trades
  against thinner liquidity get a worse fill, same as a real trade would.
  The flat DOM-displayed price is used only as an immediate fallback if the
  quote call hasn't returned yet, then reconciled once it does.
- The scraped priority fee (SOL) is deducted from `balanceSol` alongside
  the trade itself, same as a real transaction would cost — so paper PnL
  reflects real transaction cost, not just price movement.
- The position engine (see §7) is called synchronously with these params and
  updates local state **immediately** — this is what makes the trade feel
  instant, matching Axiom's own responsiveness.
- The update is then persisted to `chrome.storage.local` asynchronously in
  the background; the UI does not wait on this.
- A small on-page confirmation (toast near the button) shows what was
  bought/sold and the resulting PnL, matching Axiom's own feedback style.

**Trade-off noted and accepted:** DOM click interception is simpler than
reverse-engineering Axiom's internal API/transaction-building calls, but is
more fragile if Axiom redesigns their UI. If selectors break often after
launch, a network-level interception fallback (hooking `fetch`/`XHR` for
Axiom's order-building request) can be added later — out of scope for v1.

## 6. On-page widget (native-match UI)

Replicates Axiom's actual buy/sell panel, styled 1:1 to match:

- Dark navy theme, rounded pill buttons.
- Buy side: green accents, preset SOL amounts (0.1 / 0.25 / 0.5 / 1 / 2 / 5),
  custom amount input.
- Sell side: pink/red accents, percentage presets (25% / 50% / 100%).
- Hovering any preset button shows a tooltip with the exact SOL/USD amount
  that button will trade, computed live from the current position and price
  — before the user commits.
- Position summary shown inline: token name, image/icon, symbol, MC, Rug
  badge (all scraped from the page — no separate risk API integration in
  v1), avg entry price (USD), PnL shown as both SOL and %.
- Exactly **one** summary row per token — never a growing list of past buys.
  Historical individual trades are still recorded (see §8) but do not render
  here.

## 7. Position & PnL engine (shared module)

Positions are keyed by token mint address. This module is pure logic (no DOM,
no chrome APIs) so it can be unit tested directly, and is used by both the
content script (optimistic update) and the background worker (authoritative
recompute + background price refresh).

- **Buy into new position:** creates a position with quantity = amount
  bought, entry price = trade price.
- **Buy into existing open position:** `newQty = oldQty + boughtQty`;
  `avgEntry = (oldQty * oldAvgEntry + boughtQty * tradePrice) / newQty`.
  Never creates a second row for the same mint.
- **Sell (partial or full):** reduces quantity by the sold amount; realizes
  PnL for the sold portion as `(tradePrice - avgEntry) * soldQty`; avg entry
  is unchanged for the remaining quantity. Position is removed once quantity
  reaches zero.
- **Unrealized PnL** (for display): `(currentPrice - avgEntry) * qty`, both
  as an absolute SOL amount and a %.

## 8. Trade history

Every buy/sell event (not just the consolidated position state) is appended
to a `tradeHistory` list in storage for the Side Panel's History tab. This is
where the granular per-trade record lives — it never renders as separate
rows in the live position view (§6).

## 9. Background price refresh

- `chrome.alarms` wakes the service worker every 1 minute (the MV3 minimum
  alarm interval) to refresh prices for **all** currently open positions,
  regardless of which tab/page is open. This is what fixes the "freezes when
  I leave the page" bug. On each tick it also appends a lightweight
  `portfolioSnapshots` entry (see §11) feeding the analytics view.
- **Price source resolution, in order:**
  1. Jupiter Price API — primary for both token prices and the live SOL/USD
     rate (used for the USD→SOL onboarding conversion too), covers any
     token with real liquidity.
  2. DexScreener — fallback for tokens not yet indexed by Jupiter.
  3. pump.fun frontend API — for tokens still on the bonding curve (brand
     new, pre-graduation), which won't appear in either of the above yet.
     This is a REST call on each alarm tick, same cadence as the others.
- **Real-time tier:** while the Side Panel (or popup) is open, it polls
  faster (every 5–10s) for tokens on Jupiter/DexScreener. The websocket
  connection, when active, lives in the Side Panel's page context (not the
  service worker) because MV3 service workers are non-persistent and cannot
  reliably hold a long-lived socket open — see §16. When the Side Panel is
  closed, everything falls back to the 1-minute REST-polled alarm cadence.
- **REVISED 2026-09-03 — the pump.fun REST tier is removed; price resolution is two
  tiers, Jupiter then DexScreener.** Verified against the live services: pump.fun v3
  carries no price field at all (so the tier had been returning null on every call), v2
  is now 503 and outside the manifest host permissions (so calls to it were CORS-blocked
  before reaching the network), and the tier was redundant regardless — Jupiter priced a
  pump.fun mint eight seconds after its creation while DexScreener had a pair but no
  price. Deriving price from the bonding curve was rejected deliberately: reserves are
  denominated in whichever mint the curve quotes (a live coin quoted in USDC, not SOL)
  and scaled by two decimals fields, so a subtly wrong derivation writes a
  plausible-but-wrong entry price into cost basis permanently. pump.fun remains an
  identity source (name/symbol/image) at v3.
- **REVISED 2026-09-03 — the `pumpportal.fun` websocket tier is opt-in and
  inert by default.** The original design assumed a keyless subscription.
  Verifying the live service during implementation showed otherwise: it
  answers a keyless `subscribeTokenTrade` with *"only available when
  connecting with an API key funded with at least 0.02 SOL"*, and meters
  token-trade events at ~0.01 SOL per 10,000. Only `subscribeNewToken` and
  `subscribeMigration` are free. That requirement contradicts this project's
  first non-negotiable — no wallet connection anywhere (§3) — and it
  contradicts the product's premise, since demanding real SOL to practise
  paper trading defeats the point. **Resolution:** the module opens no socket
  and returns a no-op unless the user supplies their own API key; bonding-curve
  tokens are priced by the pump.fun REST tier above, which already covers them
  at both cadences. Nothing in the product's promised behaviour depended on the
  websocket — it was only ever described here as a "while watching"
  enhancement, never a background guarantee. If a user opts in with their own
  funded key, the fast path switches on for them alone; the extension itself
  still never holds or connects a wallet.
- Refreshed prices update `chrome.storage.local`; the Side Panel and popup
  listen for storage changes and re-render reactively.
- **Sync on reopen:** `chrome.alarms` only fires while Chrome itself is
  running — not while the browser is fully closed. Positions and balance
  are always safe (`chrome.storage.local` is disk-backed and survives full
  browser restarts), but their prices can go stale while Chrome is closed.
  To cover that gap, a refresh is triggered immediately (not waiting for the
  next alarm tick) on: `chrome.runtime.onStartup` (browser relaunch), and
  every time the popup or Side Panel is opened. This is what guarantees that
  reopening the extension after any gap — minutes or days — immediately
  shows real current prices and correct up-to-date PnL for every held
  position, not stale numbers from before the gap.

## 10. Onboarding & balance management

First install shows a short startup animation, then the balance setup step:
choose a starting virtual balance either as SOL directly (presets, e.g. 1 /
2 / 5 / 10 SOL, plus custom) or as a USD amount, converted to SOL at the
live Jupiter SOL/USD rate. This is a one-time setup; `balanceSol` afterward
is just a stored number.

After onboarding, the user can from Settings at any time:

- **Top up** — add virtual SOL to `balanceSol` (SOL or USD input, same
  live-rate conversion).
- **Withdraw** — remove virtual SOL from `balanceSol` (capped at the
  current available, non-position-locked balance).
- **Reset account** — clears `positions`, `tradeHistory`, and
  `portfolioSnapshots`, and re-runs the balance setup step.

## 11. Popup + Side Panel UI (two entry points, one data source)

Both read/write the same `chrome.storage.local` state — there is no
separate "popup state" — so opening either one always reflects the other's
latest changes.

**Popup** (toolbar icon): a quick glance — total balance, total PnL, top
3-4 open positions — styled like the Phantom-style asset list. An "Expand"
button calls `chrome.sidePanel.open()` to hand off to the full view.

**Side Panel** (persistent, portfolio-wide), with tabs:

- **Positions** (default) — all open positions, Phantom-style rows (icon,
  name, qty, USD value, PnL), live PnL.
- **History** — flat log of past trades from `tradeHistory`.
- **Analytics** — a PnL trend graph (cumulative PnL over time, built from
  `portfolioSnapshots`) and a PnL calendar (daily heatmap, bucketed from the
  same data), with a toggle to switch between the two views.
- **Settings** — paper-mode on/off toggle, top up / withdraw, account
  reset.
- Portfolio-level stats header: total paper SOL balance, total PnL, win
  rate.

This view stays open and live-updating independent of which axiom.trade page
(or whether any axiom.trade tab) is currently focused.

## 12. Storage schema (chrome.storage.local)

```
{
  "settings": { "paperModeEnabled": bool },
  "balanceSol": number,
  "positions": {
    "<tokenMintAddress>": {
      "symbol": string,
      "name": string,
      "imageUrl": string,
      "qty": number,
      "avgEntryUsd": number,
      "lastPriceUsd": number,
      "lastPriceUpdatedAt": timestamp,
      "priceSource": "jupiter" | "dexscreener" | "pumpfun",
      "stale": bool
    }
  },
  "tradeHistory": [
    { "id", "tokenMintAddress", "symbol", "side": "buy"|"sell",
      "qtySol", "priceUsd", "priorityFeeSol", "slippagePct", "timestamp" }
  ],
  "portfolioSnapshots": [
    { "timestamp", "balanceSol", "totalPositionValueSol", "totalPnlSol" }
  ],
  "schemaVersion": number
}
```

`schemaVersion` exists from v1 so future migrations don't require a hard
reset of user data. `portfolioSnapshots` is a rolling, capped-length array
(e.g. last ~180 days at one snapshot/alarm-tick-per-day resolution) feeding
the Analytics trend graph and calendar in §11 — old entries are pruned on
write rather than growing unbounded.

## 13. Error handling

- **Price API failure:** keep the last known price for that position, mark
  it `stale: true` in storage; UI shows a subtle stale indicator instead of
  breaking or blanking the value.
- **Axiom DOM selectors stop matching** (site redesign): the on-page widget
  shows a clear "trade interception unavailable" warning banner rather than
  silently failing to record a trade the user believes went through.
- **Storage write failure:** retry once; if it still fails, surface a
  non-blocking warning in the Side Panel — the optimistic in-memory state
  still reflects the trade for the current session.

## 14. Testing strategy

- **Unit tests** for the position/PnL module (§7): weighted-average cost
  basis on repeated buys, partial sells, full close, unrealized PnL math.
  This is the highest-value test surface since it's pure logic and was the
  main source of bugs in the existing extension.
- **Manual testing** against the live axiom.trade site for DOM interception,
  on-page widget rendering, and Side Panel behavior — this cannot be
  meaningfully unit tested since it depends on Axiom's live, unversioned
  DOM.

## 15. Visual & motion design

The on-page widget is a pinned 1:1 replica of Axiom's own visual language —
that counts as an already-established world, not an open choice. The popup
and Side Panel extend that same world rather than inventing a separate
identity; a second, disconnected look across surfaces would itself read as
unpolished. Concretely:

- **Color:** near-black navy ground (inherited from Axiom), green/pink as
  the only saturated accents (buy/sell semantics, PnL sign), everything
  else neutral gray-scale. No gradients, no glassmorphism, no glowing neon
  edges.
- **Typography:** a geometric UI sans (Space Grotesk or Outfit) for labels
  and chrome, paired with a monospace (Space Mono or IBM Plex Mono) for all
  numeric data — prices, SOL amounts, PnL. Monospace numerals are a
  functional choice, not a vibe: it's what keeps tabular figures aligned
  and legible as they update, which matters more here than in a typical
  app.
- **Motion, treated as material rather than decoration:**
  - Price ticks flash briefly green/red on update rather than just
    changing color statically.
  - PnL numbers roll/count rather than snap to the new value.
  - The on-page trade confirmation toast slides in from the button that
    triggered it.
  - The Side Panel opens as a real sliding panel, not a fade.
  - A short "terminal boot" intro animation (~400-600ms scan-line or
    candle-draw motif) plays every time the popup/Side Panel opens — a
    deliberate signature moment, not a generic splash/logo fade.
  - No skeleton shimmer loaders; use purposeful reveal instead.
- **Icon/favicon:** a distinctive mark in Axiom's own pill-badge visual
  language (as seen in its MC/Rug badges) — e.g. a duotone green/pink
  candlestick glyph in a rounded badge — rather than a generic chart-line
  icon.
- **Token imagery:** real token icons/images and names are scraped from
  Axiom's DOM (§6, §15 note) wherever available, rather than placeholder
  art, so positions look identical to what the user sees on Axiom itself.

This direction is a starting contract for implementation, not final pixel
values — it gets refined against the real Axiom page during the build
itself.

## 16. Open risks

- Axiom's DOM structure is unversioned and can change at any time; selector
  breakage is the main long-term maintenance risk (mitigated by the warning
  banner in §13, not eliminated).
- MV3 service workers are non-persistent; the 1-minute `chrome.alarms`
  minimum is the practical floor for background refresh cadence when no
  Side Panel is open.
- Rug badge / MC / name / image in the on-page widget are read from Axiom's
  own page in v1 rather than a separate API — if that data isn't present in
  the DOM at click time, it's simply omitted from that trade's confirmation
  rather than blocking the trade.
- The `pumpportal.fun` websocket (§9) is inert unless a user supplies their
  own funded API key, because the service gates token-trade streams behind a
  wallet-funded key that this project will not require. Bonding-curve tokens
  are therefore priced by REST polling of the pump.fun API at both cadences.
  Even when a user does opt in, the socket only runs while the Side Panel or
  popup page is open, since a persistent socket can't reliably live inside a
  non-persistent MV3 service worker.
- **The single largest remaining unknown is whether Axiom's real DOM matches
  `SELECTORS` in `src/content/dom-scraper.js`.** Those selectors are
  placeholders: axiom.trade serves logged-out visitors a marketing page and
  puts token pages behind a bot challenge, so no automated agent can read the
  real trading UI. Until a human opens a logged-in token page, fills in the
  real selectors, and confirms interception, `findBuyButton()` returns null
  and the extension is inert on the live site. Every layer beneath it —
  position engine, storage, price sourcing, background refresh, UI — is
  independently tested and does not depend on this being resolved first.
