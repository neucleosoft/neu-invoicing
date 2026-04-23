import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { Company } from '../types'
import { InvoiceTemplate, TEMPLATE_INFO } from '../utils/generateInvoicePDF'
import { useToast } from '../components/Toast'

type SettingsTab = 'company' | 'templates' | 'tax' | 'backup'

const Settings = () => {
  const { company, setCompany } = useStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
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
  const toast = useToast()

  useEffect(() => {
    if (company) {
      setFormData(company)
    }
  }, [company])

  useEffect(() => {
    loadTemplate()
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
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-50'
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
              <p className="text-gray-600 mb-6">Choose a template style for your invoices and quotations</p>

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
                          <p className="text-sm text-gray-500">{info.description}</p>
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

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-1">Template Preview</h3>
                <p className="text-sm text-blue-600">
                  The selected template will be used when you download or preview invoices from the Sales page.
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
                <p className="text-gray-600">
                  Tax rates are configured per item. Go to the Items page to set tax rates for individual products and services.
                </p>
                <div className="bg-gray-50 p-4 rounded-lg">
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

          {/* Data & Backup Tab */}
          {activeTab === 'backup' && (
            <>
              <h2 className="text-2xl font-bold mb-6">Data & Backup</h2>
              <div className="space-y-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Google Drive Sync</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Your data is automatically synced to Google Drive when you're signed in.
                    This ensures your data is backed up and accessible across devices.
                  </p>
                  <button className="btn btn-outline" onClick={() => window.electronAPI.sync.syncNow()}>
                    Sync Now
                  </button>
                </div>

                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <h3 className="font-semibold text-yellow-800 mb-2">Local Database</h3>
                  <p className="text-sm text-yellow-700">
                    Your data is stored locally in the app's data folder. The Google Drive sync provides an additional
                    backup layer for your important business data.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings
