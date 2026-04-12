# Architecture Système Bluetooth - Derewol

Diagramme complet du flux de données.

## 🔄 Flux complet d'un fichier

```
┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 1: RÉCEPTION                          │
└─────────────────────────────────────────────────────────────────┘

  📱 Appareil (Phone, Tablet, PC)
       │
       │ Envoie fichier via HTTP POST
       │ ou Bluetooth OBEX FTP
       ▼
  ┌─────────────────────────────┐
  │  Serveur HTTP Bluetooth     │
  │  :3738/bluetooth/upload     │
  │                             │
  │  - Reçoit le fichier        │
  │  - Stocke temporairement    │
  │  - Callback au service BT   │
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │   Service Bluetooth         │
  │   (bluetooth.js)            │
  │                             │
  │  - Génère ID: bt-{8hex}     │
  │  - Lit le fichier           │
  │  - Chiffre AES-256-GCM      │
  │  - Sauvegarde local         │
  │  - Crée métadata            │
  └──────────────┬──────────────┘
                 │
                 ▼
  ~/.derewol/bt-receipts/
  └─ bt-reception-a1b2c3d4@document.pdf (chiffré)


┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 2: SYNCHRONISATION                    │
└─────────────────────────────────────────────────────────────────┘

  Interval: toutes les 30 secondes
                 │
                 ▼
  ┌─────────────────────────────┐
  │  Service Sync BT            │
  │  (bluetoothSync.js)         │
  │                             │
  │  - Scan dossier local       │
  │  - Upload Supabase Storage  │
  │  - Insert métadata DB       │
  │  - Marque comme uploaded    │
  │  - Supprime fichier local   │
  └──────────────┬──────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
  Supabase Storage   Supabase Database
  ├─ 2024/4/        ├─ bluetooth_files
  │  └─ {...hash}   │  └─ [ID] ✅
  │     (chiffré)   └─ bluetooth_sync_log
         │                │
         └───────┬────────┘
                 │
                 ▼
  Nettoyage local
  - Marquer .uploaded
  - Écraser + Supprimer fichier


┌─────────────────────────────────────────────────────────────────┐
│                  PHASE 3: TRAITEMENT (OPTIONNEL)               │
└─────────────────────────────────────────────────────────────────┘

  Supabase Database
  ├─ Webhooks (Event)
  │  └─ Déclencher fonction cloud
  │     ├─ Traiter le fichier
  │     ├─ Envoyer notification
  │     └─ Déplacer vers archive
  │
  └─ Imprimeur peut accéder via:
     ├─ SELECT * FROM bluetooth_files
     └─ Télécharger depuis Storage
        (besoin de décrypter avec clé)
```

## 📦 Structure des fichiers clés

```
derewolprint/
├── main/
│   ├── main.js                 [IPC handlers + init]
│   └── localServer.js          [Serveur HTTP BT + Express]
│
├── services/
│   ├── crypto.js               [Chiffrement/Déchiffrement]
│   │   ├── generateAESKey()
│   │   ├── encryptFile()
│   │   └── decryptFile()
│   │
│   ├── bluetooth.js            [Service BT principal]
│   │   ├── startBTListener()
│   │   ├── processBTFile()
│   │   └── getPendingBTFiles()
│   │
│   ├── bluetoothSync.js        [Sync avec Supabase]
│   │   ├── startBTSync()
│   │   ├── uploadBTFileToSupabase()
│   │   └── forceBTSync()
│   │
│   ├── supabase.js             [Client Supabase]
│   └── logger.js               [Logging]
│
├── renderer/
│   ├── bluetooth-ui.js         [UI pour files]
│   └── ... autres UI
│
├── package.json                [+ multer, chokidar]
├── BLUETOOTH-README.md         [Doc complète]
├── BLUETOOTH-DEPLOYMENT.md     [Guide déploiement]
├── supabase-schema.bluetooth.sql [Schéma DB]
└── test-bluetooth.js           [Script de test]
```

