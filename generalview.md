# 📊 DEREWOL — État complet du projet (12/04/2026)

## 🗂️ Structure actuelle

### Répertoires PWA (Next.js)

```
pages/
  ├─ _app.js (Redux/Context setup)
  ├─ _document.js (HTML structure)
  ├─ index.js (Landing page)
  ├─ dashboard.js (Affichage jobs pour admins)
  ├─ upload.js (Alternative upload)
  └─ p/
     └─ index.js ✅ CORRIGÉ - PWA printer slug SPA (180 lignes)

components/
  └─ Logo.js (Component réutilisable)

lib/
  ├─ helpers.js (Session/Auth utilitaires)
  ├─ i18n.js (i18n setup)
  └─ supabase.js (Client Supabase)

styles/
  ├─ globals.css (Base styling)
  ├─ dashboard.css
  └─ modal.css
```

### Répertoires DerewolPrint (Electron)

```
derewolprint/
  ├─ package.json (npm scripts)
  ├─ BLUETOOTH-*.md (6 fichiers Bluetooth docs)
  ├─ config.json (Configuration)
  ├─ main/
  │  └─ main.js ✅ IPC handlers, polling initiation
  ├─ preload/
  │  └─ preload.js ✅ Bridge contextIsolation
  ├─ renderer/
  │  ├─ index.html 🔄 RESTAURÉ (modal structure)
  │  ├─ renderer.js 🔄 RESTAURÉ (event handlers)
  │  ├─ renderer.css 🔄 RESTAURÉ (styling)
  │  ├─ setup.html (Onboarding UI)
  │  ├─ i18n.js (Traductions Electron)
  │  └─ js/
  │     ├─ bridge/
  │     │  └─ derewolBridge.js ✅ MODIFIÉ - Polling bridge + heartbeat
  │     ├─ state/
  │     │  └─ jobStore.js ✅ (État centralisé jobs)
  │     └─ ui/
  │        └─ renderJobs.js ✅ (DOM rendering)
  ├─ services/
  │  ├─ polling.js ✅ MODIFIÉ - Intervalle 1s default + restartPolling()
  │  ├─ supabase.js (Client Supabase)
  │  ├─ subscription.js (Gestion abonnement)
  │  ├─ printer.js (Print handlers)
  │  ├─ printerConfig.js (Config locale)
  │  ├─ converter.js (PDF handling)
  │  ├─ crypto.js (Encryption)
  │  ├─ logger.js (Logging)
  │  └─ printer.js (Print queue)
  ├─ scripts/
  │  └─ clean-dist.js
  └─ assets/
     ├─ icons/ (mac, png, win)
     └─ README.md
```

---

## ✅ Fichiers CORRIGÉS cette session

### PWA (pages/p/index.js)

✅ **CORRIGÉ** - Erreurs d'échappement inutiles

- `"Rejeté par l'imprimeur"` (au lieu de `l'\'\'imprimeur`)
- `"Ce QR code n'est plus valide."`
- `"En attente de l'imprimeur"`
- `"Erreur lors de l'envoi"`

### DerewolPrint Electron

✅ **restauré depuis Git** renderer/index.html, renderer.css, renderer.js
✅ **Ajouté** modal d'acceptation HTML (UTF-8 correct)
✅ **Polling optimisé** (1s default + heartbeat 5s)
✅ **IPC redémarrage** polling dynamique

---

## ✅ État FINAL après corrections

### PWA (pages/p/index.js)

