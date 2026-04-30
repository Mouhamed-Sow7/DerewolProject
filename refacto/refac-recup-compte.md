Voici les 4 fichiers à modifier/créer :

1. services/recovery.js — nouveau fichier
   javascript// services/recovery.js
   const nodemailer = require('nodemailer');
   const { createClient } = require('@supabase/supabase-js');
   const path = require('path');
   const fs = require('fs');

function getSupabaseClient() {
const configPath = path.join(\_\_dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
return createClient(config.supabaseUrl, config.supabaseKey);
}

const transporter = nodemailer.createTransport({
service: 'gmail',
auth: {
user: 'derewolprint@gmail.com',
pass: process.env.GMAIL_APP_PASSWORD || 'METS_TON_NOUVEAU_MOT_DE_PASSE_ICI',
},
});

function generateCode() {
return Math.floor(100000 + Math.random() \* 900000).toString();
}

async function requestRecovery(emailOrPhone) {
const supabase = getSupabaseClient();
const isEmail = emailOrPhone.includes('@');

// 1. Cherche l'imprimeur
const field = isEmail ? 'email' : 'phone';
const { data: printer, error } = await supabase
.from('printers')
.select('id, email, phone, slug')
.eq(field, emailOrPhone)
.single();

if (error || !printer) {
throw new Error('Aucun compte trouvé avec cet email ou téléphone.');
}

// 2. Génère le code
const code = generateCode();
const expiresAt = new Date(Date.now() + 30 _ 60 _ 1000).toISOString(); // 30 min

// 3. Insert dans recovery_requests
const { error: insertError } = await supabase
.from('recovery_requests')
.insert({
printer_id: printer.id,
email: printer.email || null,
phone: printer.phone || null,
code,
expires_at: expiresAt,
used: false,
});

if (insertError) throw new Error('Erreur création requête: ' + insertError.message);

// 4. Envoie email
if (isEmail) {
await transporter.sendMail({
from: '"DerewolPrint" <derewolprint@gmail.com>',
to: printer.email,
subject: 'Ton code de récupération DerewolPrint',
html: `         <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
          <h2 style="color: #1a1a2e;">🖨️ DerewolPrint</h2>
          <p>Voici ton code de récupération :</p>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; 
                      color: #6c63ff; text-align: center; padding: 20px; 
                      background: #f4f4ff; border-radius: 8px;">
            ${code}
          </div>
          <p style="color: #888; font-size: 13px; margin-top: 16px;">
            Ce code expire dans 30 minutes. Si tu n'as pas demandé ceci, ignore cet email.
          </p>
        </div>
      `,
});
}

// WhatsApp → à brancher plus tard (Twilio etc.)
// if (!isEmail) { await sendWhatsApp(printer.phone, code); }

return { success: true, method: isEmail ? 'email' : 'phone' };
}

async function verifyRecovery(emailOrPhone, code) {
const supabase = getSupabaseClient();
const isEmail = emailOrPhone.includes('@');
const field = isEmail ? 'email' : 'phone';

// 1. Cherche le code valide
const { data: requests, error } = await supabase
.from('recovery_requests')
.select('\*')
.eq(field, emailOrPhone)
.eq('code', code)
.eq('used', false)
.gt('expires_at', new Date().toISOString())
.order('created_at', { ascending: false })
.limit(1);

if (error || !requests || requests.length === 0) {
throw new Error('Code invalide ou expiré.');
}

const request = requests[0];

// 2. Marque comme utilisé
await supabase
.from('recovery_requests')
.update({ used: true })
.eq('id', request.id);

// 3. Charge les infos du printer
const { data: printer } = await supabase
.from('printers')
.select('\*')
.eq('id', request.printer_id)
.single();

if (!printer) throw new Error('Compte introuvable.');

return { success: true, printer };
}

module.exports = { requestRecovery, verifyRecovery };

2. main/main.js — ajoute les 2 handlers IPC
   Trouve la section avec tes autres ipcMain.handle(...) et ajoute :
   javascriptconst { requestRecovery, verifyRecovery } = require('../services/recovery');

// ── RECOVERY ──────────────────────────────────────────────
ipcMain.handle('recovery:request', async (\_, emailOrPhone) => {
try {
const result = await requestRecovery(emailOrPhone);
return { success: true, method: result.method };
} catch (err) {
return { success: false, error: err.message };
}
});

ipcMain.handle('recovery:verify', async (\_, { emailOrPhone, code }) => {
try {
const { printer } = await verifyRecovery(emailOrPhone, code);

    // Sauvegarde la config localement
    const { saveConfig } = require('../services/printerConfig');
    await saveConfig({
      printerId: printer.id,
      slug: printer.slug,
      email: printer.email,
      phone: printer.phone,
      setupDone: true,
    });

    return { success: true, printer };

} catch (err) {
return { success: false, error: err.message };
}
});

3. preload/preload.js — expose les 2 handlers
   Ajoute dans ton contextBridge.exposeInMainWorld(...) :
   javascriptrecovery: {
   request: (emailOrPhone) => ipcRenderer.invoke('recovery:request', emailOrPhone),
   verify: (data) => ipcRenderer.invoke('recovery:verify', data),
   },

4. renderer/setup.html — le panel recovery
Ajoute ce bloc juste avant la balise </body> :
html<!-- Lien déclencheur -->
<div style="text-align:center; margin-top: 24px;">
  <button id="openRecovery" style="background:none; border:none; color:#6c63ff; 
    cursor:pointer; font-size:13px; text-decoration:underline;">
    ? Récupérer mon compte
  </button>
</div>

<!-- Panel recovery -->
<div id="recoveryPanel" style="display:none; margin-top:24px; 
  background:#1e1e2e; border-radius:12px; padding:24px;">
  
  <h3 style="color:#fff; margin:0 0 16px;">🔑 Récupérer mon compte</h3>

  <!-- Étape 1 : saisie email/phone -->
  <div id="step1">
    <input id="recoveryInput" type="text" 
      placeholder="Ton email ou téléphone"
      style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid #444;
             background:#2a2a3e; color:#fff; font-size:14px; box-sizing:border-box;" />
    <button id="sendCodeBtn" style="margin-top:12px; width:100%; padding:11px;
      background:#6c63ff; color:#fff; border:none; border-radius:8px; 
      font-size:14px; cursor:pointer;">
      Envoyer le code
    </button>
    <p id="step1Error" style="color:#ff6b6b; font-size:13px; margin-top:8px; display:none;"></p>
  </div>

  <!-- Étape 2 : saisie code -->
  <div id="step2" style="display:none;">
    <p style="color:#aaa; font-size:13px; margin:0 0 12px;" id="step2Info"></p>
    <input id="codeInput" type="text" maxlength="6"
      placeholder="Code à 6 chiffres"
      style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid #444;
             background:#2a2a3e; color:#fff; font-size:20px; letter-spacing:6px;
             text-align:center; box-sizing:border-box;" />
    <button id="verifyCodeBtn" style="margin-top:12px; width:100%; padding:11px;
      background:#6c63ff; color:#fff; border:none; border-radius:8px;
      font-size:14px; cursor:pointer;">
      Valider le code
    </button>
    <p id="step2Error" style="color:#ff6b6b; font-size:13px; margin-top:8px; display:none;"></p>
    <button id="backBtn" style="margin-top:8px; width:100%; padding:8px;
      background:none; color:#888; border:1px solid #444; border-radius:8px;
      font-size:13px; cursor:pointer;">
      ← Changer d'email/téléphone
    </button>
  </div>

  <!-- Étape 3 : succès -->
  <div id="step3" style="display:none; text-align:center;">
    <div style="font-size:48px;">✅</div>
    <p style="color:#fff; font-size:16px; font-weight:bold;">Compte restauré !</p>
    <p style="color:#aaa; font-size:13px;">L'application redémarre...</p>
  </div>
</div>

<script>
  const recoveryInput = document.getElementById('recoveryInput');
  const codeInput = document.getElementById('codeInput');
  let currentEmailOrPhone = '';

  document.getElementById('openRecovery').addEventListener('click', () => {
    const panel = document.getElementById('recoveryPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('sendCodeBtn').addEventListener('click', async () => {
    const val = recoveryInput.value.trim();
    if (!val) return;
    const btn = document.getElementById('sendCodeBtn');
    const errEl = document.getElementById('step1Error');
    btn.disabled = true;
    btn.textContent = 'Envoi...';
    errEl.style.display = 'none';

    const res = await window.derewol.recovery.request(val);

    if (res.success) {
      currentEmailOrPhone = val;
      document.getElementById('step2Info').textContent =
        res.method === 'email'
          ? `Code envoyé à ${val} — vérifie ta boîte mail.`
          : `Code envoyé par WhatsApp au ${val}.`;
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'block';
    } else {
      errEl.textContent = res.error;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Envoyer le code';
    }
  });

  document.getElementById('verifyCodeBtn').addEventListener('click', async () => {
    const code = codeInput.value.trim();
    if (code.length !== 6) return;
    const btn = document.getElementById('verifyCodeBtn');
    const errEl = document.getElementById('step2Error');
    btn.disabled = true;
    btn.textContent = 'Vérification...';
    errEl.style.display = 'none';

    const res = await window.derewol.recovery.verify({
      emailOrPhone: currentEmailOrPhone,
      code,
    });

    if (res.success) {
      document.getElementById('step2').style.display = 'none';
      document.getElementById('step3').style.display = 'block';
      // Redémarre automatiquement après 2s
      setTimeout(() => {
        window.derewol.app.relaunch(); // ou ipcRenderer.invoke('app:relaunch')
      }, 2000);
    } else {
      errEl.textContent = res.error;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Valider le code';
    }
  });

  document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step1').style.display = 'block';
    codeInput.value = '';
  });
</script>

5. Handler app:relaunch dans main.js
   javascriptipcMain.handle('app:relaunch', () => {
   app.relaunch();
   app.exit(0);
   });
   Et dans preload.js :
   javascriptapp: {
   relaunch: () => ipcRenderer.invoke('app:relaunch'),
   },
