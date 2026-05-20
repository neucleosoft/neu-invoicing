import { useState } from 'react'
import { createElement, type ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { useToast } from '../components/ToastContext'
import SyncConflictDialog from '../components/SyncConflictDialog'

// Owns the "user clicked Connect Google from inside the app" flow:
//   1. Run OAuth.
//   2. If a cloud backup already exists for this account → open a first-connect
//      dialog (default: keep local, overwriting cloud — safer for the user
//      who already entered real data offline).
//   3. Otherwise → upload local as the initial cloud copy.
//
// Renders its own SyncConflictDialog. Each caller gets an independent instance,
// so a Settings-page button and a sidebar button don't fight over one dialog.
export function useConnectGoogle() {
  const { setAuthStatus, setCompany } = useStore()
  const toast = useToast()
  const [isConnecting, setIsConnecting] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [conflict, setConflict] = useState<{ open: boolean; modifiedTime?: string }>({ open: false })

  const refreshCompany = async () => {
    try {
      const res = await window.electronAPI.company.get()
      if (res?.success) setCompany(res.data || null)
    } catch {
      // Non-fatal — UI will simply not refresh.
    }
  }

  const connect = async () => {
    if (isConnecting) return
    setIsConnecting(true)
    try {
      const result = await window.electronAPI.auth.signInWithGoogle()
      if (!result || !result.success) {
        toast.error(result?.error || 'Sign-in cancelled')
        return
      }

      // Sign-in succeeded — main process already cleared offline_mode.
      setAuthStatus({ isAuthenticated: true, user: result.user, offlineMode: false })

      const backup = await window.electronAPI.sync.checkCloudBackup()
      if (backup?.exists) {
        // Cloud has prior data for this account — let the user pick.
        setConflict({ open: true, modifiedTime: backup.modifiedTime })
      } else {
        // No prior cloud copy — push local as the initial backup.
        const upload = await window.electronAPI.sync.upload()
        if (upload?.success) {
          toast.success('Cloud backup connected — initial upload complete.')
        } else {
          toast.error(`Connected, but initial upload failed: ${upload?.error || 'unknown'}`)
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setIsConnecting(false)
    }
  }

  const onKeepLocal = async () => {
    setIsResolving(true)
    try {
      const upload = await window.electronAPI.sync.upload()
      if (upload?.success) toast.success('Local data uploaded — cloud backup replaced.')
      else toast.error(`Upload failed: ${upload?.error || 'unknown'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsResolving(false)
      setConflict({ open: false })
    }
  }

  const onUseCloud = async () => {
    setIsResolving(true)
    try {
      const download = await window.electronAPI.sync.download()
      if (download?.success) {
        toast.success('Cloud data restored — local data replaced.')
        await refreshCompany()
      } else {
        toast.error(`Download failed: ${download?.error || 'unknown'}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setIsResolving(false)
      setConflict({ open: false })
    }
  }

  const onCancel = () => {
    if (!isResolving) setConflict({ open: false })
  }

  const dialog: ReactNode = createElement(SyncConflictDialog, {
    open: conflict.open,
    cloudModifiedTime: conflict.modifiedTime,
    isWorking: isResolving,
    onUpload: onKeepLocal,
    onDownload: onUseCloud,
    onCancel,
    mode: 'firstConnect',
  })

  return { connect, isConnecting, dialog }
}