**Avant**: Erreurs d'échappement inutiles - `l'\'\'imprimeur`
**Après**: ✅ Corrigé - `l'imprimeur` (guillemets simples dans guillemets doubles = pas d'échappement)

**Modifications**:

- Ligne ~48: `rejectedMsg: "Rejeté par l'imprimeur"`
- Ligne ~50: `notFoundDesc: "Ce QR code n'est plus valide."`
- Ligne ~43: `waitingMsg: "En attente de l'imprimeur"`

### DerewolPrint — Services

**polling.js**

```javascript
// AVANT: intervalle 3s par défaut
// APRÈS: intervalle 1s par défaut + capable de redémarrer
function startPolling(onJobsReceived, printerId, intervalMs = 1000)
function restartPolling(newIntervalMs) // Nouvelle fonction
```

**Changements**:

- Variables globales pour stocker contexte (currentCallback, currentPrinterId, currentIntervalMs)
- Premier appel tick() immédiat
- Support redémarrage dynamique

### DerewolPrint — Bridge

**derewolBridge.js**

```javascript
// AVANT: Mise à jour seulement si signature change
// APRÈS: Mise à jour si signature change OU heartbeat 5s
export function initBridge() {
  let lastUpdateTime = 0;

  window.derewol.onJobReceived((jobs) => {
    const currentTime = Date.now();
    const timeSinceUpdate = currentTime - lastUpdateTime;

    // Force update toutes les 5s même sans changement
    if (
      currentSig !== newSig ||
      (formatted.length > 0 && timeSinceUpdate > 5000)
    ) {
      lastUpdateTime = currentTime;
      jobStore.setJobs(formatted);
    }
  });
}
```

### DerewolPrint — IPC

**main.js**

```javascript
// Nouveau IPC handler pour polling interval dynamique
ipcMain.handle("polling:set-interval", async (_, intervalMs) => {
  const { restartPolling } = require("../services/polling");
  restartPolling(Math.max(1000, intervalMs)); // Min 1s
  return { success: true };
});
```

**preload.js**

```javascript
// Nouveau bridge fonction
setPollingInterval: (intervalMs) =>
  ipcRenderer.invoke("polling:set-interval", intervalMs),
```

**renderer.js**

```javascript
// Settings -> Polling restart
document.getElementById("setting-polling").addEventListener("change", (e) => {
  const newInterval = parseInt(e.target.value);
  settings.polling = newInterval;
  saveSettings();

  if (window.derewol?.setPollingInterval) {
    window.derewol.setPollingInterval(newInterval);
  }
});
```

---

## 📊 Fichiers NON MODIFIÉS mais PERTINENTS

### État Supabase

```
Tables :
  ✅ print_jobs (jobs d'impression)
  ✅ file_groups (groupes de fichiers)
  ✅ files (fichiers individuels)
  ✅ printers (configuration imprimantes)
  ✅ subscriptions (status abonnement)
  ❌ users (TABLE VIDE - données client perdues!)
     └─ Note: Les données clients sont maintenant dans anon_sessions?
```

### Fichiers Origines (Non touchés)

- `lib/supabase.js` - Client Supabase
- `lib/helpers.js` - Session management
- `services/subscription.js` - Logique abonnement
- `services/printer.js` - Print queue
- `pages/dashboard.js` - Admin dashboard
- Tous les fichiers de configuration

---

## 🔄 Logique actuelle implémentée

### 1️⃣ Flow PWA (Derewol SPA — pages/p/index.js)

```
User scans QR → /p/{slug}
  ↓
Load printer config + create anon session
  ↓
DROP FILES → SELECT COPIES
  ↓
CLICK "ENVOYER À L'IMPRIMEUR" → createFileGroup + uploadFileToGroup
  ↓
Backend: Supabase insert file_groups + print_jobs
  ↓
Polling Electron détecte nouveau job
```

**Caractéristiques**:

- ✅ Multilingue (FR/EN/WO)
- ✅ Drag-drop PDF
- ✅ Copies per file
- ✅ Real-time progress tracking
- ✅ PDF preview (signed URLs)
- ✅ Session locale (localStorage)

### 2️⃣ Flow DerewolPrint (Electron — derewolprint/)

```
APP BOOT
  ↓
Load printer config
  ↓
Initialize polling (1s interval)
  ↓
POLLING TICK
  ├─ Fetch print_jobs WHERE status='queued'
  ├─ Format into groups (by owner_id)
  ├─ Compare signatures
  ├─ If changed or heartbeat (5s): UPDATE DOM
  └─ If new jobs: PLAY SOUND
  ↓
USER CLICKS "IMPRIMER"
  ├─ Confidence modal
  ├─ Print to physical printer
  ├─ Update status→printing
  ├─ After 2s: clean spooler
  └─ User checks "Terminé"
  ↓
AUTO EXPIRATION
  └─ Jobs > 6h old → status=expired + delete files
```

**Caractéristiques**:

- ✅ Polling toutes les 1s (configurable 5s/10s/30s)
- ✅ jobStore centralisé (état unique)
- ✅ Heartbeat 5s force re-render
- ✅ Multiview (Jobs/History/QR/Settings)
- ✅ Sound notification + visual indicators
- ✅ Auto-renewal subscription check
- ✅ Print job logging

### 3️⃣ Modal d'acceptation (PENDING - À IMPLÉMENTER)

```
STATE: HTML restored ✅ CSS restored ✅ JS functions exist ✅
ISSUE: Needs re-implementation without UTF-8 corruption

FLOW:
  User clicks "Démarrer mon essai"
    ↓
  hideActivationModal()
    ↓
  showAcceptanceModal("trial")
    ├─ Fetch backdrop element
    ├─ Add "show" class → display: flex
    ├─ Show trial section
    └─ Bind accept button
    ↓
  User clicks "J'accepte"
    ├─ activateTrial() → IPC to main process
    ├─ Main: checkSubscription + DB update
    ├─ renderer.js: reload page
    ↓
  Modal disappears, app refreshed with trial active
```

---

## ⚠️ PROBLÈMES IDENTIFIÉS

### 1. UTF-8 Corruption (RÉCURRENT)

- ❌ Fichiers écrits avec PowerShell encode en UTF-16
- ❌ Caractères accentués → `Ã©` au lieu de `é`
- ❌ Caractères Unicode → `â€¢` au lieu de `•`
- ✅ **Solution**: Toujours restaurer via `git checkout` avant modification

### 2. Modal d'acceptation (INVISIBLE)

- ❌ HTML/CSS/JS existent mais modal n'apparaît pas
- ❌ Probablement: z-index conflict ou backdrop ne peut pas être sélectionnéé
- ⚠️ **À faire**: Re-implémenter en contrôlant l'encodage UTF-8

### 3. Table users vide

- ❌ Données utilisateurs perdues
- ❌ Clients seulement dans sessions temporaires
- ⚠️ **Analyse**: Où les données utilisateurs vont-elles?
  - Via `createAnonymousSession()` → localStorage
  - Pas de persistance DB pour sessions anonymes

### 4. Supabase sync manuellement

- ✅ Polling maintenant chaque 1s (OK)
- ✅ Heartbeat 5s force re-render (OK)
- ⚠️ **Possible amélioration**: Supabase realtime subscriptions au lieu de polling

---

## 🎯 NEXT STEPS

### Priorité 1: Modal d'acceptation

- [ ] Restaurer/re-créer le modal HTML avec UTF-8 proper encoding
- [ ] Vérifier CSS backdrop z-index ne conflicte pas
- [ ] Tester affichage dans DevTools
- [ ] Vérifier acceptation → trial activation

### Priorité 2: Analyse Supabase data

- [ ] Investiguer table `users` vide
- [ ] Vérifier où les données clients persistantes vont
- [ ] Créer migration pour restaurer/synchroniser users

### Priorité 3: Production readiness

- [ ] Build et deploy PWA
- [ ] Package Electron app final
- [ ] Tester full flow: QR → Upload → Print → Expiration
- [ ] S'assurer UTF-8 encoding correct everywhere

---

## 🔧 OUTILS & COMMANDES

### Build & Run

```bash
# PWA
cd d:\workspace\Derewol
npm run build
npm start

# Electron
cd derewolprint
npm run build
npm start
```

### Git Recovery

```bash
git checkout HEAD -- renderer/index.html renderer/renderer.css renderer/renderer.js
```

### Polling Test

```javascript
// Console DevTools Electron
window.derewol.setPollingInterval(1000); // Change to 1s
// Watch console for [POLLING] logs
```

---

**Dernière mise à jour**: 12/04/2026  
**Statut**: 🟡 EN COURS (Modal pending, UTF-8 fixed, Polling optimized)