## 🔐 Sécurité du chiffrement

### Format du fichier chiffré

```
[12 bytes IV] + [16 bytes AuthTag] + [Encrypted Data...]

Exemple (hex):
A1B2C3D4E5F6CCCCBBBBAAAA | 12345678901234567890ABCD | {encrypted...}
```

### Flux de chiffrement

```
Fichier original
       │
       ▼
┌──────────────────┐
│ Générer clé      │  → Clé AES-256 (32 bytes)
│ Générer IV       │  → IV 12 bytes (aléatoire)
└──────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ AES-256-GCM Encrypt                  │
│ - Input: fichier + clé + IV          │
│ - Génère: ciphertext + authTag       │
│ - Mode: GCM (Galois/Counter)         │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────┐
│ Format:          │
│ IV + AuthTag +   │  → Fichier chiffré
│ Ciphertext       │  → Stocker avec clé
└──────────────────┘
```

## 📡 Communication IPC (Electron)

### Main Process → Renderer

```javascript
// bluetooth.js détecte fichier ✅
processBTFile(path, (metadata) => {
  mainWindow.webContents.send("bluetooth:file-ready", metadata);
});

// renderer reçoit:
ipcRenderer.on("bluetooth:file-ready", (event, metadata) => {
  console.log("Fichier prêt:", metadata.btId);
});
```

### Renderer → Main Process

```javascript
// Demander l'URL du serveur
const url = await ipcRenderer.invoke("bluetooth:get-url");

// Forcer une sync
await ipcRenderer.invoke("bluetooth:force-sync");

// Lister les fichiers en attente
const result = await ipcRenderer.invoke("bluetooth:get-pending-files");
```

## 🗄️ Schéma Supabase

### Table: bluetooth_files

```sql
┌─────────────────────────────────────────────────┐
│               bluetooth_files                   │
├─────────────────────────────────────────────────┤
│ id (uuid)          → Clé primaire              │
│ bt_id (text)       → bt-reception-{hex}       │
│ original_file_name → nom du fichier original   │
│ storage_path       → chemin S3 (Supabase)      │
│ encryption_key     → Clé AES-256 (hex)       │
│ file_size          → Taille original (bytes)  │
│ file_hash          → SHA-256 du fichier       │
│ received_at        → Timestamp réception      │
│ uploaded_at        → Timestamp upload         │
│ status             → 'uploaded'/'processed'   │
│ printer_id         → FK vers printers         │
│ metadata           → JSON (custom fields)    │
│ created_at         → Timestamp création       │
│ updated_at         → Timestamp modif          │
└─────────────────────────────────────────────────┘

Indexes:
├─ idx_bluetooth_files_bt_id (unique)
├─ idx_bluetooth_files_printer_id
├─ idx_bluetooth_files_received_at (DESC)
└─ idx_bluetooth_files_status
```

### Table: bluetooth_sync_log

```sql
┌─────────────────────────────────────────────────┐
│           bluetooth_sync_log                    │
├─────────────────────────────────────────────────┤
│ id (uuid)          → Clé primaire              │
│ bt_id (text)       → FK bluetooth_files       │
│ action (text)      → 'received'/'encrypted'   │
│                      'uploaded'/'failed'      │
│ status (text)      → 'success'/'failed'       │
│ message (text)     → Message détail           │
│ error_details      → Stack trace si erreur   │
│ created_at         → Timestamp               │
└─────────────────────────────────────────────────┘

Indexes:
├─ idx_bluetooth_sync_log_bt_id
└─ idx_bluetooth_sync_log_created_at (DESC)
```

## 🌐 API HTTP

### Endpoint: POST /bluetooth/upload

```http
POST http://IP:3738/bluetooth/upload HTTP/1.1
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

[fichier binaire]
--boundary--
```

**Response:**

```json
{
  "status": "received",
  "fileName": "document.pdf",
  "size": 2048576,
  "message": "Fichier reçu et en attente de traitement"
}
```

