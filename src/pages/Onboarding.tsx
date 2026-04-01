import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/useStore";

const Onboarding = () => {
  const navigate = useNavigate();
  const { setCompany } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    taxId: "",
    fiscalYearStart: 4,
    currency: "INR",
    invoicePrefix: "INV",
    logoPath: "",
    signaturePath: "",
  });

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === "fiscalYearStart" ? parseInt(value, 10) : value,
    });
  };

  const handleLogoUpload = async () => {
    const result = await window.electronAPI.company.selectImage();
    if (result.success) {
      setFormData({ ...formData, logoPath: result.path });
    }
  };

  const handleSignatureUpload = async () => {
    const result = await window.electronAPI.company.selectImage();
    if (result.success) {
      setFormData({ ...formData, signaturePath: result.path });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await window.electronAPI.company.create(formData);

      if (result.success && result.data) {
        setCompany(result.data);
        // Trigger initial sync
        await window.electronAPI.sync.syncNow();
        navigate("/");
      } else {
        setError(result.error || "Failed to create company profile");
      }
    } catch (err) {
      setError("An error occurred while creating your profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="card">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to neuInvoicing!
            </h1>
            <p className="text-gray-600">
              Let's set up your business profile to get started
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label">Business Name *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="input"
                placeholder="Enter your business name"
              />
            </div>

            <div>
              <label className="label">Business Logo</label>
              <div
                onClick={handleLogoUpload}
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                {formData.logoPath ? (
                  <img
                    src={`file://${formData.logoPath}`}
                    alt="Logo"
                    className="max-h-24 mx-auto"
                  />
                ) : (
                  <div className="text-gray-500">
                    <p className="text-sm">Click to upload logo</p>
                    <p className="text-xs mt-1">PNG, JPG (displayed on invoices)</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="label">Business Address *</label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
                rows={3}
                className="input"
                placeholder="Enter your business address"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="input"
                  placeholder="+1 234 567 8900"
                />
              </div>

              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="input"
                  placeholder="business@example.com"
                />
              </div>
            </div>

            <div>
              <label className="label">Tax ID (GSTIN, VAT, EIN, etc.)</label>
              <input
                type="text"
                name="taxId"
                value={formData.taxId}
                onChange={handleChange}
                className="input"
                placeholder="Enter your tax identification number"
              />
            </div>

            <div>
              <label className="label">Signature</label>
              <div
                onClick={handleSignatureUpload}
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                {formData.signaturePath ? (
                  <img
                    src={`file://${formData.signaturePath}`}
                    alt="Signature"
                    className="max-h-24 mx-auto"
                  />
                ) : (
                  <div className="text-gray-500">
                    <p className="text-sm">Click to upload signature</p>
                    <p className="text-xs mt-1">PNG, JPG (used on invoices)</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Fiscal Year Start</label>
                <select
                  name="fiscalYearStart"
                  value={formData.fiscalYearStart}
                  onChange={handleChange}
                  className="input"
                >
                  <option value="1">January</option>
                  <option value="2">February</option>
                  <option value="3">March</option>
                  <option value="4">April</option>
                  <option value="5">May</option>
                  <option value="6">June</option>
                  <option value="7">July</option>
                  <option value="8">August</option>
                  <option value="9">September</option>
                  <option value="10">October</option>
                  <option value="11">November</option>
                  <option value="12">December</option>
                </select>
              </div>

              <div>
                <label className="label">Currency</label>
                <select
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
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
                  name="invoicePrefix"
                  value={formData.invoicePrefix}
                  onChange={handleChange}
                  className="input"
                  placeholder="INV"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary px-8"
              >
                {loading ? "Creating..." : "Complete Setup"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
