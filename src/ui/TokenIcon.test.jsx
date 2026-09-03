import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { TokenIcon } from './TokenIcon.jsx'

describe('TokenIcon', () => {
  it('renders the token image when there is one', () => {
    const { container } = render(<TokenIcon imageUrl="https://img/x.png" symbol="MORKO" mint="M" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/x.png')
  })

  it('falls back to a monogram instead of a broken image when there is no art', () => {
    // An empty src renders a broken-image glyph, which reads as a broken extension
    // rather than a token with no picture.
    const { container } = render(<TokenIcon imageUrl="" symbol="MORKO" mint="M" />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('MO')).toBeInTheDocument()
  })

  it('falls back when the image URL is dead', () => {
    const { container } = render(<TokenIcon imageUrl="https://img/gone.png" symbol="BONK" mint="B" />)

    fireEvent.error(container.querySelector('img'))

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('BO')).toBeInTheDocument()
  })

  it('uses the name when there is no symbol, and the mint when there is neither', () => {
    const { rerender } = render(<TokenIcon imageUrl="" name="Morko" mint="Abc" />)
    expect(screen.getByText('MO')).toBeInTheDocument()

    rerender(<TokenIcon imageUrl="" mint="Xyz123" />)
    expect(screen.getByText('XY')).toBeInTheDocument()
  })

  it('gives the same token the same placeholder colour every time', () => {
    const { container: first } = render(<TokenIcon imageUrl="" symbol="A" mint="SAME" />)
    const { container: second } = render(<TokenIcon imageUrl="" symbol="A" mint="SAME" />)

    const colourOf = (c) => c.querySelector('.axpt-token-monogram').getAttribute('style')
    expect(colourOf(first)).toBe(colourOf(second))
  })

  it('gives different tokens different placeholder colours', () => {
    const { container: a } = render(<TokenIcon imageUrl="" symbol="A" mint="AAA" />)
    const { container: b } = render(<TokenIcon imageUrl="" symbol="B" mint="ZZZ" />)

    const colourOf = (c) => c.querySelector('.axpt-token-monogram').getAttribute('style')
    expect(colourOf(a)).not.toBe(colourOf(b))
  })

  it('renders something even with no identity at all', () => {
    render(<TokenIcon />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
