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
