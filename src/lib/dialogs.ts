export type ConfirmOptions = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export type ToastTone = 'success' | 'error' | 'info'

export type ToastOptions = {
  message: string
  title?: string
  tone?: ToastTone
  duration?: number
}

type ConfirmHandler = (opts: ConfirmOptions) => Promise<boolean>
type ToastHandler = (opts: ToastOptions) => void

let confirmHandler: ConfirmHandler | null = null
let toastHandler: ToastHandler | null = null

export function _registerConfirm(fn: ConfirmHandler | null) {
  confirmHandler = fn
}

export function _registerToast(fn: ToastHandler | null) {
  toastHandler = fn
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (confirmHandler) return confirmHandler(opts)
  return Promise.resolve(window.confirm(opts.message ?? opts.title))
}

export const toast = {
  success(message: string, options: Partial<ToastOptions> = {}) {
    toastHandler?.({ ...options, message, tone: 'success' })
  },
  error(message: string, options: Partial<ToastOptions> = {}) {
    toastHandler?.({ ...options, message, tone: 'error' })
  },
  info(message: string, options: Partial<ToastOptions> = {}) {
    toastHandler?.({ ...options, message, tone: 'info' })
  },
}
