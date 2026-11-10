import { useMemo } from 'react'
import { encode } from 'uqr'

/** Light modules around the symbol. The QR spec asks for four. */
const QUIET = 4

/** One SVG path for every dark module, with horizontal runs merged. */
function modulePath(rows: boolean[][]): string {
  let d = ''
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? []
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let run = 1
      while (row[x + run]) run++
      d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`
      x += run
    }
  }
  return d
}

/**
 * QR code of `value`, drawn as dark modules on a white tile in both themes: scanners expect dark on
 * light, so these two colours are fixed instead of following the theme.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const symbol = useMemo(() => {
    try {
      const bytes = Array.from(new TextEncoder().encode(value))
      const qr = encode(bytes, { ecc: 'M', border: 0 })
      return { d: modulePath(qr.data), size: qr.size + QUIET * 2 }
    } catch {
      return null
    }
  }, [value])

  if (!symbol) return null

  return (
    <svg
      aria-label={label}
      className={className}
      role="img"
      shapeRendering="crispEdges"
      viewBox={`0 0 ${symbol.size} ${symbol.size}`}
    >
      <rect fill="#fff" height={symbol.size} width={symbol.size} />
      <path d={symbol.d} fill="#000" />
    </svg>
  )
}
