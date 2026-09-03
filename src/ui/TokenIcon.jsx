import { useState } from 'preact/hooks'

// One token avatar, used by every surface that lists positions.
//
// Identity arrives asynchronously from the price APIs, and some tokens simply have no
// image anywhere. Rendering `<img src="">` in those cases produces a broken-image glyph,
// which reads as "this extension is broken" rather than "this token has no art". So a
// missing or failed image falls back to a monogram derived from the token itself.
function monogramFor({ symbol, name, mint }) {
  const source = (symbol || name || mint || '?').trim()
  return source.slice(0, 2).toUpperCase()
}

// Deterministic hue per token, so the same token keeps the same colour everywhere and
// across reloads — a stable placeholder is recognisable; a random one is noise.
function hueFor(seed) {
  let hash = 0
  for (const char of String(seed || '')) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

export function TokenIcon({ imageUrl, symbol, name, mint, size = 32 }) {
  const [failed, setFailed] = useState(false)
  const dimension = { width: `${size}px`, height: `${size}px` }

  if (imageUrl && !failed) {
    return (
      <img
        class="axpt-token-icon"
        src={imageUrl}
        alt=""
        style={dimension}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span
      class="axpt-token-icon axpt-token-monogram"
      style={{ ...dimension, background: `hsl(${hueFor(mint || symbol || name)} 45% 22%)`, fontSize: `${size * 0.38}px` }}
      aria-hidden="true"
    >
      {monogramFor({ symbol, name, mint })}
    </span>
  )
}
