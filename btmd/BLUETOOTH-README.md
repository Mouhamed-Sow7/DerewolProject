# 📱 Système Bluetooth - Derewol

Réception sécurisée de fichiers via Bluetooth avec chiffrement AES-256 et sync automatique vers Supabase.

## 🎯 Fonctionnalités

- ✅ **Réception Bluetooth** - Fichiers reçus sur le PC via Bluetooth (OBEX FTP)
- 🔐 **Chiffrement AES-256** - Tous les fichiers sont chiffrés localement
- 📤 **Upload Supabase** - Sync automatique vers Supabase Storage
- 🗑️ **Suppression Sécurisée** - Les fichiers locaux sont écrasés avant suppression
- 🔄 **Sync Automatique** - Vérification toutes les 30 secondes
- 📝 **Historique** - Métadata enregistrée dans la table `bluetooth_files`

## 🏗️ Architecture

```
Bluetooth Input (HTTP API) → Dossier Local (chiffré) → Supabase Storage
                          ↓
                    Métadata DB
                          ↓
                    Suppression sécurisée
```

### Dossiers locaux

- `~/.derewol/bt-receipts/` - Fichiers chiffrés en attente d'upload
- `~/.derewol/bt-processing/` - Fichiers en cours de traitement
- `~/.derewol/bt-tmp/` - Fichiers temporaires HTTP

### Format du nom de fichier

Les fichiers reçus sont nommés:

```
bt-reception-{8-hex-chars}@{original-filename}
```

Exemple: `bt-reception-a1b2c3d4@document.pdf`

## 🚀 Setup

### 1. Prérequis

- Bluetooth intégré ou dongle USB sur le PC
- Node.js 14+
- Supabase (gratuit suffit)

### 2. Vérifier le Bluetooth sur Windows

```powershell
Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"} | Select-Object Status, FriendlyName
```

Vous devriez voir quelque chose comme:

```
Status      FriendlyName
------      -----------
OK          Bluetooth Radio
```

### 3. Configurer Supabase

Exécuter le script SQL dans l'interface Supabase:

```bash
# Copiez le contenu de:
supabase-schema.bluetooth.sql
```

Allez sur: **Supabase Dashboard → SQL Editor → Nouveau Query**

Puis copiez-collez et exécutez.

### 4. Installer les dépendances

```bash
cd derewolprint
npm install
```

### 5. Variables d'environnement

Vérifiez que vous avez dans `.env`:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=xxxxx
```

## 📡 Utilisation

### Démarrer le serveur Bluetooth

Le serveur démarre automatiquement quand l'app Electron se lance.

Vous pouvez aussi le démarrer manuellement via IPC:

```javascript
// Dans le renderer
ipcRenderer.invoke("bluetooth:start-server").then((result) => {
  console.log("Serveur BT démarré sur:", result.ip, ":", result.port);
});
```

### Envoyer un fichier par HTTP

Endpoint: `POST http://PC-IP:3738/bluetooth/upload`

```bash
curl -X POST \
  -F "file=@/chemin/vers/fichier.pdf" \
  http://192.168.137.1:3738/bluetooth/upload
```

### Réception Bluetooth native

Pour utiliser le Bluetooth natif du PC (OBEX):

1. Sur l'appareil émetteur, faire "Envoyer fichier via Bluetooth"
2. Sélectionner le PC dans la liste des appareils
3. La réception se fait automatiquement dans `~/.derewol/bt-receipts/`

### Vérifier la sync

```javascript
// Récupérer les fichiers en attente
ipcRenderer.invoke("bluetooth:get-pending-files").then((result) => {
  console.log("Fichiers en attente:", result.files);
});

// Forcer une sync immédiate
ipcRenderer.invoke("bluetooth:force-sync").then(() => {
  console.log("Sync forcée");
});
```

## 🔐 Sécurité

### Chiffrement

- **Algorithme**: AES-256-GCM (Galois/Counter Mode)
- **Clé**: 256 bits aléatoires générés pour chaque fichier
- **IV**: 12 octets aléatoires (aléatoires pour chaque fichier)
- **Format**: IV (12) + AuthTag (16) + Encrypted Data

### Stockage de la clé

⚠️ **IMPORTANT**: La clé est stockée en clair dans la DB pour l'instant.

**À faire en production:**

- Chiffrer la clé avec une clé maître stockée en variables d'environnement
- Utiliser Vault.js ou similaire
- Implémenter RLS stricte

```javascript
// Exemple de chiffrement de clé (à implémenter)
const masterKey = process.env.ENCRYPTION_MASTER_KEY;
const encryptedKey = encryptWithMasterKey(encryptionKey, masterKey);
```

### Suppression sécurisée

Les fichiers sont écrasés 3 fois avec:

1. Zéros (0x00)
2. Uns (0xFF)
3. Données aléatoires

(Actuellement: zéros uniquement - à implémenter)

