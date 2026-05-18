// Demo Data Seed Script for Neu Invoicing
// Run this with: node seed-demo-data.js

const { PrismaClient } = require('@prisma/client');
const path = require('path');

// Set database path
const dbPath = path.join(process.env.APPDATA || process.env.HOME, 'neu-invoicing', 'neuinvoicing.db');
process.env.DATABASE_URL = `file:${dbPath}`;

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding demo data...\n');

  try {
    // 1. Create Company Profile
    console.log('📋 Creating company profile...');
    const company = await prisma.company.upsert({
      where: { id: 'demo-company' },
      update: {},
      create: {
        id: 'demo-company',
        name: 'Demo Tech Solutions',
        address: '123 Business Street, Tech City, TC 12345',
        phone: '+1 (555) 123-4567',
        email: 'contact@demotechsolutions.com',
        taxId: 'TAX-123456789',
        currency: 'USD',
        invoicePrefix: 'INV',
        termsConditions: 'Payment due within 30 days. Late payments subject to 1.5% monthly interest.',
        bankDetails: 'Bank: Demo Bank | Account: 1234567890 | Routing: 987654321'
      }
    });
    console.log('✅ Company created:', company.name);

    // 2. Create Demo Customers
    console.log('\n👥 Creating customers...');
    const customers = [];
    const customerData = [
      { name: 'Acme Corporation', email: 'billing@acme.com', phone: '+1 (555) 111-2222' },
      { name: 'TechStart Inc', email: 'accounts@techstart.io', phone: '+1 (555) 222-3333' },
      { name: 'Global Industries', email: 'finance@globalind.com', phone: '+1 (555) 333-4444' },
      { name: 'Small Business LLC', email: 'owner@smallbiz.com', phone: '+1 (555) 444-5555' },
      { name: 'Enterprise Solutions', email: 'ap@enterprise.com', phone: '+1 (555) 555-6666' }
    ];

    for (let i = 0; i < customerData.length; i++) {
      const customer = await prisma.party.create({
        data: {
          name: customerData[i].name,
          type: 'CUSTOMER',
          email: customerData[i].email,
          phone: customerData[i].phone,
          billingAddress: `${100 + i} Customer St, City, ST ${10000 + i}`,
          shippingAddress: `${100 + i} Customer St, City, ST ${10000 + i}`,
          taxId: `TAX-CUST-${1000 + i}`,
          openingBalance: 0,
          currentBalance: 0
        }
      });
      customers.push(customer);
      console.log(`✅ Customer ${i + 1}:`, customer.name);
    }

    // 3. Create Demo Suppliers
    console.log('\n🏭 Creating suppliers...');
    const suppliers = [];
    const supplierData = [
      { name: 'Office Supplies Co', email: 'sales@officesupplies.com' },
      { name: 'Tech Hardware Inc', email: 'orders@techhardware.com' }
    ];

    for (let i = 0; i < supplierData.length; i++) {
      const supplier = await prisma.party.create({
        data: {
          name: supplierData[i].name,
          type: 'SUPPLIER',
          email: supplierData[i].email,
          phone: `+1 (555) ${600 + i}00-7777`,
          billingAddress: `${200 + i} Supplier Ave, City, ST ${20000 + i}`,
          openingBalance: 0,
          currentBalance: 0
        }
      });
      suppliers.push(supplier);
      console.log(`✅ Supplier ${i + 1}:`, supplier.name);
    }

    // 4. Create Demo Items/Products
    console.log('\n📦 Creating products and services...');
    const items = [];
    const itemData = [
      { name: 'Website Design', price: 2500, type: 'SERVICE', tax: 10, track: false },
      { name: 'SEO Optimization', price: 800, type: 'SERVICE', tax: 10, track: false },
      { name: 'Mobile App Development', price: 5000, type: 'SERVICE', tax: 10, track: false },
      { name: 'Logo Design', price: 500, type: 'SERVICE', tax: 10, track: false },
      { name: 'Content Writing (per page)', price: 150, type: 'SERVICE', tax: 10, track: false },
      { name: 'Software License', price: 299, type: 'PRODUCT', tax: 8, track: true, stock: 100 },
      { name: 'Hosting Package (Annual)', price: 199, type: 'SERVICE', tax: 8, track: false },
      { name: 'SSL Certificate', price: 79, type: 'PRODUCT', tax: 8, track: true, stock: 50 },
      { name: 'Consultation Hour', price: 120, type: 'SERVICE', tax: 10, track: false },
      { name: 'Maintenance Package', price: 400, type: 'SERVICE', tax: 10, track: false }
    ];

    for (let i = 0; i < itemData.length; i++) {
      const itemInfo = itemData[i];
      const item = await prisma.item.create({
        data: {
          name: itemInfo.name,
          type: itemInfo.type,
          salePrice: itemInfo.price,
          purchasePrice: itemInfo.price * 0.6,
          taxRate: itemInfo.tax,
          trackStock: itemInfo.track,
          currentStock: itemInfo.stock || 0,
          lowStockWarning: itemInfo.track ? 10 : 0,
          unit: itemInfo.type === 'SERVICE' ? 'Hour' : 'Unit'
        }
      });
      items.push(item);
      console.log(`✅ Item ${i + 1}:`, item.name, `- $${item.salePrice}`);
    }

    // 5. Create Demo Invoices
    console.log('\n📄 Creating demo invoices...');
    const invoiceData = [
      { customer: 0, items: [[0, 1], [1, 1]], date: -30, type: 'INVOICE', status: 'PAID' },
      { customer: 1, items: [[2, 1]], date: -25, type: 'INVOICE', status: 'PAID' },
      { customer: 2, items: [[3, 2], [4, 10]], date: -20, type: 'INVOICE', status: 'PARTIAL' },
      { customer: 0, items: [[5, 5], [6, 1]], date: -15, type: 'INVOICE', status: 'UNPAID' },
      { customer: 3, items: [[7, 2], [8, 3]], date: -10, type: 'INVOICE', status: 'PAID' },
      { customer: 4, items: [[9, 1]], date: -8, type: 'INVOICE', status: 'UNPAID' },
      { customer: 1, items: [[0, 1], [5, 10]], date: -5, type: 'INVOICE', status: 'PARTIAL' },
      { customer: 2, items: [[2, 1], [9, 2]], date: -3, type: 'INVOICE', status: 'UNPAID' },
      { customer: 3, items: [[6, 2], [8, 5]], date: -1, type: 'QUOTATION', status: 'UNPAID' },
      { customer: 4, items: [[1, 2], [4, 15]], date: 0, type: 'QUOTATION', status: 'UNPAID' }
    ];

    for (let i = 0; i < invoiceData.length; i++) {
      const invData = invoiceData[i];
      const customer = customers[invData.customer];

      // Calculate invoice totals
      let subtotal = 0;
      let taxAmount = 0;
      const invoiceItems = [];

      for (const [itemIdx, qty] of invData.items) {
        const item = items[itemIdx];
        const lineSubtotal = item.salePrice * qty;
        const lineTax = lineSubtotal * (item.taxRate / 100);
        const lineTotal = lineSubtotal + lineTax;

        subtotal += lineSubtotal;
        taxAmount += lineTax;

        invoiceItems.push({
          itemId: item.id,
          quantity: qty,
          rate: item.salePrice,
          taxRate: item.taxRate,
          discount: 0,
          total: lineTotal
        });
      }

      const total = subtotal + taxAmount;
      const invoiceDate = new Date();
      invoiceDate.setDate(invoiceDate.getDate() + invData.date);

      // Generate invoice number
      const invoiceNumber = `INV-${String(i + 1).padStart(4, '0')}`;

      const amountPaid = invData.status === 'PAID' ? total : invData.status === 'PARTIAL' ? total * 0.5 : 0;
      const balanceDue = total - amountPaid;

      const invoice = await prisma.salesInvoice.create({
        data: {
          invoiceNumber,
          partyId: customer.id,
          type: invData.type,
          status: invData.status,
          invoiceDate,
          subtotal,
          discount: 0,
          taxAmount,
          totalAmount: total,
          amountPaid,
          balanceDue,
          items: {
            create: invoiceItems
          }
        }
      });

      // Update party balance
      const balanceChange = invData.status === 'PAID' ? 0 :
                            invData.status === 'PARTIAL' ? total * 0.5 : total;

      await prisma.party.update({
        where: { id: customer.id },
        data: {
          currentBalance: {
            increment: balanceChange
          }
        }
      });

      console.log(`✅ Invoice ${i + 1}: ${invoiceNumber} - ${customer.name} - $${total.toFixed(2)} (${invData.status})`);

      // Create payments for PAID and PARTIAL invoices
      if (invData.status === 'PAID' || invData.status === 'PARTIAL') {
        const paymentAmount = invData.status === 'PAID' ? total : total * 0.5;
        const payment = await prisma.paymentTransaction.create({
          data: {
            partyId: customer.id,
            type: 'PAYMENT_IN',
            amount: paymentAmount,
            paymentDate: new Date(invoiceDate.getTime() + 1000 * 60 * 60 * 24), // Next day
            paymentMode: i % 2 === 0 ? 'BANK' : 'CASH',
            referenceType: 'INVOICE',
            notes: `Payment for ${invoiceNumber} - PAY-${String(i + 1).padStart(4, '0')}`
          }
        });
        console.log(`  💰 Payment: $${paymentAmount.toFixed(2)}`);
      }
    }

    // 6. Create Demo Purchase Bills
    console.log('\n🛒 Creating purchase bills...');
    const purchaseData = [
      { supplier: 0, items: [[5, 20], [7, 10]], date: -20 },
      { supplier: 1, items: [[5, 30]], date: -10 }
    ];

    for (let i = 0; i < purchaseData.length; i++) {
      const purData = purchaseData[i];
      const supplier = suppliers[purData.supplier];

      let subtotal = 0;
      let taxAmount = 0;
      const billItems = [];

      for (const [itemIdx, qty] of purData.items) {
        const item = items[itemIdx];
        const lineSubtotal = item.purchasePrice * qty;
        const lineTax = lineSubtotal * (item.taxRate / 100);
        const lineTotal = lineSubtotal + lineTax;

        subtotal += lineSubtotal;
        taxAmount += lineTax;

        billItems.push({
          itemId: item.id,
          quantity: qty,
          rate: item.purchasePrice,
          taxRate: item.taxRate,
          total: lineTotal
        });

        // Update stock
        if (item.trackStock) {
          await prisma.item.update({
            where: { id: item.id },
            data: {
              currentStock: {
                increment: qty
              }
            }
          });

          await prisma.stockMovement.create({
            data: {
              itemId: item.id,
              movementType: 'PURCHASE',
              quantity: qty,
              referenceType: 'BILL',
              notes: `Purchase from ${supplier.name}`
            }
          });
        }
      }

      const total = subtotal + taxAmount;
      const billDate = new Date();
      billDate.setDate(billDate.getDate() + purData.date);

      const billNumber = `BILL-${String(i + 1).padStart(4, '0')}`;

      const bill = await prisma.purchaseBill.create({
        data: {
          billNumber,
          partyId: supplier.id,
          billDate,
          subtotal,
          discount: 0,
          taxAmount,
          totalAmount: total,
          amountPaid: 0,
          balanceDue: total,
          status: 'UNPAID',
          items: {
            create: billItems
          }
        }
      });

      await prisma.party.update({
        where: { id: supplier.id },
        data: {
          currentBalance: {
            increment: -total
          }
        }
      });

      console.log(`✅ Bill ${i + 1}: ${billNumber} - ${supplier.name} - $${total.toFixed(2)}`);
    }

    console.log('\n✨ Demo data seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`   - 1 Company profile`);
    console.log(`   - ${customers.length} Customers`);
    console.log(`   - ${suppliers.length} Suppliers`);
    console.log(`   - ${items.length} Products/Services`);
    console.log(`   - ${invoiceData.length} Invoices (8 invoices + 2 quotations)`);
    console.log(`   - ${purchaseData.length} Purchase bills`);
    console.log(`   - Multiple payments recorded`);
    console.log('\n🎉 Your app is now ready with demo data!');

  } catch (error) {
    console.error('❌ Error seeding data:', error);
    throw error;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
