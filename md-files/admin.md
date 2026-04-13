# Derewol Admin Dashboard — HTML/CSS/JS vanilla + Supabase

## CONTEXTE
Dashboard admin SaaS pour gérer les imprimeurs abonnés à DerewolPrint.
- Hébergé sur LWS dans un sous-dossier `/admin/`
- Auth : Supabase Auth (email + mot de passe) — UN SEUL compte admin
- Stack : HTML + CSS + JS vanilla (pas de framework)
- Supabase JS CDN : https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2

---

## STRUCTURE DES FICHIERS À CRÉER

```
admin/
├── index.html          ← login page
├── dashboard.html      ← page principale (protégée)
├── css/
│   └── admin.css       ← styles
├── js/
│   ├── supabase-client.js   ← init Supabase
│   ├── auth.js              ← login/logout/guard
│   ├── printers.js          ← gestion imprimeurs
│   ├── subscriptions.js     ← gestion abonnements + codes
│   └── dashboard.js         ← stats + init page
└── .htaccess               ← protection + HTTPS
```

---

## TABLES SUPABASE UTILISÉES

```
printers        : id, slug, name, owner_phone, created_at
subscriptions   : id, printer_id, activation_code, activated_at, expires_at, 
                  duration_days, amount, payment_method, status, created_at
```

---

## FICHIER 1 — `admin/js/supabase-client.js`

```js
const SUPABASE_URL = 'REMPLACER_PAR_TON_URL';
const SUPABASE_ANON_KEY = 'REMPLACER_PAR_TA_CLE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

---

## FICHIER 2 — `admin/js/auth.js`

```js
// Login avec email + mot de passe Supabase Auth
async function adminLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function adminLogout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Guard — redirige vers login si pas connecté
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

// Sur la page login — redirige si déjà connecté
async function redirectIfAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) window.location.href = 'dashboard.html';
}
```

---

## FICHIER 3 — `admin/index.html` (page login)

Design sobre vert foncé (#1e4d2b) + jaune (#f5c842) comme DerewolPrint.

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Derewol Admin</title>
  <link rel="stylesheet" href="css/admin.css">
</head>
<body class="login-page">
  <div class="login-box">
    <div class="login-logo">
      <div class="logo-mark"></div>
      <span class="logo-text">Derew<b>ol</b> <span class="admin-label">Admin</span></span>
    </div>
    <h2>Connexion</h2>
    <div id="login-error" class="error-msg" style="display:none"></div>
    <input type="email" id="login-email" placeholder="Email admin" autocomplete="email" />
    <input type="password" id="login-password" placeholder="Mot de passe" autocomplete="current-password" />
    <button id="login-btn" class="btn-primary">
      <span id="login-label">Se connecter</span>
    </button>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="js/supabase-client.js"></script>
  <script src="js/auth.js"></script>
  <script>
    redirectIfAuth();
    document.getElementById('login-btn').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const btn = document.getElementById('login-btn');
      const errorEl = document.getElementById('login-error');
      
      btn.disabled = true;
      document.getElementById('login-label').textContent = 'Connexion...';
      errorEl.style.display = 'none';
      
      try {
        await adminLogin(email, password);
        window.location.href = 'dashboard.html';
      } catch (err) {
        errorEl.textContent = 'Email ou mot de passe incorrect';
        errorEl.style.display = 'block';
        btn.disabled = false;
        document.getElementById('login-label').textContent = 'Se connecter';
      }
    });

    // Enter key
    document.getElementById('login-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-btn').click();
    });
  </script>
</body>
</html>
```

---

## FICHIER 4 — `admin/dashboard.html` (page principale)

Structure avec sidebar + main content. 4 sections :
- Vue d'ensemble (stats)
- Imprimeurs (liste)
- Abonnements (liste + générer code)
- Générer code (modal)

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Derewol Admin — Dashboard</title>
  <link rel="stylesheet" href="css/admin.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
