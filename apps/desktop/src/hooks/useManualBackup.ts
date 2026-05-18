import { useState, useCallback } from 'react'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'

interface ConflictDialogState {
  open: boolean
  cloudModifiedTime?: string
}

// Orchestrates the manual-sync flow:
//   1. Ask main process for current state (local/cloud changes since last sync).
//   2. If conflict       → open SyncConflictDialog and let user pick direction.
//   3. If only cloud     → confirm dialog ("download? local will be replaced").
//   4. If only local OR  → upload silently.
//      first sync OR
//      cloud is empty
//   5. If nothing changed → toast "Already in sync".
//
// Each entry point (Settings button, Layout sidebar button, CommandPalette item)
// calls triggerBackup(). The host component renders <SyncConflictDialog {...conflictDialogProps} />
// somewhere so the conflict UI has a place to live.
export function useManualBackup() {
  const toast = useToast()
  const confirm = useConfirm()
  const [isWorking, setIsWorking] = useState(false)
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({ open: false })

  const doUpload = useCallback(async () => {
    setIsWorking(true)
    try {
      const result = await window.electronAPI.sync.upload()
      if (result.success) {
        toast.success('Backup complete')
      } else {
        toast.error(result.error || 'Backup failed')
      }
    } catch (e) {
      console.error('Upload error:', e)
      toast.error('Backup failed')
    } finally {
      setIsWorking(false)
    }
  }, [toast])

  const doDownload = useCallback(async () => {
    setIsWorking(true)
    try {
      const result = await window.electronAPI.sync.download()
      if (result.success) {
        toast.success('Restored from cloud')
      } else {
        toast.error(result.error || 'Restore failed')
      }
    } catch (e) {
      console.error('Download error:', e)
      toast.error('Restore failed')
    } finally {
      setIsWorking(false)
    }
  }, [toast])

  const triggerBackup = useCallback(async () => {
    if (isWorking) return
    setIsWorking(true)
    try {
      const state = await window.electronAPI.sync.syncState()

      // Cloud empty OR first conflict-aware sync from this device → just upload.
      if (!state.cloudExists || state.firstSync) {
        setIsWorking(false)
        await doUpload()
        return
      }

      // Real conflict — hand control to the dialog.
      if (state.isConflict) {
        setIsWorking(false)
        setConflictDialog({ open: true, cloudModifiedTime: state.cloudModifiedTime })
        return
      }

      // Only local changed → safe to upload.
      if (state.localChanged) {
        setIsWorking(false)
        await doUpload()
        return
      }

      // Only cloud changed → always ask before replacing local (user's design call).
      if (state.cloudChanged) {
        setIsWorking(false)
        const ok = await confirm({
          title: 'Newer backup in cloud',
          message: 'Another device has synced more recently. Download the cloud version? Your local data will be replaced.',
          confirmText: 'Download',
          cancelText: 'Cancel',
        })
        if (ok) await doDownload()
        return
      }

      toast.info('Already in sync')
    } catch (e) {
      console.error('syncState error:', e)
      toast.error('Sync check failed')
    } finally {
      setIsWorking(false)
    }
  }, [isWorking, doUpload, doDownload, confirm, toast])

  const handleConflictUpload = useCallback(async () => {
    setConflictDialog({ open: false })
    await doUpload()
  }, [doUpload])

  const handleConflictDownload = useCallback(async () => {
    setConflictDialog({ open: false })
    await doDownload()
  }, [doDownload])

  const handleConflictCancel = useCallback(() => {
    setConflictDialog({ open: false })
  }, [])

  return {
    triggerBackup,
    isWorking,
    conflictDialogProps: {
      open: conflictDialog.open,
      cloudModifiedTime: conflictDialog.cloudModifiedTime,
      isWorking,
      onUpload: handleConflictUpload,
      onDownload: handleConflictDownload,
      onCancel: handleConflictCancel,
    },
  }
}
