# 📋 ANALYSE COMPLÈTE DEREWOL - 13/04/2026

## 🎯 OBJECTIF: PURGER ET OPTIMISER LE PROJET

Analyse exhaustive pour refactorisation et optimisation du système Derewol (PWA + Electron).

---

## 🔴 PROBLÈMES CRITIQUES IDENTIFIÉS

### 1️⃣ BUG MAJEUR: REJET DE TOUS LES FICHIERS D'UN GROUPE

**Quand**: Un seul fichier est rejeté dans DerewolPrint  
**Où**: `derewolprint/main/main.js` - handler `job:reject` (~ligne 535)  
**Problème**: Le groupe ENTIER devient "rejected"

**Code problématique**:

```javascript
// ❌ MAUVAIS: Rejette tout le groupe au lieu du fichier seul
await supabase
  .from("file_groups")
  .update({ status: "rejected" })
  .eq("id", fileGroupId);
```

**Exemple**:

- Groupe A contient 5 fichiers: [file1.pdf, file2.pdf, file3.pdf, file4.pdf, file5.pdf]
- Utilisateur rejette file2.pdf
- **BUG**: Tout le groupe devient "rejected"
- **ATTENDU**: Seul file2.pdf devrait être marqué comme rejeté

**Conséquences**:

- ❌ Les autres fichiers deviennent invisibles à l'impression
- ❌ Les clients voient leur groupe "Rejeté" au lieu de "Partiellement rejeté"
- ❌ Impossible de réimprimer les fichiers non-rejetés
- ❌ Mauvaise expérience utilisateur

**Solution requise**:

1. Ajouter colonne `files.rejected` (boolean)
2. Créer handler IPC "job:reject-file" pour rejet individuel
3. Implémenter logique: si TOUS files.rejected=true → group.status='rejected'
4. Sinon: keeper groupe en statut courant

---

### 2️⃣ INCOHÉRENCE STATUTS PWA vs ELECTRON

**Problème**: Désynchronisation entre interface utilisateur (PWA) et application d'impression (Electron)

**Cas concret**:

```
Timeline:
┌─────────────────────────────────────────┐
│ 14:30 User uploads 3 files via PWA      │
│ → group.status='waiting'                │
│ → PWA display: "En attente"             │
└─────────────────────────────────────────┘
         ↓ Electron reçoit les jobs
┌─────────────────────────────────────────┐
│ 14:31 Electron poll shows 3 files       │
│ → UI displays 3 files                   │
│ → Printer rejects file 2                │
└─────────────────────────────────────────┘
         ↓ Electron updates DB
┌─────────────────────────────────────────┐
│ 14:32 DB: file_groups.status='rejected' │
│ Electron: shows group as "Rejeté" ✓     │
│ PWA: still shows "En attente" ✗         │
├─────────────────────────────────────────┤
│ INCOHÉRENCE CRITÈRE: Les deux UI ne    │
│ synchronisent pas le statut du groupe  │
└─────────────────────────────────────────┘
```

**Locations du code**:

- PWA fetches: `pages/p/index.js` ligne ~160 (usePrintStatus)
  ```javascript
  const data = await fetchGroupsByOwner(ownerId);
  ```
- Electron broadcasts: `derewolprint/renderer/js/bridge/derewolBridge.js`
  ```javascript
  window.derewol.onJobReceived((jobs) => { ... })
  ```

**Structure données actuelle**:

```
file_groups:
  ├─ id (uuid)
  ├─ status: 'waiting'|'printing'|'rejected'|'expired'|'completed'
  ├─ copies_count (int)
  └─ expires_at (timestamp)

print_jobs:
  ├─ id (uuid)
  ├─ status: 'queued'|'printing'|'rejected'|'completed'
  ├─ file_id (uuid)
  └─ copies_requested (int)

files:
  ├─ id (uuid)
  ├─ file_name (string)
  ├─ storage_path (string)
  ├─ encrypted_key (string)
  └─ ❌ MANQUE: rejected (boolean)  ← CRITIQUE!
```

**Cause racine**:

- `files` table n'a pas d'attribut "rejected"
- `print_jobs` a un statut "rejected" mais les fichiers individuels ne le reflètent pas
- Quand 1 job rejeté → tout le groupe devient rejeté (au lieu de juste ce fichier)