<body class="dashboard-page">

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="logo-mark"></div>
      <span class="logo-text">Derew<b>ol</b></span>
    </div>
    <nav class="sidebar-nav">
      <button class="nav-item active" data-view="overview">
        <i class="fa-solid fa-chart-line"></i> Vue d'ensemble
      </button>
      <button class="nav-item" data-view="printers">
        <i class="fa-solid fa-print"></i> Imprimeurs
      </button>
      <button class="nav-item" data-view="subscriptions">
        <i class="fa-solid fa-credit-card"></i> Abonnements
      </button>
    </nav>
    <button class="btn-logout" id="logout-btn">
      <i class="fa-solid fa-right-from-bracket"></i> Déconnexion
    </button>
  </aside>

  <!-- Main -->
  <main class="main-content">

    <!-- Vue d'ensemble -->
    <section id="view-overview" class="view active">
      <h1>Vue d'ensemble</h1>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon"><i class="fa-solid fa-print"></i></div>
          <div class="stat-value" id="stat-total-printers">—</div>
          <div class="stat-label">Imprimeurs total</div>
        </div>
        <div class="stat-card active">
          <div class="stat-icon"><i class="fa-solid fa-circle-check"></i></div>
          <div class="stat-value" id="stat-active-subs">—</div>
          <div class="stat-label">Abonnements actifs</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-icon"><i class="fa-solid fa-clock"></i></div>
          <div class="stat-value" id="stat-expiring-soon">—</div>
          <div class="stat-label">Expirent dans 7j</div>
        </div>
        <div class="stat-card revenue">
          <div class="stat-icon"><i class="fa-solid fa-money-bill-wave"></i></div>
          <div class="stat-value" id="stat-revenue">—</div>
          <div class="stat-label">Revenus ce mois (FCFA)</div>
        </div>
      </div>

      <!-- Abonnements qui expirent bientôt -->
      <div class="section-card">
        <h2><i class="fa-solid fa-triangle-exclamation"></i> Expirent bientôt</h2>
        <div id="expiring-list"><div class="loading">Chargement...</div></div>
      </div>
    </section>

    <!-- Imprimeurs -->
    <section id="view-printers" class="view">
      <div class="view-header">
        <h1>Imprimeurs <span class="count-badge" id="printers-count">0</span></h1>
        <input type="text" id="printers-search" placeholder="Rechercher..." class="search-input" />
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Boutique</th>
              <th>Slug</th>
              <th>Téléphone</th>
              <th>Inscrit le</th>
              <th>Abonnement</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="printers-tbody">
            <tr><td colspan="6" class="loading">Chargement...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Abonnements -->
    <section id="view-subscriptions" class="view">
      <div class="view-header">
        <h1>Abonnements</h1>
        <button class="btn-primary" id="btn-gen-code">
          <i class="fa-solid fa-plus"></i> Générer un code
        </button>
      </div>

      <!-- Filtres -->
      <div class="filters">
        <button class="filter-btn active" data-filter="all">Tous</button>
        <button class="filter-btn" data-filter="active">Actifs</button>
        <button class="filter-btn" data-filter="pending">En attente</button>
        <button class="filter-btn" data-filter="expired">Expirés</button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Imprimeur</th>
              <th>Méthode</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Activé le</th>
              <th>Expire le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="subscriptions-tbody">
            <tr><td colspan="8" class="loading">Chargement...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

  </main>

  <!-- Modal générer code -->
  <div id="modal-gen-code" class="modal" style="display:none">
    <div class="modal-backdrop"></div>
    <div class="modal-box">
      <h2><i class="fa-solid fa-key"></i> Générer un code d'activation</h2>
      
      <div class="form-group">
        <label>Imprimeur (optionnel)</label>
        <select id="gen-printer-id">
          <option value="">— Tous les imprimeurs —</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Méthode de paiement</label>
        <select id="gen-payment-method">
          <option value="wave">Wave</option>
          <option value="orange_money">Orange Money</option>
          <option value="manual">Manuel</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Durée (jours)</label>
        <input type="number" id="gen-duration" value="30" min="1" max="365" />
      </div>

      <div class="form-group">
        <label>Montant (FCFA)</label>
        <input type="number" id="gen-amount" value="4000" min="0" />
      </div>

      <!-- Code généré -->
      <div id="gen-result" style="display:none" class="gen-result">
        <div class="gen-code-display">
          <span id="gen-code-value"></span>
          <button id="gen-copy-btn" title="Copier">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
        <p class="gen-code-hint">Envoyez ce code à l'imprimeur par SMS ou WhatsApp</p>
        <!-- Bouton WhatsApp -->
        <a id="gen-whatsapp-btn" href="#" target="_blank" class="btn-whatsapp">
          <i class="fa-brands fa-whatsapp"></i> Envoyer via WhatsApp
        </a>
      </div>

      <div id="gen-error" class="error-msg" style="display:none"></div>

      <div class="modal-actions">
        <button id="gen-submit-btn" class="btn-primary">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Générer
        </button>
        <button id="gen-close-btn" class="btn-secondary">Fermer</button>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="js/supabase-client.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/printers.js"></script>
  <script src="js/subscriptions.js"></script>
  <script src="js/dashboard.js"></script>
