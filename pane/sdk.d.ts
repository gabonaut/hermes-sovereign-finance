// Ambient types for the parts of `@hermes/plugin-sdk` this pane uses. Typecheck only: Hermes Desktop
// supplies the real module at runtime, and `dev/sdk-stub.tsx` stands in for it in the browser harness.
// Shapes mirror apps/desktop/src/sdk/index.ts, contrib/plugin.ts and components/ui/* in hermes-agent.
import type { ComponentProps, ReactNode } from 'react'

export interface ReadableAtom<T> {
  get: () => T
  listen: (fn: (value: T) => void) => () => void
  subscribe: (fn: (value: T) => void) => () => void
}

export interface PluginRestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
}

export interface PluginOs {
  /** Opens http and https URLs in the system browser. Resolves false when the shell cannot. */
  openExternal: (url: string) => Promise<boolean>
}

export interface PluginStorage {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
  remove(key: string): void
}

export interface PluginContribution {
  id: string
  area: string
  title?: string
  order?: number
  data?: unknown
  render?: () => ReactNode
}

export interface PluginContext {
  readonly source: string
  register: (c: PluginContribution) => () => void
  onDispose: (fn: () => void) => void
  setTimeout: (fn: () => void, ms: number) => () => void
  setInterval: (fn: () => void, ms: number) => () => void
  addEventListener: (
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean
  ) => () => void
  rest: <T>(path: string, opts?: PluginRestOptions) => Promise<T>
  os: PluginOs
  storage: PluginStorage
}

export interface HermesPlugin {
  id: string
  name?: string
  description?: string
  register: (ctx: PluginContext) => void
}

export const host: {
  /** Newer desktops only. The id is `<pluginId>:<paneId>`. */
  paneVisibility?: (paneId: string) => ReadableAtom<boolean>
}

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'text' | 'textStrong'
type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'inline' | 'icon' | 'icon-xs' | 'icon-sm'

export function Button(
  props: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }
): ReactNode

export function Input(
  props: Omit<ComponentProps<'input'>, 'size' | 'prefix' | 'suffix'> & {
    size?: 'xs' | 'sm' | 'default' | 'lg'
    prefix?: ReactNode
    suffix?: ReactNode
    containerClassName?: string
  }
): ReactNode

export function Checkbox(
  props: Omit<ComponentProps<'button'>, 'onChange' | 'checked' | 'defaultChecked'> & {
    checked?: boolean | 'indeterminate'
    onCheckedChange?: (checked: boolean | 'indeterminate') => void
  }
): ReactNode

export interface SegmentedControlOption<T extends string> {
  id: T
  label: string
}

export function SegmentedControl<T extends string>(props: {
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  disabled?: boolean
  sizing?: 'equal' | 'content'
}): ReactNode

export function Dialog(props: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }): ReactNode

export function DialogContent(
  props: Omit<ComponentProps<'div'>, 'title'> & {
    showCloseButton?: boolean
    bodyClassName?: string
    /** Call preventDefault() to place the focus yourself when the dialog opens. */
    onOpenAutoFocus?: (event: Event) => void
  }
): ReactNode

export function DialogHeader(props: ComponentProps<'div'>): ReactNode
export function DialogFooter(props: ComponentProps<'div'>): ReactNode
export function DialogTitle(props: ComponentProps<'h2'>): ReactNode
export function DialogDescription(props: ComponentProps<'p'>): ReactNode

export function ConfirmDialog(props: {
  open: boolean
  onClose: () => void
  /** Throw to show the error inside the dialog and keep it open. */
  onConfirm: () => Promise<void> | void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  confirmLabel?: string
  busyLabel?: string
  doneLabel?: string
  cancelLabel?: string
  destructive?: boolean
  dismissOnConfirm?: boolean
}): ReactNode

export function Badge(
  props: ComponentProps<'span'> & {
    variant?: 'default' | 'muted' | 'success' | 'warn' | 'destructive' | 'outline' | 'solid'
    size?: 'default' | 'xs'
  }
): ReactNode

export function CopyButton(props: {
  text: string | (() => Promise<string> | string)
  appearance?: 'button' | 'icon' | 'inline'
  buttonSize?: ButtonSize
  buttonVariant?: ButtonVariant
  className?: string
  disabled?: boolean
  label?: string
  children?: ReactNode
}): ReactNode

export type StatusTone = 'good' | 'muted' | 'warn' | 'bad'
export function StatusDot(props: ComponentProps<'span'> & { tone: StatusTone }): ReactNode

export function Loader(props: Omit<ComponentProps<'div'>, 'children'> & { label?: string; strokeScale?: number }): ReactNode
export function Skeleton(props: ComponentProps<'div'>): ReactNode
export function Tip(props: { label: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }): ReactNode
export function EmptyState(props: { title: string; description?: string; className?: string }): ReactNode
export function ErrorState(props: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  className?: string
  children?: ReactNode
}): ReactNode
