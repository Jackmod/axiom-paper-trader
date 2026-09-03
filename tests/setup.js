import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/preact'

// @testing-library only auto-registers cleanup when the test globals are
// injected; this suite runs without `globals: true`, so register it here.
afterEach(cleanup)
