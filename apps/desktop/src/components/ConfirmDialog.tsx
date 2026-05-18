import { useState, useCallback, useRef } from 'react'
import { ConfirmContext, type ConfirmOptions } from './ConfirmDialogContext'

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    open: boolean
    title: string
    message: string
    confirmText: string
    cancelText: string
    danger: boolean
  }>({
    open: false,
    title: 'Confirm',
    message: '',
    confirmText: 'Yes',
    cancelText: 'Cancel',
    danger: false,
  })

  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts = typeof options === 'string' ? { message: options } : options
    setState({
      open: true,
      title: opts.title || 'Confirm',
      message: opts.message,
      confirmText: opts.confirmText || 'Yes',
      cancelText: opts.cancelText || 'Cancel',
      danger: opts.danger ?? false,
    })
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve
    })
  }, [])

  const handleClose = (result: boolean) => {
    setState(prev => ({ ...prev, open: false }))
    resolveRef.current?.(result)
    resolveRef.current = null
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {state.title}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {state.message}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {state.cancelText}
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 text-sm rounded-lg text-white ${
                  state.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-primary-600 hover:bg-primary-700'
                }`}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