### Endpoint: GET /bluetooth/status

```http
GET http://IP:3738/bluetooth/status HTTP/1.1
```

**Response:**

```json
{
  "status": "ready",
  "server": "Derewol Bluetooth Server"
}
```

## ⏱️ Timeline d'un fichier

```
T+0s    : Fichier envoyé depuis l'appareil
          ↓
T+0-2s  : Réception sur le serveur HTTP
          ↓
T+0-5s  : Chiffrement AES-256
          ↓
T+0-5s  : Sauvegarde local
          ↓
T+30s   : Scan par le service Sync BT
          ↓
T+30-40s: Upload vers Supabase Storage
          ↓
T+30-40s: Insert métadata dans DB
          ↓
T+30-40s: Marquage comme uploaded
          ↓
T+30-40s: Suppression sécurisée du fichier local
          ↓
T+30-40s: ✅ Fin!
```

## 🔄 États d'un fichier

```
Reçu
 ├─ [Chiffrement en cours]
 │  └─ Non accessible
 │
 ├─ [En attente d'upload]
 │  └─ Accessible localement (chiffré)
 │
 ├─ [Upload en cours]
 │  └─ Marqé .uploading
 │
 ├─ [Upload réussi]
 │  └─ Status='uploaded' en DB
 │  └─ Copie .uploaded localement
 │  └─ Suppression du fichier chiffré
 │
 └─ [Archivé/Nettoyé]
    └─ Après 30 jours (configurable)
```

## 📊 Monitoring

### Métriques clés

```sql
-- Fichiers reçus aujourd'hui
SELECT COUNT(*) as daily_count
FROM bluetooth_files
WHERE DATE(received_at) = TODAY();

-- Taille totale en attente
SELECT SUM(file_size) / 1024 / 1024 as pending_mb
FROM bluetooth_files
WHERE status != 'archived';

-- Taux de succès
SELECT
  COUNT(CASE WHEN status='success' THEN 1 END) as successes,
  COUNT(CASE WHEN status='failed' THEN 1 END) as failures,
  ROUND(100.0 * COUNT(CASE WHEN status='success' THEN 1 END) / COUNT(*), 2) as success_rate
FROM bluetooth_sync_log;

-- Fichiers stagnant (> 1 heure non uploadés)
SELECT * FROM bluetooth_files
WHERE status='uploaded'
AND uploaded_at < NOW() - INTERVAL '1 hour';
```

### Alertes

À implémenter:

- ⚠️ Plus de 100 fichiers en attente
- ⚠️ Taux d'erreur > 5%
- ⚠️ Fichier > 500 MB
- ⚠️ Pas de sync depuis > 30 min

## 🎯 Points de test critiques

1. **Chiffrement intègre**
   - Vérifier que IV est unique par fichier ✓
   - Vérifier que authTag n'est pas contourné ✓
   - Tester déchiffrement avec mauvaise clé ✗

2. **Suppression sécurisée**
   - Fichier local supprimé après upload ✓
   - Pas d'accès au fichier après ✓
   - Vérifier écrasement avant suppression ✓

3. **Sync fiable**
   - Retry automatique en cas d'erreur ✓
   - Pas d'uploads en doublons ✓
   - Métadata cohérente avec fichier ✓

4. **Performance**
   - Upload de 10 fichiers < 5 min ✓
   - Pas de blocage de l'UI ✓
   - Mémoire stable (pas de leak) ✓

## ✅ Checklist avant production

- [ ] Master key pour chiffrer les clés
- [ ] RLS restrictive sur les tables
- [ ] HTTPS ou Cloudflare Tunnel
- [ ] Rate limiting sur endpoint HTTP
- [ ] Logging exhaustif des erreurs
- [ ] Alertes monitoring activées
- [ ] Backup régulier Supabase
- [ ] Politique de rétention définie
- [ ] Plan de récupération disaster
- [ ] Documentation mise à jour
