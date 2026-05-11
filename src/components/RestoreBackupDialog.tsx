import { Cloud } from 'lucide-react'

interface RestoreBackupDialogProps {
  open: boolean
  modifiedTime?: string
  size?: number
  isRestoring: boolean
  onRestore: () => void
}

const formatSize = (bytes?: number): string => {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

const formatDate = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function RestoreBackupDialog({
  open,
  modifiedTime,
  size,
  isRestoring,
  onRestore,
}: RestoreBackupDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-900/30 mb-4 mx-auto">
          <Cloud className="w-6 h-6 text-sky-600 dark:text-sky-400" />
        </div>
        <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
          Backup found
        </h3>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 mb-4">
          We found a backup of your data in your Google Drive. Restore it to pick up where you left off.
        </p>
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 mb-6 space-y-1.5">
          {modifiedTime && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Last backup</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{formatDate(modifiedTime)}</span>
            </div>
          )}
          {size != null && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Size</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{formatSize(size)}</span>
            </div>
          )}
        </div>
        <button
          onClick={onRestore}
          disabled={isRestoring}
          className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-wait"
        >
          {isRestoring ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </div>
  )
}