---

### 3️⃣ ABSENCE REJET INDIVIDUEL DE FICHIERS

**Problème**: Pas de logique pour rejeter UN fichier sans impacter le groupe

**Fichiers concernés**:

- `renderJobs.js` (ligne ~200): appelle `onRejectFile()` ✗ pas d'IPC handler
- `main.js` (ligne ~535): `job:reject` rejette TOUT le groupe ✗ doit être changé
- `preload.js`: pas de bridge pour `rejectFile()`

**Ce qui existe**:

```javascript
// renderJobs.js - le code EXISTE mais n'est PAS implémenté
document.querySelectorAll(".btn-reject-file").forEach((btn) => {
  btn.addEventListener("click", () => {
    onRejectFile?.({
      jobId: btn.dataset.jobId,
      fileId: btn.dataset.fileId, // ✓ File spécifique
      fileName: btn.dataset.fileName,
      groupId: btn.dataset.groupId,
    });
  });
});
```

**Ce qui manque**:

```javascript
// À ajouter dans main.js
ipcMain.handle("job:reject-file", async (event, { jobId, fileId, groupId }) => {
  // 1. Mark file as rejected
  // 2. Delete storage
  // 3. Update group status logic
});
```

**Logique attendue**:

```
Rejet fichier:
1. Mark files.rejected = true
2. Delete file from storage
3. Delete print_job for that file
4. Calculate: rejected_count = COUNT(files WHERE group_id=X AND rejected=true)
5. total_count = COUNT(files WHERE group_id=X)
6. If rejected_count == total_count:
    → group.status = 'rejected'
   Else:
    → group.status = 'partial_rejected'  (nouveau statut)
7. Broadcast update to PWA
```

---

### 4️⃣ MANQUE DE COLONNE REJECTED DANS TABLE FILES

**Localisation**: `Supabase → public.files`

**Structure actuelle**:

```sql
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.file_groups(id),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  encrypted_key text,
  file_hash text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
  -- ❌ MANQUE: rejected boolean DEFAULT false
);
```

**Requis**:

```sql
ALTER TABLE public.files ADD COLUMN rejected boolean DEFAULT false;
CREATE INDEX idx_files_rejected ON public.files(rejected);
```

**Impact**:

- PWA ne peut pas voir individuellement les fichiers rejetés
- Electron doit traiter une logique compliquée pour déterminer statut groupe
- Pas de source de vérité (source of truth) pour rejet fichier

---

### 5️⃣ REJET SUPPRIME TOUS LES FICHIERS D'UN GROUPE

**Problème**: Quand `job:reject` est appelé, il supprime:

```javascript
// main.js ligne ~550
if (file?.storage_path) {
  await supabase.storage.from("derewol-files").remove([file.storage_path]);
}
```

**Mais aussi**:

```javascript
// main.js ligne ~557
await cleanupJobDB(jobId, fileGroupId);
// DELETE FROM files WHERE group_id = fileGroupId ❌ SUPPRIME TOUT!
```

**Code problématique**:

```javascript
async function cleanupJobDB(jobId, fileGroupId) {
  try {
    if (fileGroupId) {
      await supabase.from("files").delete().eq("group_id", fileGroupId);
      // ❌ Supprime TOUS les fichiers du groupe, pas juste celui rejeté!
    }
    await supabase.from("print_jobs").delete().eq("id", jobId);
  } catch (e) {
    console.warn("[CLEANUP] Erreur DB :", e.message);
  }
}
```

**Solution**:

```javascript
// Rejeter 1 fichier seulement
await supabase.from("files").update({ rejected: true }).eq("id", fileId);

// DeleteR le job assoc uniquement
await supabase.from("print_jobs").delete().eq("id", jobId);

// Ne PAS supprimer les autres fichiers du groupe
```

---

### 6️⃣ POLLING RATE INEFFICACE

**Problème**: La PWA poll toutes les 3 secondes (ligne ~160 pages/p/index.js)

```javascript
const interval = setInterval(fetchGroups, 3000); // ← 3s
```

**Inefficacités**:

- Consomme de la bande passante inutilement
- Surcharge Supabase pour un petit volume
- Crée une latence perceptible pour l'utilisateur
- Pas de subscription engine utilisé

**Suggestions**:

