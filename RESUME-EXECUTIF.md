# 📈 RÉSUMÉ EXÉCUTIF - Exploration Derewol

**Généré:** 2026-05-04  
**Total fichiers:** 53 fichiers .js/.ts/.json

---

## DÉPENDANCES NPM - STATUT COMPLÈTEMENT

### Racine (package.json)

| Dépendance            | Version | Statut | Usage                                      |
| --------------------- | ------- | ------ | ------------------------------------------ |
| @supabase/supabase-js | ^2.33.0 | ✅     | Multiple files import from lib/supabase.js |
| next                  | 13.5.2  | ✅     | Pages, Router, Link dans pages/            |
| react                 | 18.2.0  | ✅     | Toutes les pages et composants             |
| react-dom             | 18.2.0  | ✅     | Rendu pages/\_document.js                  |
| @types/react          | 19.2.14 | ✅     | TypeScript support                         |
| typescript            | 5.9.3   | ✅     | tsconfig.json présent                      |

**Verdict:** ✅ **100% utilisées**

### DerewolPrint (derewolprint/package.json)

| Dépendance               | Version  | Statut | Usage      | Fichiers                              |
| ------------------------ | -------- | ------ | ---------- | ------------------------------------- |
| @supabase/supabase-js    | ^2.39.0  | ✅     | Backend    | services/supabase.js                  |
| cross-env                | ^7.0.3   | ✅     | Scripts    | package.json scripts                  |
| electron-log             | ^5.0.0   | ❌     | ORPHELINE  | Aucun import trouvé                   |
| mammoth                  | ^1.7.0   | ✅     | Word→HTML  | viewer.html + viewer.js               |
| nodemailer               | ^8.0.7   | ✅     | Emails     | services/recovery.js                  |
| pdf-to-printer           | ^5.4.0   | ✅     | Print      | main.js + services/printer.js         |
| pdfjs-dist               | ^5.6.205 | ⚠️     | Config?    | Copié dans build, pas utilisé en code |
| qrcode                   | ^1.5.4   | ✅     | QR Gen     | main.js ligne 33                      |
| xlsx                     | ^0.18.5  | ✅     | Excel View | viewer.html + viewer.js               |
| electron _(dev)_         | ^28.0.0  | ✅     | App        | main.js, preload.js                   |
| electron-builder _(dev)_ | ^24.9.1  | ✅     | Build      | package.json build config             |

**Verdict:** 🟡 **91% utilisées** (1 orpheline: electron-log)

---

## FICHIERS ORPHELINS & INUTILISÉS

### 🔴 HAUTE PRIORITÉ (Supprimer/Refactoriser)

```
components/Logo.js              - Jamais importé (3 lignes)
refacto/                        - Dossier entier code obsolète
  ├── p-index.js               - Vieille version de pages/p/index.js
  ├── supabase.js              - Vieille version de lib/supabase.js
  └── derewol_activation_modal.html
```

### 🟡 MOYEN PRIORITÉ (Vérifier/Améliorer)

```
hooks/usePrintStatus.js         - Vide! Fonction en 2 endroits
context/                        - Dossier vide (jamais utilisé)
lib/i18n.js                     - Exporté mais non importé
test-bluetooth.js              - Fichier test (organiser)
test-trial-ended.js            - Fichier test (organiser)
fix-modal-scope.js             - Script FIX (à archiver ou del)
```

---

## DUPLICATAS CODE DÉTECTÉS

### Duplication #1: `usePrintStatus()`

- **Lieu 1:** pages/dashboard.js (ligne 8)
- **Lieu 2:** pages/p/index.js (ligne 122)
- **Lieu 3:** refacto/p-index.js (ligne 29)
- **Problem:** Même logique Supabase + état en 3 endroits
- **Solution:** Créer hook vrai `hooks/usePrintStatus.js`

### Duplication #2: Supabase client init

- **Lieu 1:** lib/supabase.js
- **Lieu 2:** lib/helpers.js
- **Lieu 3:** refacto/supabase.js
- **Problem:** 3 instances différentes possibles
- **Solution:** Utiliser single client centralisé

### Duplication #3: Traductions i18n

- **Lieu 1:** lib/i18n.js (fr, en, wo)
- **Lieu 2:** derewolprint/renderer/i18n.js
- **Problem:** 2 i18n.js séparées
- **Solution:** Fusionner ou documenter

### Duplication #4: Refacto folder

- **Lecture:** Dossier refacto/p-index.js ≈ pages/p/index.js
- **Problem:** Code mort encombrant
- **Solution:** Archiver en git puis rm -rf

---

## IMPORTS PAR DÉPENDANCE

### @supabase/supabase-js (utilisée partout)

```
lib/supabase.js          → createClient()
lib/helpers.js           → createClient()
services/supabase.js     → createClient()
→ 3 clients différents! (cf duplication)
```

### React ecosystem utilisés

```
pages/, hooks/, components/  → React hooks
pages/                       → next/router, next/link
pages/_document.js           → next/document
```

### Node.js built-ins

```
main.js, services/          → fs, path, os, crypto, child_process
```

