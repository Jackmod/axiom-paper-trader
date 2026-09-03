import { findBuyButton, findSellButtons, scrapeTradeContext, SELECTORS } from './dom-scraper.js'
import { fetchQuotedFillPrice } from '../lib/price-sources/jupiter-quote.js'
import { SOL_MINT } from '../lib/price-sources/jupiter.js'

const LAMPORTS_PER_SOL = 1_000_000_000

async function resolveFillPrice(context, qtySol) {
  const quoted = await fetchQuotedFillPrice({
    inputMint: SOL_MINT,
    outputMint: context.mint,
    amountLamports: Math.round(qtySol * LAMPORTS_PER_SOL),
    outputDecimals: 6, // most SPL memecoins use 6 decimals; verify per-token if this proves wrong in manual testing
  })
  return quoted ?? context.priceUsd // fall back to the DOM-displayed price if the quote hasn't returned/failed
}

function readSolAmount() {
  const input = document.querySelector(SELECTORS.solAmountInput)
  return Number(input?.value ?? 0)
}

export function attachTradeInterception(onTradeConfirmed) {
  document.addEventListener(
    'click',
    async (event) => {
      const buyButton = findBuyButton()
      const sellButtons = findSellButtons()

      if (buyButton && (event.target === buyButton || buyButton.contains(event.target))) {
        event.preventDefault()
        event.stopPropagation()
        const context = scrapeTradeContext()
        if (!context) return
        const qtySol = readSolAmount()
        const priceUsd = await resolveFillPrice(context, qtySol)
        onTradeConfirmed({ side: 'buy', ...context, qtySol, priceUsd })
        return
      }

      const clickedSell = sellButtons.find((btn) => event.target === btn || btn.contains(event.target))
      if (clickedSell) {
        event.preventDefault()
        event.stopPropagation()
        const context = scrapeTradeContext()
        if (!context) return
        const percent = Number(clickedSell.getAttribute('data-sell-percent') ?? '0')
        onTradeConfirmed({ side: 'sell', ...context, sellPercent: percent, priceUsd: context.priceUsd })
      }
    },
    { capture: true },
  )
}