- Utiliser Supabase Realtime subscriptions (au lieu de polling)
- Ou augmenter le polling à 5-10 secondes côté PWA
- Garder 1s côté Electron (critique pour impression)

---

### 7️⃣ SANS SCHEMA MIGRATION POUR FICHIERS REJETÉS

**Problème**: Aucune migration n'a défini comment les fichiers rejetés sont gérés

**Ce qui manque**:

```sql
-- Migration: Add rejected column to files
-- File: supabase/migrations/20260413_add_files_rejected.sql

ALTER TABLE public.files
ADD COLUMN rejected boolean DEFAULT false;

ALTER TABLE public.files
ADD COLUMN rejected_at timestamp with time zone;

ALTER TABLE public.files
ADD COLUMN reject_reason text;

CREATE INDEX idx_files_group_rejected
ON public.files(group_id, rejected);
```

**Et pour les statuts partiels**:

```sql
-- file_groups peut avoir plusieurs statuts
-- 'waiting' → en attente
-- 'printing' → impression en cours
-- 'rejected' → TOUS rejetés
-- 'partial_rejected' → CERTAINS rejetés (NOUVEAU)
-- 'completed' → fini
-- 'expired' → expiré

-- Ajouter index pour query rapide
CREATE INDEX idx_file_groups_status
ON public.file_groups(status);
```

---

## 🗺️ ROUTES COMPLÈTES DU SYSTÈME

### 📱 PWA Routes (Next.js)

```
GET /
  ├─ Landing page
  ├─ No auth required
  ├─ Renders: /pages/index.js
  └─ User chooses printer or scans QR

GET /p/[slug]
  ├─ ***MAIN INTERFACE***
  ├─ Dynamic route with printer slug
  ├─ Location: /pages/p/index.js (180+ lines)
  ├─ No auth (anonymous session)
  ├─ Flow:
  │  1. Resolve printer slug → GET /lib/supabase.js → getPrinterBySlug()
  │  2. Create anon session (localStorage)
  │  3. Render upload interface
  │  4. Poll for job status (3s interval)
  │  5. Show file-level rejection status
  └─ Returns: React component with UI

GET /dashboard
  ├─ Admin dashboard
  ├─ Location: /pages/dashboard.js
  ├─ Shows: Recent jobs, printer stats
  └─ Auth: Admin only (TODO: implement)

GET /upload
  ├─ Alternative upload interface
  ├─ Location: /pages/upload.js
  └─ TODO: Implement

GET /offline.html
  ├─ PWA offline fallback
  ├─ Location: /public/offline.html
  └─ Served by service worker (/public/sw.js)

POST /api/file-groups
  ├─ Create file group (implicit via lib/supabase.js)
  ├─ Called by: pages/p/index.js → createFileGroup()
  ├─ Location: /lib/supabase.js line ~27
  ├─ Params: { ownerId, printerId, copiesCount }
  ├─ Returns: { groupId }
  └─ Creates: file_groups row with status='waiting'

POST /api/files/upload
  ├─ Upload file to storage bucket
  ├─ Called by: pages/p/index.js → uploadFileToGroup()
  ├─ Location: /lib/supabase.js line ~42
  ├─ Params: { file, groupId, ownerId, printerId, copies }
  ├─ Process:
  │  1. Upload to storage: derewol-files/[printerId]/[ownerId]/[timestamp]-[filename]
  │  2. Insert file record
  │  3. Create print_job with status='queued'
  ├─ Returns: { fileId, jobId }
  └─ Side effect: Creates print_jobs watchable by Electron

GET /api/files/:groupId
  ├─ Fetch group files and status
  ├─ Called by: pages/p/index.js → fetchGroupsByOwner()
  ├─ Location: /lib/supabase.js line ~80
  ├─ Queries:
  │  SELECT * FROM file_groups
  │  JOIN files ON file_groups.id = files.group_id
  │  JOIN print_jobs ON files.id = print_jobs.file_id
  │  WHERE owner_id = ?
  ├─ Returns: [ { groupId, status, files: [ { id, name, rejected, ... } ] } ]
  └─ Polling interval: 3s from PWA

GET /api/printer/:slug
  ├─ Resolve printer from slug
  ├─ Called by: pages/p/index.js → getPrinterBySlug()
  ├─ Location: /lib/supabase.js line ~6
  ├─ Query: SELECT id, slug, name FROM printers WHERE slug = ?
  ├─ Returns: { id, slug, name }
  └─ Used for: Initial printer configuration
```

