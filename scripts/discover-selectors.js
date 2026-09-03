// Paste this whole file into the DevTools console on a LOGGED-IN axiom.trade token page
// (one where you can see the Buy/Sell panel). It prints a ready-to-paste SELECTORS block
// for src/content/dom-scraper.js.
//
// Nothing here clicks, submits, or sends anything — it only reads the DOM.
//
// It cannot be perfect: it guesses from visible text and attributes, so read what it
// prints before trusting it, and re-run it if Axiom's UI changes.
;(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  const text = (el) => (el.textContent || '').trim()

  // Prefer selectors that survive a redeploy: stable-looking data attributes and ids
  // beat generated class names, which frameworks rewrite on every build.
  const STABLE_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-id', 'aria-label', 'name']

  function selectorFor(el) {
    if (!el) return null
    for (const attr of STABLE_ATTRS) {
      const value = el.getAttribute?.(attr)
      if (value) {
        const candidate = `[${attr}="${CSS.escape(value)}"]`
        if (document.querySelectorAll(candidate).length === 1) return candidate
      }
    }
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`

    // Fall back to a short structural path, and say so — these are brittle.
    const parts = []
    for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      const tag = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`)
        break
      }
      const siblings = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : []
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag)
    }
    return `${parts.join(' > ')}   /* STRUCTURAL — brittle, replace if you can */`
  }

  const clickable = [...document.querySelectorAll('button, [role="button"], a')].filter(visible)

  const buy = clickable.find((el) => /^buy\b/i.test(text(el)))
  const sellPercents = clickable.filter((el) => /^\d{1,3}\s*%$/.test(text(el)))
  const amountInput = [...document.querySelectorAll('input')].filter(visible).find((el) => el.type === 'number' || /amount|sol/i.test(el.placeholder || ''))

  // The mint is far more reliably read from the URL than from any attribute — Axiom's
  // token routes carry it directly. Base58, 32-44 chars.
  const mintFromUrl = location.pathname.split('/').find((seg) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(seg))

  const priceEl = [...document.querySelectorAll('span, div, p')]
    .filter(visible)
    .find((el) => el.children.length === 0 && /^\$\s?[\d,]+\.?\d*/.test(text(el)))

  const report = {
    buyButton: selectorFor(buy),
    sellButtons: sellPercents.length ? selectorFor(sellPercents[0]) : null,
    solAmountInput: selectorFor(amountInput),
    displayedPrice: selectorFor(priceEl),
    mintFromUrl: mintFromUrl || '(not in URL — check a data attribute or link href)',
  }

  console.log('%cAxiom Paper Trader — selector discovery', 'font-weight:bold;font-size:14px')
  console.table(report)

  console.log(
    'Sell buttons found:',
    sellPercents.map((el) => text(el)),
    '\nIf the sell buttons share one attribute, use that for `sellButtons` so all of them match.',
  )

  console.log(
    `\nPaste into src/content/dom-scraper.js, then fill the rest by inspecting elements yourself:\n\n` +
      `export const SELECTORS = {\n` +
      `  buyButton: '${report.buyButton ?? 'TODO'}',\n` +
      `  sellButtons: '${report.sellButtons ?? 'TODO'}',\n` +
      `  solAmountInput: '${report.solAmountInput ?? 'TODO'}',\n` +
      `  displayedPrice: '${report.displayedPrice ?? 'TODO'}',\n` +
      `  tokenName: 'TODO', tokenSymbol: 'TODO', tokenImage: 'TODO',\n` +
      `  priorityFee: 'TODO', slippage: 'TODO', marketCap: 'TODO', rugBadge: 'TODO',\n` +
      `}\n\n` +
      `NOTE: the mint is best read from the URL (${report.mintFromUrl}), not a data attribute —\n` +
      `see the tokenMint note in dom-scraper.js.`,
  )

  return report
})()
