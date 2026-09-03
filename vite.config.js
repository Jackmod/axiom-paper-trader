import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import preact from '@preact/preset-vite'
import manifest from './manifest.config.js'

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
})