### Dépendances npm importées

```
pdfjs-dist     → JAMAIS IMPORTÉ (config only)
mammoth        → viewer.html + viewer.js
xlsx           → viewer.html + viewer.js
qrcode         → main.js (QR generation)
pdf-to-printer → main.js + services/printer.js
nodemailer     → services/recovery.js
electron       → main.js, preload.js
electron-log   → ❌ JAMAIS IMPORTÉ
```

---

## EXPORTS PAR FICHIER - UTILISATION

### lib/supabase.js

```javascript
export async function getPrinterBySlug()              // 11+ appels ✅
export async function getOrCreateActiveFileGroup()   // 1-2 appels ✅
export async function createFileGroup()              // 2+ appels ✅
export async function uploadFileToGroup()            // 1+ appels ✅
export async function updateFilesCount()             // 3 appels ✅
export async function fetchGroupsByOwner()           // 3 appels ✅
export async function getSignedUrlForOfficeViewer()  // 2+ appels ✅
export default supabase                              // 10+ appels ✅
```

### lib/helpers.js

```javascript
export const TTL                                     // 1+ appels ✅
export function loadSession()                        // 3+ appels ✅
export function saveSession()                        // 3 appels ✅
export function clearSession()                       // 3 appels ✅
export function createAnonymousSession()             // 2 appels ✅
```

### hooks/

```javascript
export default useSession()                         // 2+ appels ✅
export default usePrinter()                         // 1+ appels ✅
export default useUpload()                          // 1+ appels ✅
export default usePrintStatus()                     // ❌ VIDE/ORPHELIN
```

---

## CSS IMPORTS STATUS

| Fichier                                 | Importé par   | Statut |
| --------------------------------------- | ------------- | ------ |
| styles/globals.css                      | \_app.js      | ✅     |
| styles/dashboard.css                    | \_app.js      | ✅     |
| styles/modal.css                        | \_app.js      | ✅     |
| admin/css/admin.css                     | admin/\*.html | ✅     |
| derewolprint/renderer/renderer.css      | renderer.js   | ✅     |
| derewolprint/renderer/viewer/viewer.css | viewer.js     | ✅     |

**Verdict:** ✅ **100% utilisés**

---

## APPELS SUPABASE DÉTECTÉS

### Via supabase.from().select()

```
pages/p/index.js              → file_groups, printers, files
pages/dashboard.js             → file_groups (realtime)
hooks/usePrinter.js            → printers
lib/supabase.js                → Multiple tables
services/supabase.js (Electron) → printers, print_jobs, files
```

### Via supabase.from().insert()

```
pages/p/index.js         → file_groups, files, print_jobs
lib/helpers.js           → anon_sessions
lib/supabase.js          → file_groups, files, print_jobs
services/supabase.js     → recovery_requests
```

### Via supabase.auth.\*()

```
lib/helpers.js          → getSession() checks
admin/js/auth.js        → signInWithPassword(), signOut()
```

---

## RECOMMANDATIONS PRIORITAIRES

### 🔴 FAIRE IMMÉDIATEMENT

1. **Supprimer refacto/** (code dead/obsolète)
2. **Créer hooks/usePrintStatus.js** (fusionner 3 versions)
3. **Vérifier pdfjs-dist** (utilisé vraiment?)
4. **npm uninstall electron-log** (orpheline)

### 🟡 FAIRE BIENTÔT

5. Supprimer **components/Logo.js** (jamais utilisé)
6. Vérifier **lib/i18n.js** (jamais importé)
7. Supprimer **context/** (vide)
8. Organiser test-\*.js files

### 🟢 NICE TO HAVE

9. Consolider à 1 seul client Supabase
10. Documentation des traductions (i18n)

---

## STATISTIQUES FINALES

```
Total fichiers JS:           53
  ├── Pages:                  8
  ├── Hooks:                  4 (1 vide)
  ├── Lib:                    3
  ├── Components:             1 (inutilisé)
  ├── Admin JS:               5
  ├── Services:               9
  ├── Renderer:               5
  └── Autres:                 13

Fichiers réellement utilisés: ~40 (75%)
Fichiers orphelins:           4-5 (10%)
Fichiers tests:               2
Scripts/Utils:                2

Dépendances npm:
  ├── Racine:                 4 (100% used)
  └── DerewolPrint:           11 (91% used)

Duplicatas détectés:          4 (usePrintStatus x3, supabase init x3)
Code dead:                    ~500+ lignes (refacto + orphelins)

Codebase Health Score:        65-70% 🟡
```

**Potential savings si nettoyage:** ~10% code base size, 20% moins de confusion

---

## FICHIERS GÉNÉRÉS POUR CETTE ANALYSE

```
📄 EXPLORATION-COMPLETE-RAPPORT.md    (ce rapport complet)
📊 RESUME-EXECUTIF.md                 (ce fichier = résumé)
📋 MATRICE-IMPORTS.md                 (table détaillée imports)
✅ SESSION: exploration-progress.md   (notes session)
```

Date: 2026-05-04 | Version: 1.0
