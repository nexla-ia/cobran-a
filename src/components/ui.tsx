import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Eye, EyeOff, X } from 'lucide-react'
import type {
  ReactNode,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-3">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">{actions}</div>
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none rounded-md'
  const sizes = {
    sm: 'h-8 px-2.5 text-xs',
    md: 'h-9 px-3 text-sm',
  }[size]
  const styles = {
    primary: 'bg-fg text-surface hover:bg-fg-2',
    secondary: 'bg-surface text-fg border border-border hover:bg-hover',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-fg-3 hover:text-fg hover:bg-hover',
  }[variant]
  return <button className={`${base} ${sizes} ${styles} ${className}`} {...props} />
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-fg/40 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-panel flex flex-col bg-surface border border-border rounded-xl w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center justify-between px-5 h-14 border-b border-border bg-surface rounded-t-xl">
          <h2 className="text-base font-semibold text-fg truncate pr-2">{title}</h2>
          <button
            onClick={onClose}
            className="size-8 grid place-items-center text-fg-3 hover:text-fg hover:bg-hover rounded-md transition shrink-0"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-border bg-surface px-5 py-3 flex items-center justify-end gap-2 rounded-b-xl">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-fg-2 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-fg-4">{hint}</span>}
    </label>
  )
}

const fieldBase =
  'w-full bg-surface border border-border rounded-md px-3 h-9 text-sm text-fg outline-none transition-colors focus:border-fg placeholder:text-fg-4'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldBase} ${props.className ?? ''}`} />
}

export function PasswordInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>,
) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={`${fieldBase} pr-10 ${props.className ?? ''}`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-1 top-1/2 -translate-y-1/2 size-7 grid place-items-center text-fg-4 hover:text-fg hover:bg-hover rounded-md transition"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

const selectChevron =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>"

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${fieldBase} pr-8 appearance-none cursor-pointer bg-no-repeat ${props.className ?? ''}`}
      style={{
        backgroundImage: `url("${selectChevron}")`,
        backgroundPosition: 'right 0.75rem center',
        backgroundSize: '12px 12px',
        ...(props.style ?? {}),
      }}
    />
  )
}

export type ComboOption = {
  value: string
  label: ReactNode
  hint?: string
  searchText?: string
}

export function Combo({
  value,
  onChange,
  options,
  placeholder = 'Selecione…',
  disabled,
  className = '',
  required,
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flipUp: boolean }>({
    top: 0,
    left: 0,
    width: 0,
    flipUp: false,
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const menuHeight = Math.min(260, options.length * 36 + 16)
    const spaceBelow = window.innerHeight - r.bottom
    const flipUp = spaceBelow < menuHeight + 16 && r.top > menuHeight + 16
    setRect({
      top: flipUp ? r.top - menuHeight - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      flipUp,
    })
    const idx = options.findIndex((o) => o.value === value)
    setHighlight(idx >= 0 ? idx : 0)
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => Math.min(options.length - 1, h + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => Math.max(0, h - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = options[highlight]
        if (opt) {
          onChange(opt.value)
          setOpen(false)
          triggerRef.current?.focus()
        }
      } else if (e.key === 'Home') {
        e.preventDefault()
        setHighlight(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setHighlight(options.length - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, options, highlight, onChange])

  useEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full bg-surface border border-border rounded-md px-3 h-9 text-sm text-fg outline-none transition-colors flex items-center justify-between gap-2 cursor-pointer hover:border-fg-4 focus:border-fg disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'border-fg ring-2 ring-fg/10' : ''
        } ${className}`}
      >
        <span className={`truncate text-left ${!selected ? 'text-fg-4' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          value={value}
          required
          onChange={() => {}}
          className="sr-only"
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0, width: 0 }}
        />
      )}
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              role="listbox"
              className="fixed z-[56] bg-surface border border-border rounded-lg shadow-xl overflow-y-auto py-1"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                maxHeight: 260,
                transformOrigin: rect.flipUp ? 'bottom' : 'top',
                animation: 'scale-in 140ms cubic-bezier(0.22,1,0.36,1) both',
              }}
            >
              {options.map((o, i) => {
                const isSelected = o.value === value
                const isHighlighted = i === highlight
                return (
                  <button
                    key={o.value}
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                      triggerRef.current?.focus()
                    }}
                    role="option"
                    aria-selected={isSelected}
                    className={`w-full flex items-center justify-between gap-2 px-3 h-9 text-sm text-left transition-colors ${
                      isHighlighted ? 'bg-hover text-fg' : 'text-fg-2'
                    }`}
                  >
                    <span className="truncate flex items-center gap-2">{o.label}</span>
                    {isSelected && <Check className="size-4 text-fg shrink-0" />}
                  </button>
                )
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

export type ContextMenuItem = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  divider?: boolean
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  title,
}: {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  title?: string
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    const r = menuRef.current.getBoundingClientRect()
    const margin = 8
    let top = y
    let left = x
    if (left + r.width + margin > window.innerWidth) left = window.innerWidth - r.width - margin
    if (top + r.height + margin > window.innerHeight) top = window.innerHeight - r.height - margin
    if (left < margin) left = margin
    if (top < margin) top = margin
    setPos({ top, left })
  }, [open, x, y])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        ref={menuRef}
        className="fixed z-[56] min-w-[200px] bg-surface border border-border rounded-lg shadow-xl py-1"
        style={{
          top: pos.top,
          left: pos.left,
          animation: 'scale-in 140ms cubic-bezier(0.22,1,0.36,1) both',
          transformOrigin: 'top left',
        }}
      >
        {title && (
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-medium text-fg-4 border-b border-border mb-1">
            {title}
          </div>
        )}
        {items.map((it, i) => (
          <div key={i}>
            {it.divider ? (
              <div className="my-1 border-t border-border" />
            ) : (
              <button
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  it.onClick()
                  onClose()
                }}
                className={`w-full flex items-center gap-2.5 px-3 h-8 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  it.danger
                    ? 'text-danger hover:bg-red-50'
                    : 'text-fg-2 hover:bg-hover hover:text-fg'
                }`}
              >
                {it.icon && <it.icon className="size-4 shrink-0" />}
                <span className="flex-1 truncate">{it.label}</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </>,
    document.body,
  )
}

export function Checkbox({
  checked,
  onChange,
  indeterminate,
  ...rest
}: {
  checked: boolean
  onChange: (v: boolean) => void
  indeterminate?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'type'>) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <input
      {...rest}
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={`size-4 rounded border border-border accent-fg cursor-pointer transition ${rest.className ?? ''}`}
    />
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-fg placeholder:text-fg-4 resize-y min-h-[80px] ${props.className ?? ''}`}
    />
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border border-border rounded-lg bg-surface p-12 text-center">
      <div className="text-sm font-medium text-fg">{title}</div>
      {hint && <div className="mt-1 text-sm text-fg-3">{hint}</div>}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'warn' | 'danger' | 'good' | 'mute'
}) {
  const styles = {
    neutral: 'bg-hover text-fg-2 border-border',
    warn: 'bg-amber-50 text-warn border-amber-200',
    danger: 'bg-red-50 text-danger border-red-200',
    good: 'bg-green-50 text-success border-green-200',
    mute: 'bg-hover text-fg-4 border-border',
  }[tone]
  return (
    <span
      className={`inline-flex items-center px-1.5 h-5 border rounded text-[11px] font-medium ${styles}`}
    >
      {children}
    </span>
  )
}
