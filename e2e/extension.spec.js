import { test, expect, chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, mkdirSync } from 'node:fs'

// End-to-end against the REAL built extension in a REAL Chrome.
//
// The unit suite is large and green, and the extension still shipped broken more than
// once — a missing import made every click throw, and a widget with no positioning CSS
// rendered as a full-width banner. Neither is visible to a jsdom test, because both are
// about the extension actually loading and actually painting. This closes that gap.
//
// axiom.trade itself is bot-protected and cannot be automated, so the fixture below is
// served AT that origin via request interception: the content script matches on the URL,
// so it injects exactly as it would on the real site, against markup modelled on a live
// screenshot of Axiom's trade panel.

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'dist')
const SHOTS = join(HERE, 'screenshots')
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'axiom-token-page.html'), 'utf8')
const FEED_FIXTURE = readFileSync(join(HERE, 'fixtures', 'axiom-feed-page.html'), 'utf8')
const FEED_URL = 'https://axiom.trade/pulse'
const MINT = '31A8xLh6fwYavYvzdKeSsMjPGmK7RVz3Z4M5EG8Spump'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const TOKEN_URL = `https://axiom.trade/meme/${MINT}`

mkdirSync(SHOTS, { recursive: true })

async function launch() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    serviceWorkers: 'allow',
  })

  const page = await context.newPage()
  // Serve the fixture at axiom.trade so the content script's URL match applies.
  await context.route('https://axiom.trade/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: route.request().url().includes('/pulse') ? FEED_FIXTURE : FIXTURE,
    }),
  )
  // Everything else the page or extension reaches for is stubbed: a screenshot test must
  // not depend on live market data.
  // Answer for whichever mint is asked for. The extension asks for the token AND for
  // wrapped SOL (it needs the SOL/USD rate to convert what the user spends into tokens),
  // so a stub keyed only to the token silently starves every trade of its rate.
  await context.route('**://lite-api.jup.ag/price/**', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids') ?? ''
    const body = Object.fromEntries(
      ids
        .split(',')
        .filter(Boolean)
        .filter((id) => id === SOL_MINT || id === MINT)
        .map((id) => [id, { usdPrice: id === SOL_MINT ? 200 : 0.000004521, decimals: id === SOL_MINT ? 9 : 6 }]),
    )
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  // A quote consistent with the spot price above, because an inconsistent one produces a
  // position that is instantly down 99% and would hide real bugs behind fake ones:
  // 0.25 SOL at $200/SOL = $50; at $0.000004521/token that is 11,059,499 tokens, which
  // with 6 decimals is 11059499000000 base units.
  await context.route('**://lite-api.jup.ag/swap/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ inAmount: '250000000', outAmount: '11059499000000', swapUsdValue: '50' }),
    }),
  )
  await context.route('**://api.dexscreener.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ pairs: [{ liquidity: { usd: 12700 }, priceUsd: '0.000004521', baseToken: { name: 'Desi 84', symbol: 'DESI' }, info: {} }] }),
    }),
  )
  await context.route('**://frontend-api-v3.pump.fun/**', (route) => route.fulfill({ status: 404, body: '{}' }))

  return { context, page }
}

const widget = (page) => page.locator('#axiom-paper-trader-root')

test('the widget actually renders on a token page', async () => {
  const { context, page } = await launch()

  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: join(SHOTS, '01-widget-on-token-page.png'), fullPage: false })

  // It must float over the page, not push it around: an earlier build appended a
  // full-width block to <body> and shoved Axiom's entire UI down.
  const box = await widget(page).boundingBox()
  expect(box.width).toBeLessThan(400)
  const viewport = page.viewportSize()
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)

  await context.close()
})

test('it identifies the token the user is looking at', async () => {
  const { context, page } = await launch()

  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  // Name and price come from the APIs and the page, not from a hardcoded guess.
  await expect(widget(page)).toContainText(/DESI|Desi 84/i, { timeout: 15000 })
  // The price must keep its significant digits. Rendered with a fixed 4 decimal places
  // this token would read "$0.0000" — every memecoin would look identical and a 10x move
  // would show no change at all.
  await expect(widget(page)).toContainText('$0.000004521')
  await page.screenshot({ path: join(SHOTS, '02-token-identified.png') })

  await context.close()
})

test('clicking an amount preset does NOT record a trade', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  // On Axiom a preset only types a number into the field. Booking a purchase from that
  // would invent a trade out of a keystroke.
  await page.locator('.presets button', { hasText: '2' }).first().click()
  await page.waitForTimeout(500)

  await expect(widget(page)).not.toContainText('Holding')
  await expect(page.locator('#amount')).toHaveValue('2') // Axiom's own handler still ran

  await context.close()
})

