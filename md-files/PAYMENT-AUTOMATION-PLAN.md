# DerewolPrint Payment Automation Plan

## 🎯 Overview

Integrate Wave and Orange Money payment systems with automatic subscription activation via QR codes and WhatsApp contact integration.

---

## 1️⃣ WhatsApp QR Code Integration

### Current State

- WhatsApp button uses contact number: `+221781220391`
- Raw phone number passed as WhatsApp message

### Planned Change

Replace phone number contact with **WhatsApp QR code** to enable direct client-side WhatsApp web for purchase flow.

### Implementation

**File**: [derewolprint/renderer/index.html](derewolprint/renderer/index.html)

```html
<!-- Current -->
<button class="act-whatsapp-btn" id="act-whatsapp-link">
  <i class="fa-brands fa-whatsapp"></i>
  Contacter le support
</button>

<!-- Target -->
<div class="act-whatsapp-qr">
  <img id="whatsapp-qr-code" src="/assets/whatsapp-qr.png" alt="WhatsApp QR" />
  <p>Scannez pour acheter un code</p>
</div>
```

**QR Details**:

- Contact: +221 78 122 03 91
- Generate via: https://wa.me/221781220391?text=Je%20veux%20activer%20DerewolPrint
- Store as: `/derewolprint/assets/whatsapp-qr.png`

---

## 2️⃣ Wave Payment Integration

### Wave API Flow

```
Customer clicks "Wave"
  ↓
Generate Wave checkout link with subscription info
  ↓
Wave confirms payment
  ↓
Webhook triggers → Supabase subscription activated
  ↓
DerewolPrint reloads → Access granted
```

### Required Setup

1. **Wave Business Account**: https://wave.co.uk (for Senegal: accepts FCFA)
2. **API Key**: Obtain from Wave dashboard → API settings
3. **Webhook URL**: `https://derewol.app/api/webhooks/wave`

### Implementation Files

**A. Backend Webhook** - Create [derewolprint/services/wave.js](derewolprint/services/wave.js):

```javascript
const WAVE_API_KEY = process.env.WAVE_API_KEY;
const WAVE_BUSINESS_ID = process.env.WAVE_BUSINESS_ID;

async function createWaveCheckout(planData) {
  // planData: { plan: '1month', amount: 5000, printerId: 'xxx' }

  const response = await fetch("https://api.waveapps.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WAVE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        mutation CreateInvoice($input: InvoiceCreateInput!) {
          invoiceCreate(input: $input) {
            invoice { id, total { amount } }
          }
        }
      `,
      variables: {
        input: {
          businessId: WAVE_BUSINESS_ID,
          customerName: "DerewolPrint Customer",
          items: [
            {
              description: planData.plan,
              quantity: 1,
              unitPrice: planData.amount,
            },
          ],
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      },
    }),
  });

  return await response.json();
}
```

**B. Webhook Handler** - Create [pages/api/webhooks/wave.js](pages/api/webhooks/wave.js):

```javascript
import supabase from "../../../lib/supabase";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { event, data } = req.body;

  if (event === "invoice.payment_received") {
    const { printerId, planId } = data.metadata;
    const plan = PLANS[planId];

    // Activate subscription
    const expiresAt = new Date(Date.now() + plan.days * 86400000);

    await supabase
      .from("subscriptions")
      .update({
        status: "active",
        plan: planId,
        expires_at: expiresAt.toISOString(),
        payment_method: "wave",
        payment_ref: data.invoice_id,
      })
      .eq("printer_id", printerId);

    console.log(`[WAVE] ✅ Subscription activated: ${printerId}`);
  }

  res.status(200).json({ received: true });
}
```

---

## 3️⃣ Orange Money Integration

### Orange Money API Flow

```
Customer selects Orange Money
  ↓