## 🛠️ API IPC (Electron)

### bluetooth:get-url

Récupère l'URL du serveur Bluetooth HTTP

```javascript
const btUrl = await ipcRenderer.invoke("bluetooth:get-url");
// 'http://192.168.137.1:3738'
```

### bluetooth:start-server

Démarre le serveur HTTP Bluetooth

```javascript
const result = await ipcRenderer.invoke("bluetooth:start-server");
// { port: 3738, ip: '192.168.137.1' }
```

### bluetooth:stop-server

Arrête le serveur Bluetooth

```javascript
await ipcRenderer.invoke("bluetooth:stop-server");
```

### bluetooth:get-pending-files

Récupère la liste des fichiers en attente d'upload

```javascript
const { files } = await ipcRenderer.invoke("bluetooth:get-pending-files");
// [{ fileName, createdAt, size }, ...]
```

### bluetooth:force-sync

Force une sync immédiate vers Supabase

```javascript
await ipcRenderer.invoke("bluetooth:force-sync");
```

## 📊 Base de données

### Table: bluetooth_files

```sql
SELECT * FROM bluetooth_files;
```

Colonnes:

- `bt_id` - ID unique du fichier BT
- `original_file_name` - Nom du fichier original
- `storage_path` - Chemin dans Supabase Storage
- `encryption_key` - Clé AES-256 (hex)
- `file_size` - Taille du fichier original
- `file_hash` - SHA-256 du fichier
- `received_at` - Timestamp de réception
- `uploaded_at` - Timestamp d'upload
- `status` - 'uploaded', 'processed', 'archived'
- `printer_id` - Référence à l'imprimeur (optionnel)

### Table: bluetooth_sync_log

Historique complet de chaque fichier:

```sql
SELECT * FROM bluetooth_sync_log WHERE bt_id = 'bt-reception-a1b2c3d4';
```

## 🐛 Dépannage

### Le serveur Bluetooth ne démarre pas

```javascript
// Vérifiez les logs
[BT-HTTP] Serveur démarré sur 192.168.137.1:3738

// Si erreur "Port already in use":
// Attendez 60s et réessayez, ou changez le PORT dans localServer.js
```

### Fichiers ne remontent pas à Supabase

Vérifiez:

1. Connexion internet
2. Clés Supabase correctes dans `.env`
3. Bucket `bluetooth-files` existe
4. Fichier a bien été créé: `ls ~/.derewol/bt-receipts/`

### Clé de chiffrement invalide

Si erreur "Déchiffrement échoué":

1. Vérifiez la clé en base de données
2. Essayez de télécharger le fichier enregistré
3. Regardez les logs Supabase

## 🔧 Configuration avancée

### Modifier l'intervalle de sync

Dans `services/bluetoothSync.js`:

```javascript
const SYNC_INTERVAL = 30000; // 30 secondes
// Changez à, ex: 10000 pour 10 secondes
```

### Augmenter la limite de taille de fichier

Dans `localServer.js`:

```javascript
fileSizeLimit: 100000000, // 100 MB
```

### Logs détaillés

Tous les logs incluent un préfixe:

- `[BT]` - Service Bluetooth principal
- `[BT-HTTP]` - Serveur HTTP
- `[BT-SYNC]` - Sync Supabase
- `[CRYPTO]` - Chiffrement/déchiffrement

## 📝 Exemple complet

### Envoyer un fichier

```bash
# 1. Trouver l'IP du serveur
curl http://192.168.137.x/bluetooth/status

# 2. Envoyer le fichier
curl -X POST \
  -F "file=@report.pdf" \
  http://192.168.137.1:3738/bluetooth/upload

# Réponse:
# {
#   "status": "received",
#   "fileName": "report.pdf",
#   "size": 2048576,
#   "message": "Fichier reçu et en attente de traitement"
# }
```

### Vérifier dans l'app

```javascript
// Dans le renderer/ui.js
const result = await ipcRenderer.invoke("bluetooth:get-pending-files");
console.log(result.files); // Voir les fichiers en traitement

// Attendre 30s pour la sync
setTimeout(() => {
  // Vérifier la DB: SELECT * FROM bluetooth_files WHERE status='uploaded';
}, 30000);
```

## 🎯 Plan futur

- [ ] Support OBEX FTP natif via `@abandonware/node-bluetooth-serial-port`
- [ ] Chiffrement de la clé avec master key
- [ ] Suppression multi-pass (DoD 5220.22-M)
- [ ] Web UI pour voir l'historique Bluetooth
- [ ] Notifications quand fichier uploadé
- [ ] Support des dossiers compressés
- [ ] Rate limiting HTTP
- [ ] Authentification token pour l'endpoint HTTP

## 📞 Support

Pour toute question ou bug:

1. Vérifiez les logs: `.derewol/logs/`
2. Consultez cette doc
3. Créez une issue sur le repo
