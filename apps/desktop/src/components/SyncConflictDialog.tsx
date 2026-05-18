import { AlertTriangle } from 'lucide-react'

interface SyncConflictDialogProps {
  open: boolean
  cloudModifiedTime?: string
  isWorking: boolean
  onUpload: () => void
  onDownload: () => void
  onCancel: () => void
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

export default function SyncConflictDialog({
  open,
  cloudModifiedTime,
  isWorking,
  onUpload,
  onDownload,
  onCancel,
}: SyncConflictDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4 mx-auto">
          <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h3 className="text-lg font-semibold text-center text-gray-900 dark:text-gray-100 mb-2">
          Sync conflict
        </h3>
        <p className="text-sm text-center text-gray-600 dark:text-gray-400 mb-4">
          Both this device and the cloud have unsynced changes. Choose which version to keep — the other will be replaced.
        </p>
        {cloudModifiedTime && (
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 mb-6">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Cloud last changed</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{formatDate(cloudModifiedTime)}</span>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <button
            onClick={onUpload}
            disabled={isWorking}
            className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-wait"
          >
            Upload local (cloud's changes are lost)
          </button>
          <button
            onClick={onDownload}
            disabled={isWorking}
            className="w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 disabled:cursor-wait"
          >
            Download cloud (local changes are lost)
          </button>
          <button
            onClick={onCancel}
            disabled={isWorking}
            className="w-full px-4 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
