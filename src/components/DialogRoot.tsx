import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { Button } from './ui'
import {
  _registerConfirm,
  _registerToast,
  type ConfirmOptions,
  type ToastOptions,
  type ToastTone,
} from '@/lib/dialogs'

type ConfirmState = {
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

type ActiveToast = ToastOptions & { id: string }

const toneIcon: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
}

const toneClass: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-fg-3',
}

export default function DialogRoot() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [toasts, setToasts] = useState<ActiveToast[]>([])

  useEffect(() => {
    _registerConfirm(
      (opts) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ opts, resolve })
        }),
    )
    _registerToast((opts) => {
      const id = Math.random().toString(36).slice(2)
      const t: ActiveToast = { ...opts, id }
      setToasts((curr) => [...curr, t])
      const duration = opts.duration ?? 4000
      window.setTimeout(() => {
        setToasts((curr) => curr.filter((x) => x.id !== id))
      }, duration)
    })
    return () => {
      _registerConfirm(null)
      _registerToast(null)
    }
  }, [])

  function answerConfirm(v: boolean) {
    confirmState?.resolve(v)
    setConfirmState(null)
  }

  useEffect(() => {
    if (!confirmState) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answerConfirm(false)
      if (e.key === 'Enter') answerConfirm(true)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState])

  const confirmNode = confirmState
    ? createPortal(
        <div
          className="modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-fg/40 backdrop-blur-sm p-4"
          onClick={() => answerConfirm(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="modal-panel bg-surface border border-border rounded-xl w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex items-start gap-4">
              <div
                className={`size-10 shrink-0 rounded-full grid place-items-center ${
                  confirmState.opts.tone === 'danger'
                    ? 'bg-red-50 text-danger'
                    : 'bg-hover text-fg-2'
                }`}
              >
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-fg">{confirmState.opts.title}</h3>
                {confirmState.opts.message && (
                  <p className="mt-1 text-sm text-fg-3 leading-relaxed">
                    {confirmState.opts.message}
                  </p>
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border bg-bg/40 flex items-center justify-end gap-2 rounded-b-xl">
              <Button variant="secondary" onClick={() => answerConfirm(false)}>
                {confirmState.opts.cancelLabel ?? 'Cancelar'}
              </Button>
              <Button
                autoFocus
                variant={confirmState.opts.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => answerConfirm(true)}
              >
                {confirmState.opts.confirmLabel ?? 'Confirmar'}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  const toastsNode = createPortal(
    <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none w-[calc(100vw-2rem)] max-w-sm">
      {toasts.map((t) => {
        const tone = t.tone ?? 'info'
        const Icon = toneIcon[tone]
        return (
          <div
            key={t.id}
            className="toast-item pointer-events-auto bg-surface border border-border rounded-lg shadow-lg px-4 py-3 flex items-start gap-3"
          >
            <Icon className={`size-5 shrink-0 ${toneClass[tone]}`} />
            <div className="min-w-0 flex-1">
              {t.title && (
                <div className="text-sm font-semibold text-fg leading-tight">{t.title}</div>
              )}
              <div className="text-sm text-fg-2 leading-snug">{t.message}</div>
            </div>
            <button
              onClick={() => setToasts((curr) => curr.filter((x) => x.id !== t.id))}
              className="text-fg-4 hover:text-fg transition shrink-0"
              aria-label="Dispensar"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )

  return (
    <>
      {confirmNode}
      {toastsNode}
    </>
  )
}
