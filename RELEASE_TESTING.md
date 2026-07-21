# Release Testing

Run both checks below on a clean Windows VM before sending any new installer to users.

Why this matters: every developer's machine is "poisoned" by dev tooling that auto-applies schema migrations. So local "it works for me" testing is meaningless for catching upgrade-path or fresh-install bugs. These tests reproduce what a real user actually sees.

---

## Setup (one time)

You need a Windows VM you can snapshot.

- Free options: Hyper-V (Windows Pro), VirtualBox, or a spare laptop you can reset.
- After installing each new version, take a snapshot named `installed-vN`. That way the "previous version" snapshot for Test 2 is always one release behind.

---

## Test 1 — Fresh install (no prior data)

1. Roll back VM to the "clean Windows" snapshot. Confirm `%APPDATA%\neu-invoicing` does not exist.
2. Run the new `.exe` installer. Complete the install with default options.
3. Launch the app. Walk through onboarding — create the company.
4. Create one of each: customer, item, sales invoice, quotation, purchase bill.
5. Close the app. Reopen it. Confirm everything you created is still visible.

If any page shows empty or any operation fails, **do not ship**.

## Test 2 — Upgrade from the previous version

1. Roll back VM to the `installed-v(N-1)` snapshot.
2. Open the previous version. Create 2–3 sales invoices, 1–2 quotations, 2–3 customers, 2–3 items, 1 purchase bill.
3. Close the app.
4. Run the new installer on top. Do NOT uninstall the previous version first.
5. Launch the new version. Confirm ALL data from step 2 is still visible:
   - Sales Invoices list shows your invoices
   - Quotations list shows your quotations
   - Customers list shows your customers
   - Items list shows your items
   - Purchase Bills list shows your bill
   - Dashboard numbers reflect the data

If any data is missing, the upgrade path is broken — **do not ship**.

---

## After the release passes

- Take a fresh `installed-vN` snapshot of the VM with the new version installed.
- That becomes the `installed-v(N-1)` snapshot for the next release's Test 2.
