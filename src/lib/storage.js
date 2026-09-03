export const SCHEMA_VERSION = 1

export const DEFAULT_STATE = {
  settings: { paperModeEnabled: true },
  balanceSol: 0,
  // SOL/USD, refreshed every tick. Trades need it to convert between the currency the
  // user spends (SOL) and the currency tokens are priced in (USD).
  solUsdPrice: 0,
  positions: {},
  tradeHistory: [],
  portfolioSnapshots: [],
  schemaVersion: SCHEMA_VERSION,
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve))
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve))
}

export async function getState() {
  const stored = await storageGet(Object.keys(DEFAULT_STATE))
  return { ...DEFAULT_STATE, ...stored }
}

export async function setState(partial) {
  const current = await getState()
  await storageSet({ ...current, ...partial })
}
