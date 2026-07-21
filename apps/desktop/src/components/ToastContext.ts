import { createContext, useContext } from 'react'

type ToastType = 'success' | 'error' | 'info'

export interface ToastApi {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

export interface ToastContextValue {
  toast: ToastApi
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}

export type { ToastType }
