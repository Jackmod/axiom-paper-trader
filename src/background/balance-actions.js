// `<= 0` alone would let NaN and Infinity through (NaN <= 0 is false), and the caller's amount is an
// arithmetic result (Task 25/26 convert USD -> SOL at the live price), so a failed price lookup would
// persist balanceSol: NaN into chrome.storage.local. Require a finite positive number instead.
function assertPositiveSol(solAmount) {
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    throw new Error(`solAmount must be a positive number, got ${solAmount}`)
  }
}

export function topUp(state, solAmount) {
  assertPositiveSol(solAmount)
  return { ...state, balanceSol: state.balanceSol + solAmount }
}

export function withdraw(state, solAmount) {
  assertPositiveSol(solAmount)
  if (solAmount > state.balanceSol) throw new Error('Cannot withdraw more than the available balance')
  return { ...state, balanceSol: state.balanceSol - solAmount }
}

export function resetAccount(state, startingBalanceSol) {
  // Zero is legal here (it is the onboarding gate's "not set up yet" value); NaN/negative are not.
  if (!Number.isFinite(startingBalanceSol) || startingBalanceSol < 0) {
    throw new Error(`startingBalanceSol must be a non-negative number, got ${startingBalanceSol}`)
  }
  return { ...state, balanceSol: startingBalanceSol, positions: {}, tradeHistory: [], portfolioSnapshots: [] }
}