### 🖥️ Electron IPC Handlers (derewolprint/main/main.js)

```
ipcMain.handle("printer:config", handler)
  ├─ Get current printer configuration
  ├─ Returns: { id, slug, name, url, owner_phone }
  ├─ No params
  └─ Called: On app startup, settings panel

ipcMain.handle("printer:update-name", (_, name), handler)
  ├─ Update printer name in Supabase
  ├─ Params: { name: string }
  ├─ Side effect: Updates printers table + local config
  └─ Returns: { success: boolean }

ipcMain.handle("subscription:check", handler)
  ├─ Check subscription status from DB
  ├─ No params
  ├─ Queries: subscriptions WHERE printer_id = ?
  ├─ Returns: { valid, trial_active, trial_expires_at, daysLeft }
  └─ Called: Boot sequence, periodically (60min)

ipcMain.handle("subscription:activate", (_, code), handler)
  ├─ Activate subscription with code
  ├─ Params: { code: string }
  ├─ Updates: subscriptions table
  ├─ Returns: { success, error }
  └─ Emits: "subscription:status" → renderer

ipcMain.handle("trial:activate", handler)
  ├─ Activate 7-day trial
  ├─ No params
  ├─ Updates: subscriptions table with trial_expires_at
  ├─ Returns: { success, error }
  └─ Emits: "subscription:status" → renderer

ipcMain.handle("history:get", handler)
  ├─ Get print history (last 200 records)
  ├─ No params
  ├─ Query: SELECT * FROM history WHERE printer_id = ? LIMIT 200
  ├─ Returns: [ { file_name, status, printed_at, copies } ]
  └─ Displays: In "Historique" tab

ipcMain.handle("job:confirm", (event, groupId, printerName, _copies, jobCopies), handler)
  ├─ Confirm + print group of files
  ├─ Params: { groupId, printerName, jobCopies: [ { jobId, copies } ] }
  ├─ Process:
  │  1. Set file_groups.status = 'printing'
  │  2. For each jobId:
  │     a. Download file from storage
  │     b. Decrypt file
  │     c. Print N copies to printer
  │     d. Update job.status = 'completed'
  │     e. Delete from storage
  │  3. Set file_groups.status = 'completed'
  ├─ Returns: { success, results: [ { jobId, fileName, copies } ] }
  ├─ Errors: Partial success possible
  └─ Storage cleanup: Deletes files after printing

ipcMain.handle("job:reject", (event, jobId), handler)
  ├─ ***PROBLÉMATIQUE*** Reject a job
  ├─ Params: { jobId }
  ├─ Current behavior (BUGUÉ):
  │  ❌ Sets file_groups.status = 'rejected' (TOUT LE GROUPE!)
  │  ❌ Deletes file from storage
  │  ❌ Calls cleanupJobDB() which deletes groupe entier
  ├─ Returns: { success }
  ├─ Should be: Changed to reject individual file
  └─ TODO: Refactor + add job:reject-file handler

ipcMain.handle("job:reject-file", MISSING)
  ├─ ***MANQUANT*** Reject individual file
  ├─ Needed params: { jobId, fileId, groupId }
  ├─ Process:
  │  1. Mark files.rejected = true
  │  2. Delete storage file
  │  3. Delete print_job
  │  4. Check: all files.rejected in group?
  │  5. If yes: group.status = 'rejected'
  │  6. Else: group.status = 'partial_rejected'
  └─ Returns: { success }

ipcMain.handle("printer:list", handler)
  ├─ Get available printers on system
  ├─ No params
  ├─ Uses: pdf-to-printer library
  ├─ Returns: [ { name, status } ]
  └─ Called: Printer dropdown in settings

ipcMain.handle("printer:default", handler)
  ├─ Get default system printer
  ├─ No params
  ├─ Returns: { name }
  └─ Used for: Initial printer selection

ipcMain.handle("polling:set-interval", (_, intervalMs), handler)
  ├─ Change polling interval
  ├─ Params: { intervalMs: number (min 1000) }
  ├─ Calls: restartPolling()
  ├─ Updates: Job fetch frequency
  └─ Returns: { success }

ipcMain.handle("setup:check-slug", (_, slug), handler)
  ├─ Check if slug available (onboarding)
  ├─ Params: { slug }
  ├─ Query: SELECT id FROM printers WHERE slug = ?
  ├─ Returns: { available: boolean }
  └─ Used: During setup wizard

ipcMain.handle("setup:register", (_, { name, slug, ownerPhone }), handler)
  ├─ Register new printer (onboarding)
  ├─ Params: { name, slug, ownerPhone }
  ├─ Inserts: New printer record in Supabase
  ├─ Saves: Local config to printerConfig.json
  ├─ Returns: { success, config }
  └─ Creates: file_groups ready for receiving jobs
```

