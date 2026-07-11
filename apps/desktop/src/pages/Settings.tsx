import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { Company } from '../types'
import { InvoiceTemplate, TEMPLATE_INFO } from '../utils/generateInvoicePDF'
import { AlertTriangle } from 'lucide-react'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import { useManualBackup } from '../hooks/useManualBackup'
import { useConnectGoogle } from '../hooks/useConnectGoogle'
import SyncConflictDialog from '../components/SyncConflictDialog'
import {
  PO_SPECIAL_INSTRUCTIONS_DEFAULT,
  PO_GENERAL_TERMS_DEFAULT,
  PO_SETTINGS_KEYS,
} from '../utils/poDefaults'

type SettingsTab = 'company' | 'templates' | 'tax' | 'po' | 'backup'

const Settings = () => {
  const { company, setCompany, authStatus } = useStore()
  const { triggerBackup, isWorking: isBackingUp, conflictDialogProps } = useManualBackup()

  // Row-level "Sync changes now" (S2). Separate from the whole-file backup
  // above — this merges individual documents instead of replacing databases.
  const [rowSyncing, setRowSyncing] = useState(false)
  const [rowSyncSummary, setRowSyncSummary] = useState<string | null>(null)

  const handleRowSync = async () => {
    setRowSyncing(true)
    setRowSyncSummary(null)
    try {
      const r = await window.electronAPI.sync.rowSyncNow()
      if (!r.success) {
        setRowSyncSummary(`Sync failed: ${r.error || 'unknown error'}`)
        return
      }
      const bits = [
        `pulled ${r.applied ?? 0} change${(r.applied ?? 0) === 1 ? '' : 's'}`,
        `pushed ${r.pushedPackets ?? 0}`,
      ]
      if (r.localRenumbers) bits.push(`${r.localRenumbers} renumbered`)
      if (r.recomputeChanges) bits.push(`${r.recomputeChanges} totals corrected`)
      setRowSyncSummary(`Synced ✓ — ${bits.join(', ')}`)
    } catch (e) {
      setRowSyncSummary(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRowSyncing(false)
    }
  }
  const { connect: connectGoogle, isConnecting, dialog: connectDialog } = useConnectGoogle()
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
  const [backupInfo, setBackupInfo] = useState<{
    cloudBackup: { lastSyncTimestamp: string; deviceId: string } | null
    thisDeviceLastUpload: string | null
    backupFrequency: 'off' | 'daily' | 'weekly' | 'monthly'
  } | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const [formData, setFormData] = useState<Partial<Company>>({
    name: '',
    address: '',
    phone: '',
    email: '',
    taxId: '',
    fiscalYearStart: 4,
    currency: 'INR',
    invoicePrefix: 'INV',
    termsConditions: '',
    bankDetails: ''
  })
  const [saving, setSaving] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate>('classic')
  const [templateLoading, setTemplateLoading] = useState(true)
  const [logoMissing, setLogoMissing] = useState(false)
  const [logoLoading, setLogoLoading] = useState(false)
  // PO boilerplate — printed on every Purchase Order PDF. Defaults seeded from a real PO
  // we received; users edit to match their business.
  const [poSpecialInstructions, setPoSpecialInstructions] = useState('')
  const [poGeneralTerms, setPoGeneralTerms] = useState('')
  const [poBoilerplateLoading, setPoBoilerplateLoading] = useState(true)
  const [poBoilerplateSaving, setPoBoilerplateSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (company) {
      setFormData(company)
    }
  }, [company])

  useEffect(() => {
    loadTemplate()
    loadPoBoilerplate()
  }, [])

  // Check whether the logo file exists on disk (Drive syncs DB but not upload folders,
  // so on a new device the logoPath may point nowhere)
  useEffect(() => {
    const checkLogo = async () => {
      if (!company?.logoPath) { setLogoMissing(false); return }
      try {
        const res = await fetch(`local-resource://${company.logoPath.replace(/\\/g, '/')}`)
        setLogoMissing(!res.ok)
      } catch {
        setLogoMissing(true)
      }
    }
    checkLogo()
  }, [company])

  // Pull backup status whenever the user opens the Backup tab, and again every
  // time isBackingUp flips (catches the "just finished syncing" state so the
  // timestamps update without the user having to leave and come back).
  useEffect(() => {
    if (activeTab !== 'backup') return
    let cancelled = false
    ;(async () => {
      try {
        const info = await window.electronAPI.sync.getBackupInfo()
        if (!cancelled) setBackupInfo(info)
      } catch (e) {
        console.error('Failed to load backup info:', e)
      }
    })()
    return () => { cancelled = true }
  }, [activeTab, isBackingUp])

  const handleFrequencyChange = async (freq: 'off' | 'daily' | 'weekly' | 'monthly') => {
    await window.electronAPI.sync.setBackupFrequency(freq)
    const info = await window.electronAPI.sync.getBackupInfo()
    setBackupInfo(info)
  }

  const formatBackupDate = (iso: string): string => {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  // Power-user / disaster-recovery: pull the cloud copy down and replace local.
  // Always destructive of any unsynced local changes, so we gate on an explicit
  // confirm that names the backup's device + timestamp. Reloads the renderer
  // after a successful download so all in-memory state (Zustand store, etc.)
  // is rebuilt against the fresh DB instead of staying stale.
  const handleRestoreFromCloud = async () => {
    if (!backupInfo?.cloudBackup) {
      toast.info('No cloud backup found yet. Click Sync Now first to create one.')
      return
    }
    const ok = await confirm({
      title: 'Restore from cloud backup?',
      message: `This will REPLACE all your local data with the cloud backup from ${backupInfo.cloudBackup.deviceId} at ${formatBackupDate(backupInfo.cloudBackup.lastSyncTimestamp)}. Any unsynced local changes on this device will be lost.`,
      confirmText: 'Replace local data',
      cancelText: 'Cancel',
      danger: true,
    })
    if (!ok) return

    setIsRestoring(true)
    try {
      const result = await window.electronAPI.sync.download()
      if (result.success) {
        toast.success('Restored from cloud — reloading…')
        // Brief delay so the toast is visible before the reload tears it down.
        setTimeout(() => window.location.reload(), 800)
      } else {
        toast.error(result.error || 'Restore failed')
        setIsRestoring(false)
      }
    } catch (e) {
      console.error('Restore error:', e)
      toast.error('Restore failed')
      setIsRestoring(false)
    }
  }

  const loadTemplate = async () => {
    try {
      const result = await window.electronAPI.settings.get('invoiceTemplate')
      if (result.success && result.data) {
        setSelectedTemplate(result.data as InvoiceTemplate)
      }
    } catch (error) {
      console.error('Failed to load template setting:', error)
    } finally {
      setTemplateLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      if (company?.id) {
        const result = await window.electronAPI.company.update(company.id, formData)
        if (result.success && result.data) {
          setCompany(result.data)
          toast.success('Settings updated successfully!')
        }
      }
    } catch (error) {
      toast.error('Error updating settings')
    } finally {
      setSaving(false)
    }
  }

  const handleChangeLogo = async () => {
    if (!company?.id) return
    setLogoLoading(true)
    try {
      const img = await window.electronAPI.company.selectImage()
      if (img.success && img.path) {
        const upd = await window.electronAPI.company.update(company.id, { logoPath: img.path })
        if (upd.success && upd.data) {
          setCompany(upd.data)
          toast.success('Logo updated')
        }
      }
    } catch {
      toast.error('Failed to update logo')
    } finally {
      setLogoLoading(false)
    }
  }

  const handleRemoveLogo = async () => {
    if (!company?.id) return
    try {
      const upd = await window.electronAPI.company.update(company.id, { logoPath: null })
      if (upd.success && upd.data) {
        setCompany(upd.data)
        toast.success('Logo removed')
      }
    } catch {
      toast.error('Failed to remove logo')
    }
  }

  // Load saved PO boilerplate, falling back to the seeded defaults if the user has
  // never touched the settings (so the textareas always show something useful).
  const loadPoBoilerplate = async () => {
    try {
      const [specialRes, termsRes] = await Promise.all([
        window.electronAPI.settings.get(PO_SETTINGS_KEYS.specialInstructions),
        window.electronAPI.settings.get(PO_SETTINGS_KEYS.generalTerms),
      ])
      setPoSpecialInstructions(
        (specialRes.success && specialRes.data) || PO_SPECIAL_INSTRUCTIONS_DEFAULT,
      )
      setPoGeneralTerms((termsRes.success && termsRes.data) || PO_GENERAL_TERMS_DEFAULT)
    } catch (error) {
      console.error('Failed to load PO boilerplate:', error)
      setPoSpecialInstructions(PO_SPECIAL_INSTRUCTIONS_DEFAULT)
      setPoGeneralTerms(PO_GENERAL_TERMS_DEFAULT)
    } finally {
      setPoBoilerplateLoading(false)
    }
  }

  const handleSavePoBoilerplate = async () => {
    setPoBoilerplateSaving(true)
    try {
      const [r1, r2] = await Promise.all([
        window.electronAPI.settings.set(
          PO_SETTINGS_KEYS.specialInstructions,
          poSpecialInstructions,
        ),
        window.electronAPI.settings.set(PO_SETTINGS_KEYS.generalTerms, poGeneralTerms),
      ])
      if (r1.success && r2.success) {
        toast.success('Purchase Order defaults saved')
      } else {
        toast.error('Failed to save one or both fields')
      }
    } catch (error) {
      toast.error('Failed to save Purchase Order defaults')
    } finally {
      setPoBoilerplateSaving(false)
    }
  }

  const handleResetPoBoilerplate = () => {
    setPoSpecialInstructions(PO_SPECIAL_INSTRUCTIONS_DEFAULT)
    setPoGeneralTerms(PO_GENERAL_TERMS_DEFAULT)
    toast.info('Reverted to defaults — click Save to apply')
  }

  const handleTemplateSelect = async (template: InvoiceTemplate) => {
    setSelectedTemplate(template)
    try {
      const result = await window.electronAPI.settings.set('invoiceTemplate', template)
      if (result.success) {
        toast.success(`Template "${TEMPLATE_INFO[template].name}" selected successfully!`)
      }
    } catch (error) {
      toast.error('Failed to save template preference')
    }
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'company', label: 'Company Profile' },
    { id: 'templates', label: 'Invoice Templates' },
    { id: 'tax', label: 'Tax Settings' },
    { id: 'po', label: 'Purchase Orders' },
    { id: 'backup', label: 'Data & Backup' }
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Navigation */}
        <div className="card lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">Settings</h2>
          <div className="space-y-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-4 py-3 font-medium rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Settings Content */}
        <div className="card lg:col-span-2">
          {/* Company Profile Tab */}
          {activeTab === 'company' && (
            <>
              <h2 className="text-2xl font-bold mb-6">Company Profile</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="label">Company Logo</label>
                  <div className="flex items-start gap-4">
                    <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50 overflow-hidden">
                      {company?.logoPath && !logoMissing ? (
                        <img
                          src={`local-resource://${company.logoPath.replace(/\\/g, '/')}`}
                          alt="Logo"
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-gray-400">No logo</span>
                      )}
                    </div>
                    <div className="flex-1">
                      {logoMissing && company?.logoPath && (
                        <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2 mb-2">
                          Logo file is missing on this device. Re-upload to fix.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleChangeLogo}
                          disabled={logoLoading}
                          className="btn btn-secondary"
                        >
                          {logoLoading ? 'Uploading...' : company?.logoPath ? 'Change Logo' : 'Upload Logo'}
                        </button>
                        {company?.logoPath && (
                          <button type="button" onClick={handleRemoveLogo} className="btn btn-danger">
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="label">Business Name</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input"
                  />
                </div>

                <div>
                  <label className="label">Address</label>
                  <textarea
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={3}
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="input"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Tax ID</label>
                  <input
                    type="text"
                    value={formData.taxId || ''}
                    onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">Fiscal Year Start</label>
                    <select
                      value={formData.fiscalYearStart || 4}
                      onChange={(e) => setFormData({ ...formData, fiscalYearStart: parseInt(e.target.value) })}
                      className="input"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                        <option key={month} value={month}>
                          {new Date(2000, month - 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Currency</label>
                    <select
                      value={formData.currency || 'INR'}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      className="input"
                    >
                      <option value="INR">₹ INR</option>
                      <option value="USD">$ USD</option>
                      <option value="EUR">€ EUR</option>
                      <option value="GBP">£ GBP</option>
                      <option value="AUD">$ AUD</option>
                      <option value="CAD">$ CAD</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Invoice Prefix</label>
                    <input
                      type="text"
                      value={formData.invoicePrefix || 'INV'}
                      onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                      className="input"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">Terms & Conditions</label>
                  <textarea
                    value={formData.termsConditions || ''}
                    onChange={(e) => setFormData({ ...formData, termsConditions: e.target.value })}
                    rows={4}
                    className="input"
                    placeholder="Enter terms and conditions for invoices..."
                  />
                </div>

                <div>
                  <label className="label">Bank Details</label>
                  <textarea
                    value={formData.bankDetails || ''}
                    onChange={(e) => setFormData({ ...formData, bankDetails: e.target.value })}
                    rows={4}
                    className="input"
                    placeholder="Enter bank account details for invoices..."
                  />
                </div>

                <div className="flex justify-end">
                  <button type="submit" disabled={saving} className="btn btn-primary px-8">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* Invoice Templates Tab */}
          {activeTab === 'templates' && (
            <>
              <h2 className="text-2xl font-bold mb-2">Invoice Templates</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">Choose a template style for your invoices and quotations</p>

              {templateLoading ? (
                <div className="text-center py-8">Loading templates...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(Object.keys(TEMPLATE_INFO) as InvoiceTemplate[]).map((template) => {
                    const info = TEMPLATE_INFO[template]
                    const isSelected = selectedTemplate === template

                    // Template preview colors
                    const previewStyles: Record<InvoiceTemplate, { bg: string; header: string; accent: string }> = {
                      classic: { bg: 'bg-white', header: 'bg-blue-500', accent: 'text-blue-600' },
                      modern: { bg: 'bg-white', header: 'bg-gradient-to-r from-purple-500 to-pink-500', accent: 'text-purple-600' },
                      minimal: { bg: 'bg-white', header: 'bg-gray-100', accent: 'text-gray-800' },
                      elegant: { bg: 'bg-white', header: 'bg-amber-50', accent: 'text-amber-700' },
                      bold: { bg: 'bg-gray-900', header: 'bg-gray-900', accent: 'text-cyan-400' }
                    }

                    const style = previewStyles[template]

                    return (
                      <button
                        key={template}
                        onClick={() => handleTemplateSelect(template)}
                        className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-primary-500 ring-2 ring-primary-200'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {/* Template Preview */}
                        <div className={`h-32 rounded-lg overflow-hidden mb-3 ${style.bg} border border-gray-200`}>
                          {/* Mini invoice preview */}
                          <div className={`${style.header} h-8`}></div>
                          <div className="p-2 space-y-1">
                            <div className={`h-2 w-20 ${template === 'bold' ? 'bg-gray-700' : 'bg-gray-200'} rounded`}></div>
                            <div className={`h-2 w-32 ${template === 'bold' ? 'bg-gray-700' : 'bg-gray-200'} rounded`}></div>
                            <div className="mt-2 space-y-1">
                              <div className={`h-1.5 w-full ${template === 'bold' ? 'bg-gray-700' : 'bg-gray-100'} rounded`}></div>
                              <div className={`h-1.5 w-full ${template === 'bold' ? 'bg-gray-700' : 'bg-gray-100'} rounded`}></div>
                              <div className={`h-1.5 w-full ${template === 'bold' ? 'bg-gray-700' : 'bg-gray-100'} rounded`}></div>
                            </div>
                            <div className="flex justify-end mt-2">
                              <div className={`h-3 w-16 ${template === 'elegant' ? 'bg-amber-400' : template === 'bold' ? 'bg-cyan-400' : template === 'modern' ? 'bg-purple-400' : 'bg-blue-400'} rounded`}></div>
                            </div>
                          </div>
                        </div>

                        {/* Template Info */}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${style.accent}`}>{info.name}</span>
                            {isSelected && (
                              <span className="bg-primary-500 text-white text-xs px-2 py-0.5 rounded-full">
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{info.description}</p>
                        </div>

                        {/* Selected indicator */}
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <svg className="w-6 h-6 text-primary-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-1">Template Preview</h3>
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  The selected template will be used when you download or preview invoices from the Invoices page.
                  Each template has a unique design to match your business style.
                </p>
              </div>
            </>
          )}

          {/* Tax Settings Tab */}
          {activeTab === 'tax' && (
            <>
              <h2 className="text-2xl font-bold mb-6">Tax Settings</h2>
              <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-400">
                  Tax rates are configured per item. Go to the Items page to set tax rates for individual products and services.
                </p>
                <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Common GST Rates in India</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span>Essential goods:</span>
                      <span className="font-medium">0% / 5%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Standard goods:</span>
                      <span className="font-medium">12% / 18%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Luxury goods:</span>
                      <span className="font-medium">28%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Services:</span>
                      <span className="font-medium">18%</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Purchase Orders Tab */}
          {activeTab === 'po' && (
            <>
              <h2 className="text-2xl font-bold mb-2">Purchase Order Defaults</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                These notes are printed on every Purchase Order PDF you generate. Edit them
                once and they'll appear on every PO going forward.
              </p>
              {poBoilerplateLoading ? (
                <div className="text-gray-500 dark:text-gray-400">Loading…</div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <label className="label">Special Instructions</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      Numbered list shown on page 1 of the PO, below the items table.
                    </p>
                    <textarea
                      className="input font-mono text-sm"
                      rows={12}
                      value={poSpecialInstructions}
                      onChange={(e) => setPoSpecialInstructions(e.target.value)}
                      placeholder="e.g. 1. Taxes and Levies extra as applicable…"
                    />
                  </div>

                  <div>
                    <label className="label">General Terms &amp; Conditions</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      Long-form clauses (jurisdiction, arbitration, TDS/TCS, etc.) shown on page 2.
                    </p>
                    <textarea
                      className="input font-mono text-sm"
                      rows={20}
                      value={poGeneralTerms}
                      onChange={(e) => setPoGeneralTerms(e.target.value)}
                      placeholder="Jurisdiction, dispute resolution, arbitration clauses…"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-2 border-t border-gray-200 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={handleResetPoBoilerplate}
                      className="btn btn-secondary"
                      disabled={poBoilerplateSaving}
                    >
                      Reset to defaults
                    </button>
                    <button
                      type="button"
                      onClick={handleSavePoBoilerplate}
                      className="btn btn-primary"
                      disabled={poBoilerplateSaving}
                    >
                      {poBoilerplateSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Data & Backup Tab */}
          {activeTab === 'backup' && (
            <>
              <h2 className="text-2xl font-bold mb-6">Data & Backup</h2>
              <div className="space-y-6">
                {authStatus?.offlineMode ? (
                  <div className="bg-primary-50 dark:bg-primary-900/20 p-5 rounded-lg border border-primary-200 dark:border-primary-800">
                    <h3 className="font-semibold mb-2 text-primary-900 dark:text-primary-100">Cloud backup is off</h3>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                      You're using the app offline. Connect your Google account to back up your data to your own Google Drive. We never see your data — it goes into a hidden folder only this app can access.
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={connectGoogle}
                      disabled={isConnecting}
                    >
                      {isConnecting ? 'Connecting…' : 'Connect Google for cloud backup'}
                    </button>
                  </div>
                ) : (
                  <>
                <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Device Sync (beta)</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Exchanges individual changes with your phone through your own Google Drive.
                    Nothing is wiped wholesale — each document merges newest-edit-wins, and every
                    balance is rebuilt from the documents after the merge.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={handleRowSync}
                    disabled={rowSyncing || isBackingUp || isRestoring}
                  >
                    {rowSyncing ? 'Syncing changes…' : 'Sync changes now'}
                  </button>
                  {rowSyncSummary && (
                    <p className="text-xs mt-3 text-gray-700 dark:text-gray-300">{rowSyncSummary}</p>
                  )}
                </div>

                <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Google Drive Backup</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Your data is backed up to your private Google Drive. Use Sync Now to back up immediately, or set an automatic schedule.
                  </p>

                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 mb-4 space-y-1.5">
                    {backupInfo?.cloudBackup ? (
                      <>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500 dark:text-gray-400">Last cloud backup</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100 text-right">
                            {formatBackupDate(backupInfo.cloudBackup.lastSyncTimestamp)} · {backupInfo.cloudBackup.deviceId}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500 dark:text-gray-400">This device's last upload</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {backupInfo.thisDeviceLastUpload ? formatBackupDate(backupInfo.thisDeviceLastUpload) : 'Never'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400">No backup yet — click Sync Now to create one.</div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mb-4">
                    <label htmlFor="backup-frequency" className="text-sm text-gray-700 dark:text-gray-300">
                      Automatic backup:
                    </label>
                    <select
                      id="backup-frequency"
                      value={backupInfo?.backupFrequency || 'off'}
                      onChange={(e) => handleFrequencyChange(e.target.value as 'off' | 'daily' | 'weekly' | 'monthly')}
                      className="input w-auto"
                    >
                      <option value="off">Off</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={triggerBackup}
                    disabled={isBackingUp || isRestoring || rowSyncing}
                  >
                    {isBackingUp ? 'Syncing…' : 'Sync Now'}
                  </button>

                  <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-start gap-2 mb-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                      <div className="text-xs text-red-800 dark:text-red-200">
                        <strong>Destructive action.</strong> Restoring overwrites your local data with the cloud copy. Any unsynced changes on this device will be permanently lost. This cannot be undone.
                      </div>
                    </div>
                    <button
                      className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-wait"
                      onClick={handleRestoreFromCloud}
                      disabled={isBackingUp || isRestoring || rowSyncing}
                    >
                      {isRestoring ? 'Restoring…' : 'Restore from cloud…'}
                    </button>
                  </div>
                </div>
                <SyncConflictDialog {...conflictDialogProps} />
                  </>
                )}

                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <h3 className="font-semibold text-yellow-800 dark:text-yellow-300 mb-2">Local Database</h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Your data is stored locally in the app's data folder. The Google Drive sync provides an additional
                    backup layer for your important business data.
                  </p>
                </div>
              </div>
              {connectDialog}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings
