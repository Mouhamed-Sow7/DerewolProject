# DerewolPrint — 2 fonctionnalités : Limite fichiers 20 + Système abonnement

---

## FONCTIONNALITÉ 1 — Limite fichiers : 5 → 20

### PWA `pages/p/index.js`
```js
// AVANT
const MAX_FILES = 5;
// APRÈS
const MAX_FILES = 20;
```

### DerewolPrint `renderer/js/ui/renderJobs.js`
Aucun changement nécessaire — pas de limite côté imprimeur.

### DerewolPrint `main/main.js` — si une validation existe côté serveur
Chercher toute référence à `maxFiles`, `MAX_FILES`, `5` dans le contexte upload et passer à `20`.

---

## FONCTIONNALITÉ 2 — Système d'abonnement mensuel avec activation par code

### Concept
- Abonnement : **4 000 FCFA / mois**
- Paiement : Wave ou Orange Money (manuel pour l'instant)
- Après paiement : l'imprimeur reçoit un **code d'activation** à 12 caractères
- Il entre ce code dans DerewolPrint → l'app se déverrouille pour 30 jours
- Si abonnement expiré → overlay non fermable bloque toute l'app

---

### Architecture

#### Table Supabase `subscriptions` (SQL à exécuter)
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  printer_id UUID REFERENCES printers(id) ON DELETE CASCADE,
  activation_code TEXT UNIQUE NOT NULL,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  duration_days INT DEFAULT 30,
  amount INT DEFAULT 4000,
  payment_method TEXT CHECK (payment_method IN ('wave', 'orange_money', 'manual')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'used')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON subscriptions(printer_id);
CREATE INDEX ON subscriptions(activation_code);
CREATE INDEX ON subscriptions(expires_at);
```

#### Génération des codes (admin — script Node.js séparé)
```js
// scripts/generate-code.js
// Usage: node generate-code.js [printer_id] [payment_method]
// Génère un code unique et l'insère dans Supabase
const code = generateCode(); // ex: DW-A7K2-X9P3-M5N1
```

Format code : `DW-XXXX-XXXX-XXXX` (lettres majuscules + chiffres, sans ambigüe O/0/I/1)

---

### Implémentation DerewolPrint

#### `services/subscription.js` (NOUVEAU)
```js
const supabase = require('./supabase');
const { loadConfig, saveConfig } = require('./printerConfig');

const GRACE_PERIOD_DAYS = 3; // 3 jours de grâce après expiration

// Vérifie si l'abonnement est valide
async function checkSubscription(printerId) {
  // 1. Vérifie d'abord en local (cache)
  const cfg = loadConfig();
  if (cfg?.subscription?.expiresAt) {
    const expiresAt = new Date(cfg.subscription.expiresAt);
    const now = new Date();
    const gracePeriod = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 86400000);
    
    if (now < gracePeriod) {
      return {
        valid: now < expiresAt,
        expired: now >= expiresAt,
        expiresAt: cfg.subscription.expiresAt,
        daysLeft: Math.ceil((expiresAt - now) / 86400000),
        inGrace: now >= expiresAt && now < gracePeriod,
      };
    }
  }
  
  // 2. Vérifie en DB
  const { data } = await supabase
    .from('subscriptions')
    .select('expires_at, status, activated_at')
    .eq('printer_id', printerId)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!data) return { valid: false, expired: true, daysLeft: 0 };
  
  const expiresAt = new Date(data.expires_at);
  const now = new Date();
  const daysLeft = Math.ceil((expiresAt - now) / 86400000);
  const gracePeriod = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 86400000);
  
  // Cache local
  const cfg2 = loadConfig();
  saveConfig({ ...cfg2, subscription: { expiresAt: data.expires_at, daysLeft } });
  
  return {
    valid: now < expiresAt,
    expired: now >= expiresAt,
    expiresAt: data.expires_at,
    daysLeft: Math.max(0, daysLeft),
    inGrace: now >= expiresAt && now < gracePeriod,
  };
}

// Active un code
async function activateCode(printerId, code) {
  const cleanCode = code.toUpperCase().replace(/\s/g, '');
  
  // Cherche le code
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('activation_code', cleanCode)
    .eq('status', 'pending')
    .single();
  
  if (error || !data) {
    return { success: false, error: 'Code invalide ou déjà utilisé' };
  }
  
  // Vérifie que le code est pour ce printer (ou non assigné)
  if (data.printer_id && data.printer_id !== printerId) {
    return { success: false, error: 'Ce code n\'est pas associé à votre compte' };
  }
  
  // Calcule la nouvelle expiration
  // Si déjà un abonnement actif → prolonge depuis la date d'expiration actuelle
  const { data: current } = await supabase
    .from('subscriptions')
    .select('expires_at')
    .eq('printer_id', printerId)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();
  
  const baseDate = current?.expires_at && new Date(current.expires_at) > new Date()
    ? new Date(current.expires_at)
    : new Date();
  
  const expiresAt = new Date(baseDate.getTime() + data.duration_days * 86400000);
  
  // Active le code
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      printer_id:   printerId,
      status:       'active',
      activated_at: new Date().toISOString(),
      expires_at:   expiresAt.toISOString(),
    })
    .eq('id', data.id);
  
  if (updateError) return { success: false, error: 'Erreur activation' };
  
  // Cache local
  const cfg = loadConfig();
  saveConfig({ ...cfg, subscription: { expiresAt: expiresAt.toISOString(), daysLeft: data.duration_days } });
  
  return {
    success: true,
    expiresAt: expiresAt.toISOString(),
    daysLeft: data.duration_days,
    message: `Abonnement activé jusqu'au ${expiresAt.toLocaleDateString('fr-FR')}`,
  };
}

module.exports = { checkSubscription, activateCode, GRACE_PERIOD_DAYS };
```

#### `main/main.js` — vérification au boot + IPC
```js
const { checkSubscription, activateCode } = require('./services/subscription');

// Dans app.whenReady(), après launchApp() :
async function checkAndEnforceSubscription() {
  if (!printerCfg?.id) return;
  
  try {
    const sub = await checkSubscription(printerCfg.id);
    
    // Envoie le statut au renderer
    if (mainWindow) {
      mainWindow.webContents.send('subscription:status', sub);
    }
    
    // Vérifie toutes les heures
    setInterval(async () => {
      const s = await checkSubscription(printerCfg.id);
      if (mainWindow) mainWindow.webContents.send('subscription:status', s);
    }, 60 * 60 * 1000);
    
  } catch (err) {
    console.error('[SUB] Erreur vérification:', err.message);
    // En cas d'erreur réseau → ne pas bloquer (mode offline grace)
  }
}

// IPC handlers
ipcMain.handle('subscription:check', async () => {
  if (!printerCfg?.id) return { valid: false, error: 'Non configuré' };
  return checkSubscription(printerCfg.id);
});

ipcMain.handle('subscription:activate', async (_, code) => {
  if (!printerCfg?.id) return { success: false, error: 'Non configuré' };
  return activateCode(printerCfg.id, code);
});
```

#### `preload/preload.js` — exposer subscription
```js
subscriptionCheck:    () => ipcRenderer.invoke('subscription:check'),
subscriptionActivate: (code) => ipcRenderer.invoke('subscription:activate', code),
onSubscriptionStatus: (cb) => ipcRenderer.on('subscription:status', (_, data) => cb(data)),
```

#### `renderer/index.html` — overlay abonnement expiré
Ajouter avant `</body>` :
```html
<!-- Overlay abonnement expiré — non fermable -->
<div id="subscription-overlay" style="display:none">
  <div class="sub-overlay-backdrop"></div>
  <div class="sub-overlay-box">
    
    <div class="sub-overlay-header">
      <div class="sub-logo-mark"></div>
      <span class="sub-logo-text">Derew<b>ol</b></span>
    </div>
    
    <div class="sub-overlay-icon">
      <i class="fa-solid fa-lock"></i>
    </div>
    
    <h2 class="sub-overlay-title">Abonnement expiré</h2>
    <p class="sub-overlay-desc">
      Votre abonnement mensuel Derewol a expiré.<br>
      Renouvelez pour continuer à recevoir des commandes d'impression.
    </p>
    
    <!-- Prix -->
    <div class="sub-price-badge">
      <span class="sub-price">4 000 FCFA</span>
      <span class="sub-price-period">/ mois</span>
    </div>
    
    <!-- QR codes paiement -->
    <div class="sub-payment-section">
      <p class="sub-payment-title">Payez via :</p>
      <div class="sub-payment-methods">
        
        <div class="sub-payment-method">
          <div class="sub-payment-logo wave">
            <i class="fa-solid fa-wave-square"></i> Wave
          </div>
          <!-- QR Wave — remplacer src par ton vrai QR -->
          <div class="sub-qr-placeholder" id="sub-qr-wave">
            <img src="./assets/qr-wave.png" alt="QR Wave" 
                 onerror="this.parentElement.innerHTML='<span class=sub-qr-fallback>QR Wave<br>+221 XX XXX XX XX</span>'" />
          </div>
          <span class="sub-payment-number">+221 XX XXX XX XX</span>
        </div>
        
        <div class="sub-payment-method">
          <div class="sub-payment-logo om">
            <i class="fa-solid fa-mobile-screen"></i> Orange Money
          </div>
          <!-- QR Orange Money -->
          <div class="sub-qr-placeholder" id="sub-qr-om">
            <img src="./assets/qr-om.png" alt="QR Orange Money"
                 onerror="this.parentElement.innerHTML='<span class=sub-qr-fallback>Orange Money<br>+221 XX XXX XX XX</span>'" />
          </div>
          <span class="sub-payment-number">+221 XX XXX XX XX</span>
        </div>
        
      </div>
    </div>
    
    <!-- Zone saisie code -->
    <div class="sub-activation-section">
      <p class="sub-activation-title">Après paiement, entrez votre code :</p>
      <div class="sub-code-input-wrap">
        <input 
          type="text" 
          id="sub-activation-code" 
          placeholder="DW-XXXX-XXXX-XXXX"
          maxlength="19"
          autocomplete="off"
          spellcheck="false"
        />
        <button id="sub-activate-btn" class="sub-activate-btn">
          <i class="fa-solid fa-check"></i> Activer
        </button>
      </div>
      <p id="sub-activation-error" class="sub-activation-error" style="display:none"></p>
    </div>
    
    <!-- Note -->
    <p class="sub-note">
      <i class="fa-solid fa-info-circle"></i>
      Mentionnez votre identifiant boutique lors du paiement : 
      <strong id="sub-printer-slug">—</strong>
    </p>
    
  </div>
</div>
```

#### `renderer/renderer.js` — logique overlay
```js
// Écoute statut abonnement
window.derewol.onSubscriptionStatus((sub) => {
  handleSubscriptionStatus(sub);
});

// Vérifie au chargement
window.derewol.subscriptionCheck().then(handleSubscriptionStatus).catch(() => {});

function handleSubscriptionStatus(sub) {
  const overlay = document.getElementById('subscription-overlay');
  if (!overlay) return;
  
  if (!sub.valid && !sub.inGrace) {
    // Affiche overlay
    overlay.style.display = 'flex';
    
    // Affiche slug imprimeur
    const slugEl = document.getElementById('sub-printer-slug');
    if (slugEl && window.__printerCfg?.slug) {
      slugEl.textContent = window.__printerCfg.slug;
    }
    
  } else {
    overlay.style.display = 'none';
    
    // Avertissement si proche expiration (< 5 jours)
    if (sub.daysLeft <= 5 && sub.daysLeft > 0) {
      showToast(`⚠️ Abonnement expire dans ${sub.daysLeft} jour(s)`, 'warning');
    }
  }
}

// Formatage automatique du code
document.getElementById('sub-activation-code')?.addEventListener('input', (e) => {
  let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Format: DW-XXXX-XXXX-XXXX
  if (val.startsWith('DW')) {
    let parts = ['DW'];
    const rest = val.slice(2);
    for (let i = 0; i < rest.length && parts.length < 4; i += 4) {
      parts.push(rest.slice(i, i + 4));
    }
    val = parts.join('-');
  }
  e.target.value = val;
});

// Activation du code
document.getElementById('sub-activate-btn')?.addEventListener('click', async () => {
  const code = document.getElementById('sub-activation-code')?.value;
  const errorEl = document.getElementById('sub-activation-error');
  const btn = document.getElementById('sub-activate-btn');
  
  if (!code || code.length < 10) {
    errorEl.textContent = 'Veuillez entrer un code valide';
    errorEl.style.display = 'block';
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Vérification...';
  
  const result = await window.derewol.subscriptionActivate(code);
  
  if (result.success) {
    document.getElementById('subscription-overlay').style.display = 'none';
    showToast(`✅ ${result.message}`, 'success');
  } else {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Activer';
  }
});
```

#### `renderer/renderer.css` — styles overlay
```css
/* ── Overlay abonnement ──────────────────────────── */
#subscription-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sub-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
}

.sub-overlay-box {
  position: relative;
  z-index: 1;
  background: var(--surface, #fff);
  border-radius: 16px;
  padding: 32px 28px;
  max-width: 480px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  text-align: center;
}

.sub-overlay-icon {
  font-size: 48px;
  color: #e53935;
  margin-bottom: 12px;
}

.sub-overlay-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text, #111);
  margin-bottom: 8px;
}

.sub-overlay-desc {
  font-size: 14px;
  color: var(--text-muted, #666);
  line-height: 1.6;
  margin-bottom: 20px;
}

.sub-price-badge {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  background: #f5c842;
  color: #111;
  border-radius: 12px;
  padding: 8px 20px;
  margin-bottom: 24px;
}

.sub-price {
  font-size: 24px;
  font-weight: 800;
}

.sub-price-period {
  font-size: 14px;
  font-weight: 500;
}

.sub-payment-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted, #666);
  margin-bottom: 12px;
}

.sub-payment-methods {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.sub-payment-method {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sub-payment-logo {
  font-size: 13px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 8px;
}

.sub-payment-logo.wave {
  background: #1b9af7;
  color: #fff;
}

.sub-payment-logo.om {
  background: #ff6600;
  color: #fff;
}

.sub-qr-placeholder {
  width: 120px;
  height: 120px;
  border: 2px solid var(--border, #ddd);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.sub-qr-placeholder img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sub-qr-fallback {
  font-size: 11px;
  color: var(--text-muted, #888);
  text-align: center;
  line-height: 1.5;
}

.sub-payment-number {
  font-size: 12px;
  font-family: monospace;
  color: var(--text-muted, #666);
}

.sub-activation-section {
  background: var(--bg, #f5f5f5);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 16px;
}

.sub-activation-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text, #111);
}

.sub-code-input-wrap {
  display: flex;
  gap: 8px;
}

.sub-code-input-wrap input {
  flex: 1;
  padding: 10px 12px;
  border: 2px solid var(--border, #ddd);
  border-radius: 8px;
  font-size: 14px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  background: var(--surface, #fff);
  color: var(--text, #111);
}

.sub-code-input-wrap input:focus {
  outline: none;
  border-color: #1e4d2b;
}

.sub-activate-btn {
  padding: 10px 16px;
  background: #1e4d2b;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.sub-activate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sub-activation-error {
  font-size: 12px;
  color: #e53935;
  margin-top: 8px;
  text-align: left;
}

.sub-note {
  font-size: 11px;
  color: var(--text-muted, #888);
  line-height: 1.5;
}

/* Dark mode */
body.dark-mode .sub-overlay-box {
  background: #1a2a1f;
  border: 1px solid #2d4a35;
}

body.dark-mode .sub-activation-section {
  background: #111f16;
}

body.dark-mode .sub-code-input-wrap input {
  background: #111f16;
  border-color: #2d4a35;
  color: #e8f5e9;
}
```

#### `scripts/generate-code.js` (NOUVEAU — usage admin uniquement)
```js
// node scripts/generate-code.js [printer_id_optionnel] [wave|orange_money|manual]
// Génère et insère un code d'activation dans Supabase

const supabase = require('../services/supabase');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O,0,I,1
  function rand(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return `DW-${rand(4)}-${rand(4)}-${rand(4)}`;
}

async function main() {
  const printerId = process.argv[2] || null;
  const paymentMethod = process.argv[3] || 'manual';
  
  const code = generateCode();
  
  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      printer_id:     printerId,
      activation_code: code,
      payment_method: paymentMethod,
      duration_days:  30,
      amount:         4000,
      status:         'pending',
    })
    .select()
    .single();
  
  if (error) {
    console.error('Erreur:', error.message);
    process.exit(1);
  }
  
  console.log('✅ Code généré:');
  console.log('   Code:', code);
  console.log('   Pour printer:', printerId || 'tout imprimeur');
  console.log('   Valable:', data.duration_days, 'jours après activation');
  console.log('   ID DB:', data.id);
}

main();
```

---

## FICHIERS À MODIFIER / CRÉER

1. `pages/p/index.js` — MAX_FILES: 5 → 20
2. `services/subscription.js` — NOUVEAU
3. `main/main.js` — checkAndEnforceSubscription + IPC handlers
4. `preload/preload.js` — subscriptionCheck, subscriptionActivate, onSubscriptionStatus
5. `renderer/index.html` — overlay HTML
6. `renderer/renderer.js` — handleSubscriptionStatus + activation
7. `renderer/renderer.css` — styles overlay
8. `scripts/generate-code.js` — NOUVEAU (admin)

## SQL À EXÉCUTER dans Supabase AVANT tout
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  printer_id UUID REFERENCES printers(id) ON DELETE CASCADE,
  activation_code TEXT UNIQUE NOT NULL,
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  duration_days INT DEFAULT 30,
  amount INT DEFAULT 4000,
  payment_method TEXT CHECK (payment_method IN ('wave', 'orange_money', 'manual')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'used')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON subscriptions(printer_id);
CREATE INDEX ON subscriptions(activation_code);
CREATE INDEX ON subscriptions(expires_at);
```

## OUTPUT
SQL en premier, puis fichiers complets séparés par `---FILE: chemin/fichier---`