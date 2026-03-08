# 📋 Rapport d'Architecture — Derewol

**Date** : 27 février 2026  
**Type de projet** : Application hybride desktop/PWA de gestion d'impression en temps réel  
**Technologies** : Next.js 13.5.2 + React 18.2.0 + Electron 40.4.1 + Supabase

---

## 📐 Architecture générale

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT LAYER (2 interfaces)                                │
├──────────────────────────┬──────────────────────────────────┤
│  PWA (Next.js browser)   │  Desktop (Electron)              │
├──────────────────────────┼──────────────────────────────────┤
│  • Pages: index, upload, │  • Main process (IPC)           │
│    dashboard, status     │  • Preload security bridge      │
│  • Components: réutilis. │  • Renderer (vanilla JS + DOM)  │
│  • Hooks: useSession,    │  • Store pattern (jobStore)     │
│    useUpload             │  • State management              │
└──────────────────────────┴──────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVICE LAYER (Bridge d'accès)                              │
├─────────────────────────────────────────────────────────────┤
│  • Supabase JS client (API REST & Storage)                  │
│  • Polling service (Electron)                               │
│  • IPC handlers (main → renderer)                            │
│  • File encryption/decryption                                │
│  • Logging service                                           │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (Supabase)                                           │
├─────────────────────────────────────────────────────────────┤
│  Tables:                                                     │
│  • users (id, display_id, phone, type, expires_at)         │
│  • file_groups (id, owner_id, status, expires_at)          │
│  • files (id, group_id, file_name, storage_path,           │
│           encrypted_key, file_hash)                         │
│  • print_jobs (id, group_id, status, print_token,          │
│               copies_requested, copies_remaining)           │
│                                                              │
│  Storage:                                                    │
│  • derewol-files bucket (fichiers PDF)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Logique et flux des données

### **Flux utilisateur — PWA (Client)**

```
1. HOME (/index.js)
   └─ Validation téléphone (format Sénégal)
   └─ Création/récupération user via Supabase
   └─ Génération session (localStorage)
   └─ Redirect → UPLOAD

2. UPLOAD (/upload.js)
   └─ useSession() — vérifier session valide
   └─ Sélection fichiers PDF (max 5, max 10MB)
   └─ Sanitization noms fichiers
   └─ Hash SHA-256 des fichiers
   └─ Création file_group dans Supabase
   └─ Upload fichiers dans storage
   └─ Création entries "files" + "print_jobs"
   └─ Redirect → DASHBOARD

3. DASHBOARD (/dashboard.js)
   └─ useSession() — authentification
   └─ usePrintStatus() — polling toutes les 6s
   └─ Récupère file_groups + print_jobs associés
   └─ Affichage grid des jobs avec statut
   └─ Actions : Upload nouveau / Logout
   └─ Section historique (completed/rejected/expired)

4. STATUS (/status.js)
   └─ Page de statut détaillé (rarement utilisée)
   └─ Polling statut spécifique d'un job
```

### **Flux administrateur — Electron (Desktop)**

```
1. APP LAUNCH (derewolprint/main/main.js)
   └─ Nettoyage spooler Windows
   └─ Test connexion Supabase
   └─ Création fenêtre BrowserWindow
   └─ Chargement preload.js (sécurité contextIsolation)
   └─ Chargement renderer/index.html

2. BACKGROUND POLLING (services/polling.js)
   └─ Accès continu Supabase → print_jobs (status='queued')
   └─ Reception job:received event
   └─ Gestion expiration auto (6h)
   └─ Suppression storage expiré

3. RENDERER (derewolprint/renderer/renderer.js)
   └─ jobStore — état centralisé des jobs
   └─ renderJobs() — DOM passif
   └─ derewolBridge — liaison IPC
   └─ Sélection imprimante + copies
   └─ Actions : Imprimer / Rejeter

4. IMPRESSION
   └─ confirmJob → job:confirm IPC
   └─ main.js (printSingleJob):
      ├─ Dowload fichier depuis Storage
      ├─ Déchiffrement AES-256-GCM si nécessaire
      ├─ print_jobs.status = 'printing'
      ├─ Utilise pdf-to-printer (Windows natif)
      ├─ Attend succès système
      └─ file_groups.status = 'completed'

5. REJECTION
   └─ showRejectModal → confirmReject
   └─ job:reject IPC
   └─ file_groups.status = 'rejected'
   └─ Notification client via realtime Supabase
```

### **Cycle de vie d'un job d'impression**

```
┌─ STATES ────────────────────────────────────────┐
│                                                  │
│  waiting ──┐                                    │
│            ├─ queued ──┐                       │
│  (initial) │           ├─ printing ──┐        │
│            │           │             ├─ completed
│            └─ rejected ←┘             │
│                                       └─ failed
│  expired (TTL 6h dépassée)
│
├─ TRANSITIONS ────────────────────────────────── │
│ • upload (client) → file_group:waiting          │
│ • polling détecte → print_job:queued            │
│ • admin sélectionne → print_job:printing        │
│ • succès système → print_job:completed          │
│ • TTL expiration → auto:expired                 │
│ • admin rejette → print_job:rejected            │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 📂 Structure de fichiers utiles (actifs)

### **Racine du projet**
- `package.json` — dépendances (Next.js, React, Supabase, TypeScript)
- `next.config.js` — export statique (PWA)
- `tsconfig.json` — config TypeScript (héritée, peu utilisée)

### **Pages (Next.js) — `/pages`**
```
pages/
├─ _app.js          ✅ App wrapper, toast global, SW registration
├─ index.js         ✅ Accueil — validation téléphone + création user
├─ upload.js        ✅ Upload fichiers → file_groups + storage
├─ dashboard.js     ✅ Tableau de bord — polling statut + actions (183 lignes)
└─ status.js        ⚠️ Page statut (peu utilisée, peut être supprimée)
```

### **Hooks & Context — `/hooks` & `/context`**
```
hooks/
├─ useSession.js        ✅ Hook centralisé — vérif session + redirect
├─ useUpload.js         ✅ Upload logic + sanitization + hash SHA-256
└─ usePrintStatus.js    ✅ Hook polling dédié

context/
└─ SessionContext.js    ❌ NON UTILISÉ (useSession() le remplace)
```

### **Services & Utils — `/lib` & services**
```
lib/
├─ supabase.js          ✅ Client Supabase + createUserIfNotExists()
├─ helpers.js           ✅ Session (load/save), génération IDs, TTL
└─ crypto.js            ❌ NON UTILISÉ (contexte web n'a pas besoin)

derewolprint/services/
├─ supabase.js          ✅ Client Supabase Electron (env variables)
├─ polling.js           ✅ Polling print_jobs + expiration auto
├─ crypto.js            ✅ Déchiffrement AES-256-GCM (Electron only)
├─ printer.js           ✅ Détection imprimantes Windows
└─ logger.js            ✅ Logs JSON → fichier (DerewolLogs/)
```

### **Composants React — `/components`**
```
components/
├─ Header.js             ❌ NON UTILISÉ
├─ Logo.js              ✅ Utilisé dans _app.js et Electron
├─ Button.js            ❌ NON UTILISÉ (boutons inline dans pages)
├─ Toast.js             ❌ REMPLACÉ par Toast inline dans _app.js
├─ Modal.js             ❌ NON UTILISÉ (modale Electron en vanilla JS)
├─ StatusBadge.js       ❌ REMPLACÉ par fonction inline dans dashboard.js
├─ Countdown.js         ❌ NON UTILISÉ
├─ CountdownTimer.js    ❌ NON UTILISÉ
├─ AuthorizeButton.js   ❌ NON UTILISÉ
├─ FilePreviewModal.js  ❌ NON UTILISÉ
├─ FileUploadCard.js    ❌ NON UTILISÉ
└─ IDCard.js            ❌ NON UTILISÉ
```

### **Electron (Derewol Print) — `/derewolprint`**
```
derewolprint/
├─ package.json                 ✅ Dépend Electron + pdf-to-printer
├─ main/main.js                 ✅ Process Electron principal (265 lignes)
├─ preload/preload.js          ✅ Bridge sécurisé (contextIsolation)
├─ renderer/
│  ├─ index.html               ✅ UI Electron
│  ├─ renderer.js              ✅ Logique UI (137 lignes)
│  ├─ renderer.css             ✅ Styles sidebar + jobs widget
│  └─ js/
│     ├─ bridge/derewolBridge.js  ✅ Liaison IPC
│     ├─ state/jobStore.js        ✅ Store centralisé (52 lignes)
│     └─ ui/renderJobs.js         ✅ Rendu dynamique DOM
├─ services/ ← voir section précédente
├─ assets/                      ❌ VIDE
├─ generate-10-jobs.js          ⚠️ Script test (peut être supprimé)
└─ test-job-reject.js           ⚠️ Script test (peut être supprimé)
```

### **Styles — `/styles`**
```
styles/
├─ globals.css          ✅ Reset + variables + tous blocs PWA (322 lignes)
└─ dashboard.css        ✅ Styles dashboard (destiné à être fusionné)
```

### **Public assets — `/public`**
```
public/
├─ sw.js                ✅ Service Worker (Network First + offline)
├─ offline.html         ✅ Page offline fallback
└─ patterns/            ❌ VIDE
```

---

## 🗑️ Fichiers inutiles (supprimables)

### **❌ Composants React jamais importés**
- `components/Header.js` — créé mais jamais utilisé (logo/header inline)
- `components/Button.js` — tous les boutons sont inline/CSS
- `components/Toast.js` — remplacé par Toast inline dans _app.js
- `components/Modal.js` — remplacé par modale Electron vanilla JS
- `components/StatusBadge.js` — remplacé par fonction inline dans dashboard.js
- `components/Countdown.js` — jamais utilisé
- `components/CountdownTimer.js` — jamais utilisé
- `components/AuthorizeButton.js` — jamais utilisé
- `components/FilePreviewModal.js` — jamais utilisé
- `components/FileUploadCard.js` — jamais utilisé
- `components/IDCard.js` — jamais utilisé

**→ À supprimer** : tous les fichiers du répertoire `/components` sauf `Logo.js`

### **❌ Context à supprimer**
- `context/SessionContext.js` — remplacé par hook `useSession()` simple

**Raison** : L'app utilise `useSession()` directement sans context wrapper. SessionContext est un artifact non utilisé.

### **❌ Lib crypto (contexte web)**
- `lib/crypto.js` — aucune importation détectée

**Raison** : La crypto se fait côté Electron (derewolprint/services/crypto.js). La PWA ne chiffre pas.

### **❌ Page status (rarement utilisée)**
- `pages/status.js` — page statut détaillé, flux utilisateur normal utilise dashboard

**Raison** : Peut rester pour future monétisation (statut par lien), mais inactive actuellement.

### **⚠️ Scripts de test Electron**
- `derewolprint/generate-10-jobs.js` (146 lignes)
- `derewolprint/test-job-reject.js` (143 lignes)

**Raison** : Scripts de développement/debugging. À déplacer dans dossier `/tests` si gardés, ou supprimer après finalisation.

### **❌ Dossiers vides**
- `derewolprint/assets/` — totalement vide
- `public/patterns/` — vide

**→ À supprimer**

### **ℹ️ Fichiers de config minimalement utilisés**
- `tsconfig.json` — hérité d'une config Next.js, très peu de TypeScript dans le projet (all JS)

**À considérer** : Nettoyer ou laisser pour future migration TS.

---

## 📊 Résumé statistiques

| Métrique | Valeur |
|----------|--------|
| **Lignes de code totales** | ~2500 |
| | |
| **Fichiers actifs** | |
| Pages (Next.js) | 5 (dont 1 inutilisée) |
| Composants réutilisables | 1/12 utilisés (Logo) |
| Hooks | 3 actifs |
| Services | 7 actifs (excl. tests) |
| Electron files | 11 actifs |
| | |
| **Fichiers supprimables** | |
| Composants inutilisés | 11 |
| Context inutilisé | 1 |
| Lib (crypto web) | 1 |
| Scripts de test | 2 |
| Dossiers vides | 2 |
| **Total à supprimer** | **~17 fichiers** |

---

## 🎯 Points clés de l'architecture

### **Avantages**
✅ **Séparation claire** : PWA (upload) ↔ Electron (print)  
✅ **Single source of truth** : Supabase + polling  
✅ **Sécurité** : Preload bridge, crypto AES-256-GCM  
✅ **Gestion d'expiration** : TTL automatique (6h users, fichiers)  
✅ **Offline support** : Service Worker avec Network First  
✅ **Logs centralisés** : fichier JSON journalier  

### **Défauts & améliorations**
⚠️ **Composants orphelins** : 11 composants non utilisés (clutter)  
⚠️ **Session management** : SessionContext created but unused pattern  
⚠️ **Styles fragmentés** : globals.css (322L) + dashboard.css (à consolider)  
⚠️ **Scripts de test** : Loose dans derewolprint root (à organiser)  
⚠️ **No error boundaries** : Pas de gestion panics React  
⚠️ **Polling fixe** : 6s + 5s (pas adaptatif)  

### **Recommandations**
1. **Supprimer** tous les composants inutilisés + SessionContext
2. **Fusionner** styles CSS (globals + dashboard)
3. **Créer** dossier `/tests` pour scripts Electron
4. **Ajouter** React Error Boundary sur pages clés
5. **Documente** les schémas Supabase
6. **Ajouter** variables d'env pour URLs Supabase

---

## 🔧 Commandes de développement

```bash
# PWA (Next.js)
cd d:\workspace\Derewol
npm run dev     # Dev server :3000
npm run build   # Export statique
npm start       # Production

# Electron (Derewol Print)
cd d:\workspace\Derewol\derewolprint
npm start       # Lance l'app Electron

# Scripts test
node generate-10-jobs.js
node test-job-reject.js
```

---

**Généré le 27/02/2026** — Derewol Project Analysis
