// Browser stand-in for `@hermes/plugin-sdk`, used only by the dev harness (build.mjs --dev aliases the
// import to this file). Plain HTML versions of the components the pane uses, styled in theme.css to
// approximate Hermes Desktop. Every export is typed against ../sdk.d.ts, so the stub and the pane's
// view of the SDK cannot drift apart.

import type * as Sdk from '@hermes/plugin-sdk'
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// --- host ---

type Listener = (value: boolean) => void
const paneListeners = new Set<Listener>()
let paneVisible = true

const paneVisibilityAtom: Sdk.ReadableAtom<boolean> = {
  get: () => paneVisible,
  listen: fn => {
    paneListeners.add(fn)
    return () => {
      paneListeners.delete(fn)
    }
  },
  subscribe: fn => {
    fn(paneVisible)
    paneListeners.add(fn)
    return () => {
      paneListeners.delete(fn)
    }
  }
}

/** Harness control: simulates the pane going behind another tab. */
export function setPaneVisible(next: boolean): void {
  paneVisible = next
  paneListeners.forEach(fn => fn(next))
}

export const host: typeof Sdk.host = {
  paneVisibility: () => paneVisibilityAtom
}

// --- Button ---

function Spinner() {
  return <span aria-hidden="true" className="h-spin" />
}

export const Button: typeof Sdk.Button = ({
  variant = 'default',
  size = 'default',
  loading = false,
  className,
  children,
  disabled,
  ...props
}) => (
  <button
    aria-busy={loading || undefined}
    className={cx('h-btn', loading && 'h-btn-loading', className)}
    data-size={size}
    data-variant={variant}
    disabled={disabled || loading}
    {...props}
  >
    {loading ? (
      <>
        <span aria-hidden="true" className="h-btn-ghost">
          {children}
        </span>
        <span aria-hidden="true" className="h-btn-spin">
          <Spinner />
        </span>
      </>
    ) : (
      children
    )}
  </button>
)

// --- Input ---

export const Input: typeof Sdk.Input = ({ className, containerClassName, prefix, suffix, size = 'default', type, ...props }) => {
  const grouped = prefix != null || suffix != null
  const field = (
    <input
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      className={cx(grouped ? 'h-input-bare' : 'h-control', className)}
      data-size={grouped ? undefined : size}
      spellCheck={false}
      type={type}
      {...props}
    />
  )
  if (!grouped) return field
  return (
    <div className={cx('h-control h-input-group', props.disabled && 'h-disabled', containerClassName)} data-size={size}>
      {prefix != null ? <span className="h-adornment">{prefix}</span> : null}
      {field}
      {suffix != null ? <span className="h-adornment">{suffix}</span> : null}
    </div>
  )
}

// --- Checkbox ---