</body>
</html>
```

---

## FICHIER 5 — `admin/js/subscriptions.js`

```js
// Génère un code unique format DW-XXXX-XXXX-XXXX
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `DW-${rand(4)}-${rand(4)}-${rand(4)}`;
}

// Insère un nouveau code dans Supabase
async function createActivationCode({ printerId, paymentMethod, durationDays, amount }) {
  const code = generateCode();
  
  const { data, error } = await sb
    .from('subscriptions')
    .insert({
      printer_id:      printerId || null,
      activation_code: code,
      payment_method:  paymentMethod,
      duration_days:   durationDays,
      amount:          amount,
      status:          'pending',
    })
    .select()
    .single();
  
  if (error) throw error;
  return { ...data, activation_code: code };
}

// Fetch tous les abonnements avec info imprimeur
async function fetchSubscriptions(filter = 'all') {
  let query = sb
    .from('subscriptions')
    .select(`*, printers(name, slug)`)
    .order('created_at', { ascending: false });
  
  if (filter !== 'all') query = query.eq('status', filter);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Révoquer un abonnement actif
async function revokeSubscription(id) {
  const { error } = await sb
    .from('subscriptions')
    .update({ status: 'expired' })
    .eq('id', id);
  if (error) throw error;
}

// Stats abonnements
async function fetchSubStats() {
  const now = new Date().toISOString();
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [active, expiring, revenue] = await Promise.all([
    sb.from('subscriptions').select('id', {count: 'exact'}).eq('status', 'active').gt('expires_at', now),
    sb.from('subscriptions').select('id', {count: 'exact'}).eq('status', 'active').gt('expires_at', now).lt('expires_at', in7days),
    sb.from('subscriptions').select('amount').eq('status', 'active').gte('activated_at', monthStart),
  ]);

  const totalRevenue = (revenue.data || []).reduce((s, r) => s + (r.amount || 0), 0);

  return {
    active: active.count || 0,
    expiring: expiring.count || 0,
    revenue: totalRevenue,
  };
}
```

---

## FICHIER 6 — `admin/js/printers.js`

```js
async function fetchPrinters(search = '') {
  let query = sb
    .from('printers')
    .select(`
      id, slug, name, owner_phone, created_at,
      subscriptions(status, expires_at, activation_code)
    `)
    .order('created_at', { ascending: false });
  
  if (search) query = query.ilike('name', `%${search}%`);
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function getPrinterSubStatus(printer) {
  const subs = printer.subscriptions || [];
  const active = subs.find(s => s.status === 'active' && new Date(s.expires_at) > new Date());
  if (active) {
    const days = Math.ceil((new Date(active.expires_at) - new Date()) / 86400000);
    return { label: `Actif · ${days}j`, cls: 'badge-active' };
  }
  const pending = subs.find(s => s.status === 'pending');
  if (pending) return { label: 'Code généré', cls: 'badge-pending' };
  return { label: 'Expiré', cls: 'badge-expired' };
}
```

---

## FICHIER 7 — `admin/js/dashboard.js`

```js
document.addEventListener('DOMContentLoaded', async () => {
  // Auth guard
  const session = await requireAuth();
  if (!session) return;

  // Logout
  document.getElementById('logout-btn').addEventListener('click', adminLogout);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
      loadView(btn.dataset.view);
    });
  });

  // Charge la vue initiale
  loadView('overview');

  // Modal générer code
  document.getElementById('btn-gen-code').addEventListener('click', openGenModal);
  document.getElementById('gen-close-btn').addEventListener('click', closeGenModal);
  document.getElementById('gen-submit-btn').addEventListener('click', handleGenCode);
  document.getElementById('gen-copy-btn')?.addEventListener('click', () => {
    const code = document.getElementById('gen-code-value').textContent;
    navigator.clipboard.writeText(code);
    document.getElementById('gen-copy-btn').innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => document.getElementById('gen-copy-btn').innerHTML = '<i class="fa-regular fa-copy"></i>', 2000);
  });

  // Filtres abonnements
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSubscriptions(btn.dataset.filter);
    });
  });

  // Recherche imprimeurs
  let searchTimer;
  document.getElementById('printers-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadPrinters(e.target.value), 300);
  });
});

