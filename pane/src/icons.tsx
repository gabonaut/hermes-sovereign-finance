// Stroke glyphs drawn to sit beside the app's own icon set: 24 unit box, round caps, currentColor.

import type { ReactNode, SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Glyph({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconCheck = (props: IconProps) => (
  <Glyph strokeWidth="2.5" {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Glyph>
)

export const IconChevron = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9 6l6 6-6 6" />
  </Glyph>
)

export const IconExternal = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M7 17L17 7" />
    <path d="M9 7h8v8" />
  </Glyph>
)

export const IconAlert = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 9v4" />
    <path d="M12 16.5v.01" />
    <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
  </Glyph>
)

/** The Altana mark, in its own colours. */
export const AltanaMark = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden="true" fill="none" focusable="false" height={size} viewBox="-4.737 -26.701 449.183 449.183" width={size}>
    <path d="M298.4 361.864L156.979 220.442L298.4 79.0211L383.253 163.874C414.495 195.116 414.495 245.769 383.253 277.011L298.4 361.864Z" fill="#E2622E" />
    <path d="M141.421 361.45L56.5686 276.597C25.3266 245.355 25.3266 194.702 56.5686 163.46L141.421 78.6075L282.843 220.029L141.421 361.45Z" fill="#F2CB45" />
    <path d="M163.617 56.7248C194.858 25.4828 245.512 25.4828 276.754 56.7248L361.96 141.931L220.066 283.825L78.2908 142.051L163.617 56.7248Z" fill="#3665E4" />
  </svg>
)

/** Network marks, in each network's own colour. Testnets use their mainnet's mark. */
export const NetworkMark = ({ network, size = 14 }: { network: string; size?: number }) =>
  network === 'bnb' ? (
    <svg aria-hidden="true" focusable="false" height={size} viewBox="0 0 126.61 126.61" width={size}>
      <path
        d="M38.73 53.2l24.59-24.58 24.6 24.6 14.3-14.31L63.32 0 24.42 38.9zM0 63.31l14.3-14.31 14.31 14.31-14.31 14.3zM38.73 73.41l24.59 24.59 24.6-24.6 14.31 14.29-38.9 38.91-38.91-38.88zM98 63.31l14.3-14.31 14.31 14.3-14.31 14.32zM77.83 63.3L63.32 48.78 52.59 59.51l-1.24 1.23-2.54 2.54 14.51 14.5 14.51-14.47z"
        fill="#F3BA2F"
      />
    </svg>
  ) : (
    <svg aria-hidden="true" focusable="false" height={size} viewBox="0 0 256 417" width={Math.round((size * 256) / 417)}>
      <path d="M127.96 0l-2.8 9.5v275.67l2.8 2.79 127.96-75.64z" fill="#627EEA" fillOpacity=".75" />
      <path d="M127.96 0L0 212.32l127.96 75.64V154.16z" fill="#627EEA" fillOpacity=".5" />
      <path d="M127.96 312.19l-1.57 1.92v98.2l1.57 4.6L256 236.59z" fill="#627EEA" fillOpacity=".75" />
      <path d="M127.96 416.91V312.19L0 236.59z" fill="#627EEA" fillOpacity=".5" />
      <path d="M127.96 287.96l127.96-75.64-127.96-58.16z" fill="#627EEA" />
      <path d="M0 212.32l127.96 75.64V154.16z" fill="#627EEA" fillOpacity=".8" />
    </svg>
  )
