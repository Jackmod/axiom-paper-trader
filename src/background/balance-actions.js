export function topUp(state, solAmount) {
  if (solAmount <= 0) throw new Error(`solAmount must be positive, got ${solAmount}`)
  return { ...state, balanceSol: state.balanceSol + solAmount }
}

export function withdraw(state, solAmount) {
  if (solAmount <= 0) throw new Error(`solAmount must be positive, got ${solAmount}`)
  if (solAmount > state.balanceSol) throw new Error('Cannot withdraw more than the available balance')
  return { ...state, balanceSol: state.balanceSol - solAmount }
}

export function resetAccount(state, startingBalanceSol) {
  return { ...state, balanceSol: startingBalanceSol, positions: {}, tradeHistory: [], portfolioSnapshots: [] }
}