---

## 🔄 LOGIQUE COMPLÈTE DU SYSTÈME

### 📊 Modèle de données (Supabase)

```
TABLE: printers
├─ id (uuid, PK)
├─ slug (text, UNIQUE) ← Used in PWA URL: /p/[slug]
├─ name (text)
├─ owner_phone (text, nullable)
├─ created_at (timestamp)
└─ updated_at (timestamp)

TABLE: file_groups ← Groups files logically
├─ id (uuid, PK)
├─ printer_id (uuid, FK → printers)
├─ owner_id (text) ← Anon session ID from PWA
├─ status (enum: 'waiting'|'printing'|'rejected'|'expired'|'completed'|'partial_rejected')
├─ copies_count (int) ← Total copies for group
├─ expires_at (timestamp) ← 30 min default
├─ created_at (timestamp)
└─ updated_at (timestamp)

TABLE: files ← Individual files
├─ id (uuid, PK)
├─ group_id (uuid, FK → file_groups)
├─ file_name (text)
├─ storage_path (text) ← Location in derewol-files bucket
├─ encrypted_key (text, nullable) ← AES-256 key for decryption
├─ file_hash (text, nullable)
├─ rejected (boolean, DEFAULT false) ← ***NEW: CRITICAL***
├─ rejected_at (timestamp, nullable) ← ***NEW: When rejected***
├─ reject_reason (text, nullable) ← ***NEW: Why rejected***
├─ created_at (timestamp)
└─ updated_at (timestamp)

TABLE: print_jobs ← 1-to-1 file to job
├─ id (uuid, PK)
├─ group_id (uuid, FK → file_groups)
├─ file_id (uuid, FK → files)
├─ status (enum: 'queued'|'printing'|'completed'|'rejected'|'expired')
├─ print_token (text, nullable)
├─ copies_requested (int)
├─ copies_remaining (int)
├─ expires_at (timestamp) ← 30 min default
├─ created_at (timestamp)
└─ updated_at (timestamp)

TABLE: subscriptions ← Printer subscription
├─ id (uuid, PK)
├─ printer_id (uuid, FK → printers, UNIQUE)
├─ valid (boolean) ← Is paid subscription active
├─ trial_active (boolean)
├─ trial_expires_at (timestamp, nullable)
├─ subscription_expires_at (timestamp, nullable)
├─ plan (enum: '1month'|'3months'|'6months')
├─ created_at (timestamp)
└─ updated_at (timestamp)

TABLE: history ← Log of all print operations
├─ id (uuid, PK)
├─ printer_id (uuid, FK → printers)
├─ group_id (uuid, nullable, FK → file_groups)
├─ owner_id (text)
├─ display_id (text) ← Short code shown to user
├─ file_name (text)
├─ copies (int)
├─ status (text: 'completed'|'rejected'|'expired')
├─ printer_name (text)
├─ printed_at (timestamp)
└─ created_at (timestamp)

STORAGE BUCKET: derewol-files
├─ Structure: /[printerId]/[ownerId]/[timestamp]-[filename]
├─ Files: Encrypted PDFs + Word + Excel
├─ Cleanup: Auto-delete after 30 days
└─ Access: Read-signed URLs for PWA preview
```

### 🔀 Flow Upload (User → PWA → DB → Electron)