async function loadView(view) {
  if (view === 'overview') await loadOverview();
  if (view === 'printers') await loadPrinters();
  if (view === 'subscriptions') await loadSubscriptions();
}

async function loadOverview() {
  try {
    const [printersData, stats] = await Promise.all([
      fetchPrinters(),
      fetchSubStats(),
    ]);
    
    document.getElementById('stat-total-printers').textContent = printersData.length;
    document.getElementById('stat-active-subs').textContent = stats.active;
    document.getElementById('stat-expiring-soon').textContent = stats.expiring;
    document.getElementById('stat-revenue').textContent = stats.revenue.toLocaleString('fr-FR');

    // Liste expirant bientôt
    const subs = await fetchSubscriptions('active');
    const expiring = subs.filter(s => {
      const days = Math.ceil((new Date(s.expires_at) - new Date()) / 86400000);
      return days <= 7 && days > 0;
    });

    const list = document.getElementById('expiring-list');
    if (expiring.length === 0) {
      list.innerHTML = '<p class="empty-state">Aucun abonnement n\'expire dans les 7 prochains jours</p>';
    } else {
      list.innerHTML = expiring.map(s => {
        const days = Math.ceil((new Date(s.expires_at) - new Date()) / 86400000);
        const phone = s.printers?.owner_phone || '—';
        return `
          <div class="expiring-row">
            <div>
              <strong>${s.printers?.name || '—'}</strong>
              <span class="text-muted">${s.printers?.slug || ''}</span>
            </div>
            <div class="expiring-meta">
              <span class="badge badge-warning">${days} jour${days > 1 ? 's' : ''}</span>
              <a href="https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Bonjour, votre abonnement Derewol expire dans ${days} jour(s). Renouvelez pour continuer.`)}" 
                 target="_blank" class="btn-whatsapp-sm">
                <i class="fa-brands fa-whatsapp"></i> Relancer
              </a>
            </div>
          </div>`;
      }).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadPrinters(search = '') {
  const tbody = document.getElementById('printers-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Chargement...</td></tr>';
  
  try {
    const data = await fetchPrinters(search);
    document.getElementById('printers-count').textContent = data.length;
    
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun imprimeur</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.map(p => {
      const sub = getPrinterSubStatus(p);
      const phone = p.owner_phone || '—';
      return `
        <tr>
          <td><strong>${p.name}</strong></td>
          <td><code>${p.slug}</code></td>
          <td>${phone}</td>
          <td>${new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
          <td><span class="badge ${sub.cls}">${sub.label}</span></td>
          <td>
            <button class="btn-action" onclick="openGenModalForPrinter('${p.id}', '${p.name}')">
              <i class="fa-solid fa-key"></i> Générer code
            </button>
            ${phone !== '—' ? `
            <a href="https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Bonjour ${p.name}, votre code Derewol :`)}" 
               target="_blank" class="btn-action">
              <i class="fa-brands fa-whatsapp"></i>
            </a>` : ''}
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="error-msg">${err.message}</td></tr>`;
  }
}

async function loadSubscriptions(filter = 'all') {
  const tbody = document.getElementById('subscriptions-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="loading">Chargement...</td></tr>';
  
  try {
    const data = await fetchSubscriptions(filter);
    
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Aucun abonnement</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.map(s => {
      const statusBadge = {
        active:  '<span class="badge badge-active">Actif</span>',
        pending: '<span class="badge badge-pending">En attente</span>',
        expired: '<span class="badge badge-expired">Expiré</span>',
      }[s.status] || s.status;
      
      const methodLabel = { wave: '🔵 Wave', orange_money: '🟠 Orange Money', manual: '✋ Manuel' }[s.payment_method] || s.payment_method;
      
      return `
        <tr>
          <td><code class="code-cell">${s.activation_code}</code>
            <button onclick="copyCode('${s.activation_code}')" class="btn-icon" title="Copier">
              <i class="fa-regular fa-copy"></i>
            </button>
          </td>
          <td>${s.printers?.name || '<em>Non assigné</em>'}</td>
          <td>${methodLabel}</td>
          <td>${s.amount?.toLocaleString('fr-FR')} FCFA</td>
          <td>${statusBadge}</td>
          <td>${s.activated_at ? new Date(s.activated_at).toLocaleDateString('fr-FR') : '—'}</td>
          <td>${s.expires_at ? new Date(s.expires_at).toLocaleDateString('fr-FR') : '—'}</td>
          <td>
            ${s.status === 'active' ? `
            <button class="btn-action btn-danger" onclick="handleRevoke('${s.id}')">
              <i class="fa-solid fa-ban"></i> Révoquer
            </button>` : ''}
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="error-msg">${err.message}</td></tr>`;
  }
}

// Modal
async function openGenModal() {
  document.getElementById('modal-gen-code').style.display = 'flex';
  document.getElementById('gen-result').style.display = 'none';
  document.getElementById('gen-error').style.display = 'none';
  
  // Charge la liste des imprimeurs dans le select
  const printers = await fetchPrinters();
  const select = document.getElementById('gen-printer-id');
  select.innerHTML = '<option value="">— Tous les imprimeurs —</option>' +
    printers.map(p => `<option value="${p.id}">${p.name} (${p.slug})</option>`).join('');
}

function openGenModalForPrinter(id, name) {
  openGenModal().then(() => {
    document.getElementById('gen-printer-id').value = id;
  });
}

function closeGenModal() {
  document.getElementById('modal-gen-code').style.display = 'none';
}

async function handleGenCode() {
  const printerId = document.getElementById('gen-printer-id').value || null;
  const paymentMethod = document.getElementById('gen-payment-method').value;
  const durationDays = parseInt(document.getElementById('gen-duration').value);
  const amount = parseInt(document.getElementById('gen-amount').value);
  const btn = document.getElementById('gen-submit-btn');
  const errorEl = document.getElementById('gen-error');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération...';
  errorEl.style.display = 'none';
  
  try {
    const result = await createActivationCode({ printerId, paymentMethod, durationDays, amount });
    
    document.getElementById('gen-result').style.display = 'block';
    document.getElementById('gen-code-value').textContent = result.activation_code;
    
    // Lien WhatsApp
    const printer = printerId 
      ? (await fetchPrinters()).find(p => p.id === printerId)
      : null;
    const phone = printer?.owner_phone?.replace(/\D/g, '') || '';
    const msg = encodeURIComponent(`Votre code d'activation Derewol :\n*${result.activation_code}*\nValable ${durationDays} jours.\nEntrez-le dans DerewolPrint > Paramètres > Abonnement.`);
    document.getElementById('gen-whatsapp-btn').href = phone 
      ? `https://wa.me/${phone}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    
    // Recharge la liste
    loadSubscriptions();
    
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer';
  }
}

function copyCode(code) {
  navigator.clipboard.writeText(code);
}

async function handleRevoke(id) {
  if (!confirm('Révoquer cet abonnement ?')) return;
  await revokeSubscription(id);
  loadSubscriptions(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
  loadOverview();
}
```

---

## FICHIER 8 — `admin/css/admin.css`

Design DerewolPrint : vert foncé #1e4d2b, jaune #f5c842, fond clair #faf8f2.
Inclure :
- Page login centrée, card blanche, logo en haut
- Layout dashboard : sidebar fixe 220px + main scrollable
- Stats grid 4 colonnes responsive
- Tables avec hover, badges colorés
- Modal overlay
- Boutons : btn-primary (vert), btn-secondary (gris), btn-danger (rouge), btn-whatsapp (vert WhatsApp #25D366)
- Badges : badge-active (vert), badge-pending (jaune), badge-expired (gris), badge-warning (orange)
- Code cells : font monospace, background léger
- Responsive mobile (sidebar collapse)

---

## FICHIER 9 — `admin/.htaccess`

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
Options -Indexes
```

---

## OUTPUT
Fichiers complets séparés par `---FILE: admin/chemin/fichier---`
Commencer par le SQL, puis les fichiers dans l'ordre ci-dessus.