export const Checkbox: typeof Sdk.Checkbox = ({ checked = false, onCheckedChange, className, disabled, ...props }) => (
  <button
    aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
    className={cx('h-checkbox', className)}
    data-state={checked === 'indeterminate' ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
    disabled={disabled}
    onClick={() => onCheckedChange?.(checked !== true)}
    role="checkbox"
    type="button"
    {...props}
  >
    {checked === true ? (
      <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 16 16">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    ) : null}
  </button>
)

// --- SegmentedControl ---

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  disabled = false,
  sizing = 'equal'
}: Parameters<typeof Sdk.SegmentedControl<T>>[0]) {
  return (
    <div className={cx('h-seg', disabled && 'h-disabled', className)} data-sizing={sizing}>
      {options.map(({ id, label }) => (
        <button aria-pressed={value === id} disabled={disabled} key={id} onClick={() => onChange(id)} type="button">
          {label}
        </button>
      ))}
    </div>
  )
}

// --- Dialog ---

const DialogContext = createContext<{ open: boolean; onOpenChange: (open: boolean) => void }>({
  open: false,
  onOpenChange: () => undefined
})

export const Dialog: typeof Sdk.Dialog = ({ open = false, onOpenChange, children }) => (
  <DialogContext.Provider value={{ open, onOpenChange: onOpenChange ?? (() => undefined) }}>{children}</DialogContext.Provider>
)

export const DialogContent: typeof Sdk.DialogContent = ({
  className,
  bodyClassName,
  showCloseButton = true,
  children,
  onKeyDown,
  onOpenAutoFocus,
  ...props
}) => {
  const { open, onOpenChange } = useContext(DialogContext)
  const shell = useRef<HTMLDivElement>(null)
  const autoFocus = useRef(onOpenAutoFocus)
  autoFocus.current = onOpenAutoFocus

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const event = new Event('openautofocus', { cancelable: true })
    autoFocus.current?.(event)
    if (!event.defaultPrevented) {
      const node = shell.current
      const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')
      first?.focus()
    }
    return () => previous?.focus?.()
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="h-dialog-layer">
      <div className="h-dialog-overlay" onClick={() => onOpenChange(false)} />
      <div
        aria-modal="true"
        className={cx('h-dialog', className)}
        onKeyDown={event => {
          onKeyDown?.(event)
          if (event.key === 'Escape') onOpenChange(false)
        }}
        ref={shell}
        role="dialog"
        {...props}
      >
        <div className={cx('h-dialog-body', bodyClassName)}>{children}</div>
        {showCloseButton ? (
          <button aria-label="Close" className="h-btn h-dialog-close" data-size="icon-xs" data-variant="ghost" onClick={() => onOpenChange(false)} type="button">
            <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

export const DialogHeader: typeof Sdk.DialogHeader = ({ className, ...props }) => (
  <div className={cx('h-dialog-header', className)} {...props} />
)

export const DialogFooter: typeof Sdk.DialogFooter = ({ className, ...props }) => (
  <div className={cx('h-dialog-footer', className)} {...props} />
)

export const DialogTitle: typeof Sdk.DialogTitle = ({ className, ...props }) => (
  <h2 className={cx('h-dialog-title', className)} {...props} />
)

export const DialogDescription: typeof Sdk.DialogDescription = ({ className, ...props }) => (
  <p className={cx('h-dialog-description', className)} {...props} />
)

// --- ConfirmDialog (same pending, done and inline error beats as the app's) ---

export const ConfirmDialog: typeof Sdk.ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  busyLabel = 'Loading',
  doneLabel = 'Done',
  cancelLabel = 'Cancel',
  destructive = false,
  dismissOnConfirm = false
}) => {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const busy = status !== 'idle'

  useEffect(() => {
    if (open) {
      setStatus('idle')
      setError(null)
    }
  }, [open])

  const run = async () => {
    if (busy) return
    setError(null)
    setStatus('saving')
    try {
      await onConfirm()
      if (dismissOnConfirm) {
        setStatus('idle')
        onClose()
        return
      }
      setStatus('done')
      window.setTimeout(onClose, 600)
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <Dialog onOpenChange={next => !next && !busy && onClose()} open={open}>
      <DialogContent
        className="h-dialog-confirm"
        onKeyDown={event => {
          if ((event.key === 'Enter' || event.key === ' ') && !busy) {
            event.preventDefault()
            void run()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {error ? <div className="h-dialog-error">{error}</div> : null}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
            {cancelLabel}
          </Button>
          <Button data-autofocus="" disabled={busy} onClick={() => void run()} type="button" variant={destructive ? 'destructive' : 'default'}>
            {status === 'saving' ? busyLabel : status === 'done' ? doneLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Small pieces ---

export const Badge: typeof Sdk.Badge = ({ className, variant = 'default', size = 'default', ...props }) => (
  <span className={cx('h-badge', className)} data-size={size} data-variant={variant} {...props} />
)

export const StatusDot: typeof Sdk.StatusDot = ({ className, tone, ...props }) => (
  <span aria-hidden="true" className={cx('h-dot', className)} data-tone={tone} {...props} />
)

export const Loader: typeof Sdk.Loader = ({ className, label = 'Loading', strokeScale: _strokeScale, ...props }) => (
  <div aria-label={label} className={cx('h-loader', className)} role="status" {...props}>
    <svg aria-hidden="true" fill="none" viewBox="0 0 100 100">
      <circle cx="50" cy="50" opacity="0.14" r="34" stroke="currentColor" strokeWidth="7" />
      <path d="M50 16a34 34 0 0 1 34 34" stroke="currentColor" strokeLinecap="round" strokeWidth="7" />
    </svg>
  </div>
)

export const Skeleton: typeof Sdk.Skeleton = ({ className, ...props }) => <div className={cx('h-skeleton', className)} {...props} />

export const Tip: typeof Sdk.Tip = ({ label, children }) => {
  if (!label || typeof label !== 'string' || !isValidElement(children)) return <>{children}</>
  return cloneElement(children as ReactElement<{ title?: string }>, { title: label })
}

function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
      {done ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      ) : (
        <>
          <rect height="12" rx="2" width="12" x="8" y="8" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      )}
    </svg>
  )
}

export const CopyButton: typeof Sdk.CopyButton = ({
  text,
  appearance = 'button',
  buttonSize,
  buttonVariant = 'ghost',
  className,
  disabled = false,
  label = 'Copy',
  children
}) => {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const copy = async () => {
    try {
      const value = typeof text === 'function' ? await text() : text
      await navigator.clipboard?.writeText(value)
    } catch {
      // The harness may run without clipboard permission. The copied state still shows.
    }
    setCopied(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const visible: ReactNode = appearance === 'icon' ? null : copied ? 'Copied' : (children ?? label)

  if (appearance === 'inline') {
    return (
      <button aria-label={label} className={cx('h-copy-inline', className)} disabled={disabled} onClick={() => void copy()} title={label} type="button">
        <CopyGlyph done={copied} />
        {visible}
      </button>
    )
  }

  return (
    <Button
      aria-label={copied ? 'Copied' : label}
      className={className}
      disabled={disabled}
      onClick={() => void copy()}
      size={buttonSize ?? (appearance === 'icon' ? 'icon' : 'default')}
      title={appearance === 'icon' ? (copied ? 'Copied' : label) : undefined}
      type="button"
      variant={buttonVariant}
    >
      <CopyGlyph done={copied} />
      {visible}
    </Button>
  )
}

export const EmptyState: typeof Sdk.EmptyState = ({ title, description, className }) => (
  <div className={cx('h-empty', className)}>
    <div>
      <div className="h-empty-title">{title}</div>
      {description ? <div className="h-empty-description">{description}</div> : null}
    </div>
  </div>
)

export const ErrorState: typeof Sdk.ErrorState = ({ children, className, description, icon, title }) => (
  <div className={cx('h-error', className)}>
    <div className="h-error-main">
      {icon ?? (
        <svg aria-hidden="true" className="h-error-icon" viewBox="0 0 16 16">
          <path
            d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm2.8 9.1l-.7.7L8 8.7l-2.1 2.1-.7-.7L7.3 8 5.2 5.9l.7-.7L8 7.3l2.1-2.1.7.7L8.7 8l2.1 2.1z"
            fill="currentColor"
          />
        </svg>
      )}
      {typeof title === 'string' ? <h2 className="h-error-title">{title}</h2> : title}
      {typeof description === 'string' ? <p className="h-error-description">{description}</p> : description}
    </div>
    {children ? <div className="h-error-actions">{children}</div> : null}
  </div>
)
