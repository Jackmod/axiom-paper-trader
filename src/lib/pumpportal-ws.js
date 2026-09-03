export function subscribeToPumpPortal(mint, onPrice) {
  const ws = new WebSocket('wss://pumpportal.fun/api/data')

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }))
  })

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data)
    if (data.mint !== mint) return
    const solPerToken = data.vSolInBondingCurve / data.vTokensInBondingCurve
    onPrice(solPerToken)
  })

  return () => ws.close()
}