```
Step 1: USER ACTIONS (PWA - pages/p/index.js)
┌────────────────────────────┐
│ 1. User scans QR           │
│    URL: /p/printer-slug    │
└────────────────────────────┘
         ↓
┌────────────────────────────────────────┐
│ 2. PWA resolves printer + creates      │
│    anonymous session (localStorage)    │
│    - owner_id: 'anon-xxx-yyy'         │
│    - display_code: 'A7K2'             │
│    - expires: 6 hours                 │
└────────────────────────────────────────┘
         ↓
┌────────────────────────────┐
│ 3. User selects files      │
│    Drag-drop PDF/Word/Excel│
│    Set copies per file     │
└────────────────────────────┘
         ↓
┌────────────────────────────┐
│ 4. User clicks "Envoyer"   │
│    (Upload button)         │
└────────────────────────────┘

Step 2: UPLOAD PROCESS (pages/p/index.js → lib/supabase.js)
┌────────────────────────────────────────┐
│ A. Create file_group                   │
│    INSERT INTO file_groups (           │
│      printer_id: UUID,                 │
│      owner_id: 'anon-xxx-yyy',        │
│      status: 'waiting',                │
│      copies_count: N,                  │
│      expires_at: +30min                │
│    )                                   │
└────────────────────────────────────────┘
         ↓ Returns groupId
┌────────────────────────────────────────┐
│ B. For each file (sequential):         │
│    1. Upload to storage                │
│       derewol-files/[printerId]/[owner]│
│       /[timestamp]-normalized-name     │
│    2. INSERT INTO files (              │
│         group_id: groupId,             │
│         file_name: original_name,      │
│         storage_path: path,            │
│         rejected: false                │
│       )                                │
│    3. INSERT INTO print_jobs (         │
│         group_id: groupId,             │
│         file_id: newFileId,            │
│         status: 'queued',              │
│         copies_requested: N            │
│       )                                │
└────────────────────────────────────────┘
         ↓ For each file
┌────────────────────────────┐
│ C. Confirm upload          │
│    UPDATE files_count in   │
│    file_groups             │
└────────────────────────────┘

Step 3: ELECTRON POLLING (1s interval)
┌──────────────────────────────────────────┐
│ derewolprint/services/polling.js         │
│ Fetch pending jobs:                      │
│                                          │
│ SELECT print_jobs.*,                     │
│        file_groups.*,                    │
│        files.*                           │
│ FROM print_jobs                          │
│ JOIN file_groups ON ...                  │
│ JOIN files ON ...                        │
│ WHERE print_jobs.status IN ('queued',    │
│       'printing', 'rejected')            │
│ AND file_groups.printer_id = X           │
│ AND expires_at > NOW()                   │
└──────────────────────────────────────────┘
         ↓
┌──────────────────────────────────────────┐
│ derewolprint/renderer/js/bridge/         │
│ derewolBridge.js                         │
│ Format jobs into UI groups               │
│ Compare signature (MD5-like)             │
│ If changed: Update jobStore              │
│ Else: Skip update (no-op)                │
└──────────────────────────────────────────┘
         ↓
┌──────────────────────────────────────────┐
│ Electron UI renders:                     │
│ → Job card appears in "Mes jobs"         │
│ → Sound notification plays               │
│ → Files list shown with "Imprimer" btn  │
└──────────────────────────────────────────┘

Step 4: USER REJECTION (Electron UI)
┌────────────────────────────┐
│ User sees: 3 files group   │
│ Clicks reject button on    │
│ file #2: "report.docx"     │
└────────────────────────────┘
         ↓
┌────────────────────────────────────────────┐
│ Current behavior (BUGUÉ):                 │
│ IPC "job:reject" sends jobId of file #2   │
│ main.js:                                  │
│   1. Delete storage_path ✓               │
│   2. Set file_groups.status='rejected' ✗ │
│      (marks ENTIRE GROUP as rejected)    │
│   3. Delete ALL files in group ✗         │
│                                          │
│ Result: Files #1 #3 also deleted         │
└────────────────────────────────────────────┘

Step 5: PWA VIEWS HISTORY
┌────────────────────────────────────────┐
│ PWA polls (3s interval):                │
│ SELECT ... FROM file_groups, files      │
│ WHERE owner_id = 'anon-xxx-yyy'        │
│                                        │
│ Display:                               │
│ ❌ Group shows "Rejeté"               │
│ ❌ All files greyed out (even #1, #3) │
│ ❌ User can't reprint #1, #3           │
└────────────────────────────────────────┘
```

### 🔄 Flow Impression (Electron)