test('buying through Axiom’s submit button records a position and never triggers a real trade', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  await page.fill('#amount', '0.25')
  await page.locator('button.submit', { hasText: 'Buy DESI' }).click()

  // The paper position appears...
  await expect(widget(page)).toContainText('Holding', { timeout: 15000 })
  await page.screenshot({ path: join(SHOTS, '03-after-buy.png') })

  // ...and the page's own trade handler never fired. This is the zero-real-transactions
  // guarantee, checked against a real browser rather than a simulated event.
  expect(await page.evaluate(() => window.__realTradeAttempts)).toBe(0)

  // A position opened at the current price must sit near break-even. This is the single
  // best end-to-end guard against the whole family of unit bugs that plagued this build:
  // SOL stored where tokens belong, a hardcoded token-decimals guess, a fill price in the
  // wrong currency. Every one of them shows up here as an instant, absurd loss — which is
  // exactly what the user saw on the real site (-21 SOL, -95.6%).
  const pnlText = await widget(page).innerText()
  const pnlPct = Number(/\(([-+]?[\d.]+)%\)/.exec(pnlText)?.[1])
  expect(Number.isFinite(pnlPct)).toBe(true)
  expect(Math.abs(pnlPct)).toBeLessThan(5)

  await context.close()
})

test('the side panel page renders the portfolio', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  // Extension pages are addressable directly, which is the only way to screenshot the
  // side panel without driving Chrome's own side-panel chrome.
  const extensionId = context
    .serviceWorkers()[0]
    ?.url()
    ?.split('/')[2]
  test.skip(!extensionId, 'service worker not registered yet')

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)
  await expect(panel.locator('body')).toContainText(/Balance|starting balance/i, { timeout: 15000 })
  await panel.screenshot({ path: join(SHOTS, '04-side-panel.png') })

  await context.close()
})

test('on a discovery feed it does NOT latch onto a coin from the list', async () => {
  const { context, page } = await launch()
  await page.goto(FEED_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  // Reported live: standing on Pulse with nothing open, the widget picked a coin out of
  // the listing and offered to trade it. That is one click from a position in a token the
  // user never opened — worse than detecting nothing at all.
  await expect(widget(page)).toContainText(/No token open/i)
  await expect(widget(page)).not.toContainText(/Crap coin/i)
  await expect(page.getByRole('button', { name: 'Buy 0.25 SOL' })).toBeDisabled()
  await page.screenshot({ path: join(SHOTS, '05-feed-no-token.png') })

  await context.close()
})

test('a position can be closed from the side panel, with no Axiom page in sight', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  await page.fill('#amount', '0.25')
  await page.locator('button.submit', { hasText: 'Buy DESI' }).click()
  await expect(widget(page)).toContainText('Holding', { timeout: 15000 })

  const extensionId = context.serviceWorkers()[0]?.url()?.split('/')[2]
  test.skip(!extensionId, 'service worker not registered yet')

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`)

  // Reported: leaving a coin's chart stranded the position — visible in the portfolio but
  // closable only from the page it was opened on.
  const sellAll = panel.getByRole('button', { name: /Sell 100% of/ })
  await expect(sellAll).toBeVisible({ timeout: 15000 })

  // The boot sweep must actually clear. It covers the whole panel while it plays, so one
  // that never finishes is indistinguishable from a panel that renders nothing — and it
  // is opaque, so it would hide every bug behind it.
  await expect(panel.locator('.axpt-intro-overlay')).toHaveCount(0, { timeout: 5000 })
  await panel.screenshot({ path: join(SHOTS, '06-side-panel-sell.png') })

  await sellAll.click()
  await expect(panel.locator('body')).toContainText(/No open positions/i, { timeout: 15000 })

  await context.close()
})

test('a busy token page — dozens of holder wallets — still enables buying', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })

  // Reported as "the buy panel is now gone": the first version of the feed guard counted
  // addresses on the page, and a holders table is nothing but addresses — so the guard
  // meant to suppress feeds suppressed real token pages too.
  await expect(widget(page)).not.toContainText(/No token open/i)
  await expect(page.getByRole('button', { name: 'Buy 0.25 SOL' })).toBeEnabled()
  await page.screenshot({ path: join(SHOTS, '07-busy-token-page.png') })

  await context.close()
})

test('detection survives the price refresh cycle', async () => {
  const { context, page } = await launch()
  await page.goto(TOKEN_URL)
  await expect(widget(page)).toBeVisible({ timeout: 15000 })
  await expect(widget(page)).toContainText(/Desi 84|DESI/i, { timeout: 15000 })

  // Reported as "it keeps dropping detection": the widget identified the token, then
  // seconds later claimed it could not detect one — while still showing that token's name
  // and an open position in it. The 7s refresh replaced the confirmed token wholesale with
  // a response that carried no mint, so identity was erased by the very cycle meant to
  // keep it current. Two refreshes is well past the point it used to break.
  await page.waitForTimeout(16000)

  await expect(widget(page)).not.toContainText(/Couldn’t detect the token/i)
  await expect(widget(page)).not.toContainText(/No token open/i)
  await expect(page.getByRole('button', { name: 'Buy 0.25 SOL' })).toBeEnabled()
  await page.screenshot({ path: join(SHOTS, '08-detection-persists.png') })

  await context.close()
})
