// Default boilerplate text for Purchase Orders. Users can edit these in Settings.
// Verbatim from a real Schoolnet India Ltd PO supplied as reference; users will tweak
// names, jurisdictions, and clauses to match their own business.

export const PO_SPECIAL_INSTRUCTIONS_DEFAULT = `1. Taxes and Levies extra as applicable.
2. Kindly mention the Billing Address and the Delivery Address separately on the bill.
3. Installation Report to be submitted along with bill.
4. GST should be separately mentioned in the Bill. You would be required to provide a 'Retail Invoice' in the event GST or other relevant taxes charged for the material supplied is not mentioned separately, failing which not only the goods items are likely to be rejected but payment will also be delayed.
5. The vendor is liable to declare the bill issued against this PO in their GST Return to be filed in the following month.
6. This is mandatory for release of final payment.
7. In case of non-submission of GST proof, the company has the right to withhold the balance payment.
8. Our Purchase Order No., item code, description and vendor code must appear on all your invoices/challans.
9. Kindly return the confirmation copy duly signed & stamped as a token of acceptance of the PO.
10. If the vendor does not respond/accept the PO within two days, it will be considered that the PO is accepted by the vendor.`

export const PO_GENERAL_TERMS_DEFAULT = `Declaration Pursuance to provisions of Section 194Q (TDS on Purchase of Goods) and 206 C (1H) (TCS on sale of Goods) of the Income Tax Act, 1961 applicable w.e.f. 1st July 2021:

1. Total sales/Gross Receipts/Aggregated Annual Turnover of [Company Name], having PAN [PAN No.], for the previous year is more than INR 10 Crore.
2. Hence with reference to the above mentioned provisions of the Income Tax Act, 1961 w.e.f. 01st July 2021, you are requested not to charge TCS as applicable under section 206C(1H) in case purchases of [Company Name] from your Company during the current year exceed INR 50 Lakh.
3. [Company Name] will be deducting TDS @ 0.1% if total purchases during the current year from your Company exceed INR 50 Lakh, or if [Company Name] has already paid INR 50 Lakh or more up to June 30, 2021 to your Company.

Jurisdiction:
This Contract shall be governed and construed in accordance with the substantive laws of India and the courts at [City] shall have exclusive jurisdiction to try any dispute arising out of or relating to any matter under this Contract.

Settlement of Disputes — Mutual Discussion:
In the event of a dispute or difference of any kind whatsoever arising between the Parties in connection with or arising out of this Agreement or the breach, termination, or validity hereof, the Parties shall endeavour to resolve such dispute in good faith in the first instance within 30 (thirty) days of the notice of such dispute by mutual discussions between the Parties.

Arbitration:
(i) If the dispute cannot be resolved within the said 30 (thirty) days by mutual discussions, an arbitral tribunal comprising of 3 arbitrators shall decide the same in accordance with the Arbitration & Conciliation Act 1996 as in force. Each Party shall appoint one arbitrator and the arbitrators so appointed shall appoint the third arbitrator, who will act as the presiding arbitrator.
(ii) In case a Party fails to appoint an arbitrator within 30 (thirty) days of the receipt of the request to do so by the other Party, or the 2 (two) arbitrators so appointed fail to agree on the appointment of the third arbitrator within 30 (thirty) days from the date of their appointment, upon request of a Party, the Chief Justice of India or any person or institution designated by him shall appoint the arbitrators/presiding arbitrator.
(iii) The arbitral tribunal shall give a reasoned award and the same shall be final, conclusive, and binding on the Parties.
(iv) The venue of the arbitration shall be [City], India.
(v) The fees of the arbitrators shall be borne by the Party nominating them, and the fee of the presiding arbitrator, costs, and other expenses incidental to the arbitration proceedings shall be borne equally by the Parties.`

export const PO_SETTINGS_KEYS = {
  specialInstructions: 'po_special_instructions',
  generalTerms: 'po_general_terms',
} as const
