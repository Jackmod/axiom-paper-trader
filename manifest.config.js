import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Axiom Paper Trader',
  version: '1.0.0',
  description: 'Accurate, persistent paper trading with virtual SOL on axiom.trade.',
  action: { default_popup: 'src/popup/index.html' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  background: { service_worker: 'src/background/service-worker.js', type: 'module' },
  permissions: ['storage', 'alarms', 'sidePanel'],
  host_permissions: [
    'https://axiom.trade/*',
    'https://api.jup.ag/*',
    'https://lite-api.jup.ag/*',
    'https://quote-api.jup.ag/*',
    'https://api.dexscreener.com/*',
    'https://frontend-api-v3.pump.fun/*',
    'wss://pumpportal.fun/*',
  ],
  content_scripts: [
    {
      matches: ['https://axiom.trade/*'],
      js: ['src/content/inject.js'],
    },
  ],
  icons: { 16: 'src/icons/icon-16.png', 48: 'src/icons/icon-48.png', 128: 'src/icons/icon-128.png' },
})
