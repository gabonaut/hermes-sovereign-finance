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

/** The BNB Chain mark, as a small embedded image. */
const BNB_MARK =
  'data:image/png;base64,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'

/** Network marks, in each network's own colour. Testnets use their mainnet's mark. */
export const NetworkMark = ({ network, size = 14 }: { network: string; size?: number }) =>
  network === 'bnb' ? (
    <img
      alt=""
      aria-hidden="true"
      height={size}
      onError={event => {
        event.currentTarget.style.display = 'none'
      }}
      src={BNB_MARK}
      width={size}
    />
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
