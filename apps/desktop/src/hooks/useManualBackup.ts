import { useState, useCallback, useEffect } from 'react'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'

interface ConflictDialogState {
  open: boolean
  cloudModifiedTime?: string
}

// Timestamps shown under the two explicit sync buttons. These ARE the safety
// feature: seeing "this device: May 30" vs "cloud: May 25" is what makes an
// about-to-go-backwards Restore obvious before you click it.
export interface SyncTimestamps {
  thisDeviceLastUpload: string | null
  cloudModifiedTime: string | null
  cloudExists: boolean
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
  // Which network operation is actually in flight, for per-button spinners.
  // Set ONLY inside doUpload/doDownload (the slow Drive calls) — deliberately
  // null during confirm/conflict dialogs so a spinner doesn't show while we're
  // waiting on the user to read a prompt.
  const [activeOp, setActiveOp] = useState<'upload' | 'restore' | null>(null)
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>({ open: false })
  const [timestamps, setTimestamps] = useState<SyncTimestamps>({
    thisDeviceLastUpload: null,
    cloudModifiedTime: null,
    cloudExists: false,
  })

  // Pull the two timestamps the buttons display. getBackupInfo gives us *this
  // device's* last upload; checkCloudBackup gives the cloud copy's modified
  // time. Refreshed on mount and after every upload/download so the labels
  // never go stale.
  const refreshTimestamps = useCallback(async () => {
    try {
      const [info, cloud] = await Promise.all([
        window.electronAPI.sync.getBackupInfo(),
        window.electronAPI.sync.checkCloudBackup(),
      ])
      setTimestamps({
        thisDeviceLastUpload: info.thisDeviceLastUpload,
        cloudModifiedTime: cloud.exists ? cloud.modifiedTime ?? null : null,
        cloudExists: cloud.exists,
      })
    } catch (e) {
      console.error('refreshTimestamps failed:', e)
    }
  }, [])

  useEffect(() => {
    refreshTimestamps()
  }, [refreshTimestamps])

  const doUpload = useCallback(async () => {
    setIsWorking(true)
    setActiveOp('upload')
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
      setActiveOp(null)
      refreshTimestamps()
    }
  }, [toast, refreshTimestamps])

  const doDownload = useCallback(async () => {
    setIsWorking(true)
    setActiveOp('restore')
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
      setActiveOp(null)
      refreshTimestamps()
    }
  }, [toast, refreshTimestamps])

  const triggerBackup = useCallback(async () => {
    if (isWorking) return
    setIsWorking(true)
    try {
      const state = await window.electronAPI.sync.syncState()

      // Cloud empty → nothing to overwrite, just upload.
      if (!state.cloudExists) {
        setIsWorking(false)
        await doUpload()
        return
      }

      // No baseline for this account's cloud file (fresh install or trackers
      // wiped by a sign-out/switch) while a cloud backup EXISTS: we can't prove
      // the cloud copy is ours, so never silently overwrite it — let the user
      // pick a direction. This closes the re-sign-in silent-clobber gap.
      if (state.firstSync || state.isConflict) {
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

  // Explicit "Back up to cloud" (device → cloud). The user chose this direction,
  // but we still guard: if the cloud is genuinely newer (someone else synced
  // since), uploading would silently lose their work — so we hand off to the
  // conflict dialog instead of blindly overwriting. This is the "keep the
  // conflict dialog" backstop on the safe direction.
  const triggerUpload = useCallback(async () => {
    if (isWorking) return
    setIsWorking(true)
    try {
      const state = await window.electronAPI.sync.syncState()
      setIsWorking(false)
      if (state.cloudExists && (state.isConflict || state.cloudChanged)) {
        setConflictDialog({ open: true, cloudModifiedTime: state.cloudModifiedTime })
        return
      }
      await doUpload()
    } catch (e) {
      console.error('triggerUpload syncState error:', e)
      setIsWorking(false)
      // If we can't check state, fall back to a plain upload rather than block
      // the user — upload is the non-destructive direction.
      await doUpload()
    }
  }, [isWorking, doUpload])

  // Explicit "Restore from cloud" (cloud → device). This is the DESTRUCTIVE
  // direction — it replaces local data — so always confirm, and surface the
  // cloud timestamp in the prompt so the user can see what they're pulling.
  const triggerRestore = useCallback(async () => {
    if (isWorking) return
    if (!timestamps.cloudExists) {
      toast.info('No cloud backup to restore from')
      return
    }
    const when = timestamps.cloudModifiedTime
      ? new Date(timestamps.cloudModifiedTime).toLocaleString()
      : 'an unknown time'
    const ok = await confirm({
      title: 'Restore from cloud?',
      message: `This replaces ALL local data with the cloud backup from ${when}. Anything on this device that isn't in that backup will be lost. This cannot be undone.`,
      confirmText: 'Restore (replace local)',
      cancelText: 'Cancel',
    })
    if (ok) await doDownload()
  }, [isWorking, timestamps, confirm, toast, doDownload])

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
    triggerUpload,
    triggerRestore,
    timestamps,
    isWorking,
    activeOp,
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