Generate Orange Money payment request (USSD: *144#)
  ↓
Customer confirms on phone
  ↓
Orange Money confirms transaction
  ↓
Webhook triggers → Supabase subscription activated
```

### Implementation Files

**A. Orange Money Service** - Create [derewolprint/services/orangemoney.js](derewolprint/services/orangemoney.js):

```javascript
const ORANGE_API_KEY = process.env.ORANGE_API_KEY;
const ORANGE_MERCHANT_ID = process.env.ORANGE_MERCHANT_ID;

async function initiateOrangePayment(planData, phoneNumber) {
  // planData: { plan: '1month', amount: 5000 }
  // phoneNumber: customer's Senegalese number

  const requestId = `DP-${Date.now()}`;

  const response = await fetch("https://api.orange.com/orangemoney/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ORANGE_API_KEY}`,
      "X-Merchant-ID": ORANGE_MERCHANT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction_ref: requestId,
      amount: planData.amount,
      currency: "XOF", // Senegalese Franc
      customer_number: phoneNumber.replace("+221", "221"),
      description: `Plan ${planData.plan} - DerewolPrint`,
      return_url: `https://derewol.app/payment/success?ref=${requestId}`,
      callback_url: `https://derewol.app/api/webhooks/orange-money`,
    }),
  });

  return await response.json();
}
```

**B. Webhook Handler** - Create [pages/api/webhooks/orange-money.js](pages/api/webhooks/orange-money.js):

```javascript
export default async function handler(req, res) {
  const { transaction_ref, status, amount } = req.body;

  if (status === "SUCCESS") {
    const [_, printerId, planId] = transaction_ref.split("-");
    const plan = PLANS[planId];

    await supabase
      .from("subscriptions")
      .update({
        status: "active",
        plan: planId,
        expires_at: new Date(Date.now() + plan.days * 86400000).toISOString(),
        payment_method: "orange_money",
        payment_ref: transaction_ref,
      })
      .eq("printer_id", printerId);

    console.log(`[ORANGE] ✅ Payment confirmed: ${transaction_ref}`);
  }

  res.status(200).json({ received: true });
}
```

---

## 4️⃣ Admin Dashboard Integration

### New Admin Features - [admin/dashboard.html](admin/dashboard.html)

**Payments Tab**:

```html
<div class="tab-payments">
  <table>
    <thead>
      <tr>
        <th>Boutique</th>
        <th>Plan</th>
        <th>Montant</th>
        <th>Méthode</th>
        <th>Date</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="payments-list"></tbody>
  </table>
</div>
```

**Admin Script** - [admin/js/payments.js](admin/js/payments.js):

```javascript
async function loadPayments() {
  const { data } = await supabase
    .from("subscriptions")
    .select("*, printers(name)")
    .order("activated_at", { ascending: false })
    .limit(100);

  const html = data
    .map(
      (s) => `
    <tr>
      <td>${s.printers.name}</td>
      <td>${s.plan}</td>
      <td>${s.amount} FCFA</td>
      <td>${s.payment_method || "-"}</td>
      <td>${new Date(s.activated_at).toLocaleDateString("fr-FR")}</td>
      <td><span class="status ${s.status}">${s.status}</span></td>
    </tr>
  `,
    )
    .join("");

  document.getElementById("payments-list").innerHTML = html;
}
```

---

## 5️⃣ Environment Variables

Add to `.env.local`:

```env
# Wave Payment
WAVE_API_KEY=your_wave_api_key
WAVE_BUSINESS_ID=your_wave_business_id

# Orange Money
ORANGE_API_KEY=your_orange_api_key
ORANGE_MERCHANT_ID=your_merchant_id

# Webhooks
WEBHOOK_SECRET=your_webhook_secret_key
```

---

## 6️⃣ Database Schema Updates

```sql
-- Add payment tracking columns to subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_ref TEXT UNIQUE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_subs_payment_ref
  ON subscriptions(payment_ref);
```

---

## 📋 Implementation Roadmap

| Phase | Task                       | Priority  |
| ----- | -------------------------- | --------- |
| 1     | WhatsApp QR code + contact | 🔴 HIGH   |
| 2     | Wave Payment integration   | 🟠 MEDIUM |
| 3     | Orange Money integration   | 🟠 MEDIUM |
| 4     | Admin payment dashboard    | 🟡 LOW    |
| 5     | Automated retry logic      | 🟡 LOW    |

---

## 🧪 Testing Checklist

- [ ] Wave sandbox testing with mock transactions
- [ ] Orange Money test mode with USSD simulation
- [ ] Webhook delivery verification
- [ ] Subscription auto-activation after payment
- [ ] Failed payment recovery flow
- [ ] Admin dashboard payment tracking
- [ ] WhatsApp QR scan and contact flow

---

## 🔒 Security Notes

- All API keys stored in `process.env` (never commit)
- Webhook signatures validated against `WEBHOOK_SECRET`
- Payment amounts verified server-side (never trust client)
- Sensitive logs masked in production
- Rate limiting on webhook endpoints (prevent replay attacks)