```
Step 1: USER INTERACTION
┌─────────────────────────────────┐
│ User selects printer from list  │
│ Clicks "Imprimer tout"          │
│ Confirmation dialog appears     │
└─────────────────────────────────┘

Step 2: IPC "job:confirm"
┌────────────────────────────────────┐
│ main.js handler receives:          │
│ {                                  │
│   groupId: "abc123",               │
│   printerName: "Xerox WC5335",    │
│   jobCopies: [                     │
│     { jobId: "job1", copies: 2 },  │
│     { jobId: "job2", copies: 1 },  │
│     { jobId: "job3", copies: 3 }   │
│   ]                                │
│ }                                  │
└────────────────────────────────────┘

Step 3: PROCESS EACH JOB SEQUENTIALLY
┌──────────────────────────────────────────┐
│ For each job in jobCopies:               │
│                                          │
│ A. Update print_jobs.status='printing'   │
│                                          │
│ B. Download file from storage            │
│    GET derewol-files/path                │
│                                          │
│ C. Decrypt file (if encrypted)           │
│    crypto.decryptFile(buffer,key)        │
│                                          │
│ D. Write to temp file                    │
│    /tmp/dw-[jobId].pdf                   │
│                                          │
│ E. For each copy (1 to N):               │
│    1. Print to printer                   │
│       pdfToPrinter.print(path, {         │
│         printer: 'Xerox WC5335'          │
│       })                                 │
│    2. Update copies_remaining--          │
│    3. Log to history                     │
│                                          │
│ F. After all copies:                     │
│    1. Update print_jobs.status=          │
│       'completed'                        │
│    2. Delete from storage                │
│    3. Delete temp file                   │
│                                          │
│ G. Move to next job                      │
└──────────────────────────────────────────┘

Step 4: FINALIZE GROUP
┌────────────────────────────────┐
│ After all jobs printed:        │
│ UPDATE file_groups.status=     │
│   'completed'                  │
│                                │
│ Clean spooler after 2s         │
│ net stop spooler /y            │
│ (Windows cleanup)              │
└────────────────────────────────┘

Step 5: PWA SEES UPDATE
┌───────────────────────────────┐
│ PWA polls (3s) and fetches    │
│ file_groups query returns     │
│ → status = 'completed'        │
│ → Show "Terminé ✓"           │
│ → Hide group after 1 hour     │
└───────────────────────────────┘
```

---

## 🚀 SOLUTIONS PROPOSÉES

### Phase 1: Add File-Level Rejection (URGENT)

**1.1 Supabase Migration**

```sql
-- Add columns to files table
ALTER TABLE public.files
ADD COLUMN IF NOT EXISTS rejected boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS reject_reason text;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_files_group_rejected
ON public.files(group_id, rejected);
```

**1.2 Add IPC Handler "job:reject-file" in main.js**

```javascript
ipcMain.handle("job:reject-file", async (event, { jobId, fileId, groupId }) => {
  try {
    // 1. Mark file as rejected
    await supabase
      .from("files")
      .update({
        rejected: true,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    // 2. Delete from storage
    const { data: file } = await supabase
      .from("files")
      .select("storage_path")
      .eq("id", fileId)
      .single();

    if (file?.storage_path) {
      await supabase.storage.from("derewol-files").remove([file.storage_path]);
    }

    // 3. Delete job
    await supabase.from("print_jobs").delete().eq("id", jobId);

    // 4. Check if all files in group are rejected
    const { data: allFiles } = await supabase
      .from("files")
      .select("rejected")
      .eq("group_id", groupId);

    const allRejected = allFiles?.every((f) => f.rejected);
    const newStatus = allRejected ? "rejected" : "partial_rejected";

    // 5. Update group status
    await supabase
      .from("file_groups")
      .update({ status: newStatus })
      .eq("id", groupId);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

**1.3 Modify Existing "job:reject" Handler**

```javascript
// Change from:
// await supabase.from("file_groups").update({ status: "rejected" })

// To:
// Call job:reject-file for the single job's file
// → Then check all files in group
// → Set appropriate status
```

### Phase 2: Add to Preload Bridge (preload.js)

```javascript
rejectFile: (jobId, fileId, groupId) =>
  ipcRenderer.invoke("job:reject-file", { jobId, fileId, groupId }),
```

### Phase 3: Update Electron UI (renderJobs.js)

```javascript
// Already has onRejectFile callback, just needs to call the new IPC
onRejectFile?.({
  jobId: btn.dataset.jobId,
  fileId: btn.dataset.fileId,
  groupId: btn.dataset.groupId,
}); // → triggers IPC "job:reject-file"
```

### Phase 4: Add PWA Support for Partial Rejection

```javascript
// pages/p/index.js - GroupCard component

const haRejectedFile = files.some((f) => f.rejected);
const allRejected = files.every((f) => f.rejected);
const partialRejected = haRejectedFile && !allRejected;

// Display status badges
{
  partialRejected && (
    <span style={{ color: "#f59e0b" }}>
      <i className="fa-solid fa-alert-triangle" />
      Partiellement rejeté ({rejectedCount}/{fileCount})
    </span>
  );
}
```

---

## 📈 OPTIMISATIONS PROPOSÉES

### 1. Realtime Subscriptions instead of Polling

**PWA** (actuellement: polling 3s → change to Realtime)

```javascript
// Avant (PWA)
useEffect(() => {
  const interval = setInterval(fetchGroups, 3000);
  return () => clearInterval(interval);
}, []);

// Après (Realtime)
useEffect(() => {
  const subscription = supabase
    .from(`file_groups:owner_id=eq.${ownerId}`)
    .on("*", (payload) => {
      const group = payload.new;
      setGroups((prev) => {
        return prev.map((g) => (g.id === group.id ? group : g));
      });
    })
    .subscribe();

  return () => subscription.unsubscribe();
}, [ownerId]);
```

**Benefit**: ~200% reduction in network calls

### 2. Consolidate Printing Functions

**Current**: printSingleJob (single) + job:confirm (entire group)  
**Proposed**: Single printGroup function handling both

### 3. Better Error Handling

**Add**: Try-catch with user-facing feedback in Electron UI

### 4. ✅ Cleanup Old Files Automatically

```sql
-- Daily cleanup of expired files
SELECT cron.schedule('cleanup-expired-jobs', '0 2 * * *',
  'DELETE FROM files WHERE expires_at < NOW()');
```

### 5. Add Logging/Analytics

```javascript
// Track:
// - Upload time
// - Print time
// - Rejection rate
// - Most common file types
```

---

## ✅ CHECKLIST OPTIMISATION

- [ ] Add files.rejected column (migration)
- [ ] Create job:reject-file IPC handler
- [ ] Update job:reject handler to use job:reject-file
- [ ] Implement partial_rejected group status
- [ ] Add UI support for partial rejection (PWA)
- [ ] Switch PWA to Realtime subscriptions
- [ ] Add error handling + user feedback
- [ ] Update tests/QA checklist
- [ ] Verify UTF-8 encoding everywhere
- [ ] Performance test with 1000+ files
- [ ] Deploy to staging
- [ ] Deploy to production

---

## 📝 NOTES IMPORTANTES

### Database Consistency

- Always validate file_groups.status from files.rejected state
- If inconsistency detected:
  ```sql
  -- Repair command
  UPDATE file_groups
  SET status = CASE
    WHEN (SELECT COUNT(*) FROM files WHERE group_id = file_groups.id
          AND NOT rejected) = 0 THEN 'rejected'
    WHEN (SELECT COUNT(*) FROM files WHERE group_id = file_groups.id
          AND rejected) > 0 THEN 'partial_rejected'
    ELSE status
  END;
  ```

### Migration Strategy

1. Demo with current bug first
2. Deploy Phase 1 (add column)
3. Gradually roll out new handlers
4. Monitor error logs
5. Full switch-over within 2 weeks

### Testing Scenarios

```
Test 1: Upload 3 files → Reject 1 → Check group status
Expected: status='partial_rejected', 1 file hidden, 2 printable

Test 2: Upload 3 files → Reject all 3 → Check group status
Expected: status='rejected', all files hidden, group removed after 6h

Test 3: Upload 3 files → Print 2 → Reject 1 → Check history
Expected: 2 in completed, 1 in rejected, group removed

Test 4: PWA uploading while Electron printing
Expected: No race conditions, correct status shown everywhere
```

---

**Document Version**: 1.0  
**Last Updated**: 13/04/2026  
**Author**: Analysis System  
**Status**: Ready for Implementation
