# 🚀 Guide de déploiement - Système Bluetooth Derewol

Guide complet pour mettre en place et tester le système Bluetooth.

## 📋 Checklist de déploiement

### Phase 1: Préparation (5 min)

- [ ] Vérifier que le PC a Bluetooth intégré ou dongle USB
- [ ] Vérifier la version Node.js: `node -v` (14+)
- [ ] Supabase: Copier URL et clé API
- [ ] Git: Cloner/pull la dernière version

### Phase 2: Configuration Supabase (5 min)

- [ ] Accéder au SQL Editor de Supabase
- [ ] Exécuter le script: `supabase-schema.bluetooth.sql`
- [ ] Vérifier les tables: `bluetooth_files` et `bluetooth_sync_log`
- [ ] Créer le bucket Storage: `bluetooth-files`

### Phase 3: Installation (5 min)

- [ ] `cd derewolprint && npm install`
- [ ] Vérifier les dépendances: `npm list`
- [ ] Vérifier `.env`: SUPABASE_URL et SUPABASE_KEY

### Phase 4: Test local (10 min)

- [ ] Démarrer l'app: `npm start`
- [ ] Vérifier les logs: "BT-HTTP Serveur démarré"
- [ ] Envoyer un fichier de test

### Phase 5: Validation

- [ ] ✅ Fichier reçu local
- [ ] ✅ Fichier chiffré
- [ ] ✅ Upload Supabase
- [ ] ✅ Fichier local supprimé
- [ ] ✅ Métadata en DB

## 🔧 Installation détaillée

### 1. Dépendances système

**Windows:**

```bash
# Vérifier Bluetooth
Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}

# Résultat attendu:
# Status      FriendlyName
# OK          Bluetooth Radio
```

**Si pas de Bluetooth:**

- Acheter un dongle USB Bluetooth (~5€)
- Installer les drivers du constructeur

### 2. Configuration Supabase

Allez sur: **https://supabase.com/dashboard**

1. Ouvrez votre projet
2. **SQL Editor** → **New Query**
3. Copiez le contenu de `supabase-schema.bluetooth.sql`
4. Exécutez
5. Vérifiez: **Table Editor** → cherchez `bluetooth_files`

### 3. Installation Node

```bash
# Naviguer au bon dossier
cd d:\workspace\Derewol\derewolprint

# Installer les dépendances
npm install

# Vérifier
npm list | grep -E "(chokidar|multer|@supabase)"
```

Dépendances attendues:

```
├── @supabase/supabase-js@2.97.0
├── chokidar@3.5.3
├── multer@1.4.5-lts.1
└── ... autres deps
```

### 4. Variables d'environnement

Créer/modifier `.env` dans `derewolprint/`:

```env
# Supabase
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...

# Optionnel
NODE_ENV=development
DEBUG=derewol:*
```

**Pour trouver ces valeurs:**

1. Supabase Dashboard
2. **Settings** → **API**
3. Copier: Project URL et anon public key

### 5. Test du serveur HTTP

**Terminal 1 - Démarrer l'app:**

```bash
npm start
```

Logs attendus:

```
[LOCAL] Dossier PWA introuvable...
[BOOT] Configuration locale...
[BT-HTTP] Serveur démarré sur 192.168.137.1:3738
[BT] Listener démarré ✅
[BT-SYNC] ✅ Sync démarrée
```

**Terminal 2 - Envoyer un fichier:**

```bash
# Créer un fichier de test
echo "Test Bluetooth" > test.txt

# Envoyer
node test-bluetooth.js test.txt http://192.168.137.1:3738
```

Vous devriez voir:

```
📤 Envoi du fichier:
   Nom: test.txt
   Taille: 0.01 KB
   Vers: http://192.168.137.1:3738/bluetooth/upload

✅ Réponse du serveur:
   Status: received
   Message: Fichier reçu et en attente de traitement
   Size received: 14 bytes
```

## 🧪 Tests complets

### Test 1: Fichier local chiffré

```bash
# 1. Envoyer un fichier
node test-bluetooth.js report.pdf http://192.168.137.1:3738

# 2. Vérifier le fichier local
ls ~/.derewol/bt-receipts/

# Résultat: bt-reception-xxxxx@report.pdf
```

### Test 2: Upload Supabase

```bash
# 1. Attendre 30+ secondes (intervalle sync)

# 2. Vérifier la DB (SQL Editor):
SELECT * FROM bluetooth_files LIMIT 5;

# Résultat: 1 ligne avec bt_id, original_file_name, etc.
```

### Test 3: Suppression sécurisée

```bash
# 1. Envoyer un fichier et attendre sync

# 2. Vérifier que le fichier local est supprimé:
ls ~/.derewol/bt-receipts/

# Résultat: vide ou seulement des fichiers .uploaded
```

### Test 4: Métadata complète

```sql
-- Vérifier tous les détails
SELECT
  bt_id,
  original_file_name,
  file_size,
  file_hash,
  status,
  created_at
FROM bluetooth_files
ORDER BY created_at DESC
LIMIT 1;
```

### Test 5: Historique sync

```sql
-- Voir le chemin complet d'un fichier
SELECT
  bt_id,
  action,
  status,
  created_at
FROM bluetooth_sync_log
WHERE bt_id LIKE 'bt-reception-%'
ORDER BY created_at DESC
LIMIT 10;
```

## 🐛 Troubleshooting

### ❌ Erreur: "Port 3738 already in use"

```bash
# Trouver le processus
netstat -ano | findstr :3738

# Forcer fermeture (remplacer PID)
taskkill /PID 1234 /F

# Ou: changez le port dans localServer.js (ligne: const PORT_BT = 3738)
```

### ❌ Erreur: "Bucket 'bluetooth-files' not found"

```bash
# Créer manuellement dans Supabase:
# 1. Storage → New bucket
# 2. Name: bluetooth-files
# 3. Private: oui
# 4. Créer
```

### ❌ Fichier reçu mais pas uploadé

Causes probables:

1. **Pas internet** → Vérifier WiFi
2. **Clés Supabase invalides** → Vérifier `.env`
3. **Sync arrêtée** → Vérifier les logs "[BT-SYNC]"
4. **Fichier trop gros** → Max 100 MB (configurable)

Solutions:

```bash
# Forcer sync immédiate (depuis l'app)
await ipcRenderer.invoke('bluetooth:force-sync');

# Ou depuis Node.js:
node -e "
const { forceBTSync } = require('./services/bluetoothSync');
forceBTSync().then(() => console.log('Done'));
"
```

### ❌ Déchiffrement échoue

```bash
# Vérifier la clé en DB
SELECT bt_id, encryption_key FROM bluetooth_files LIMIT 1;

# Si format invalide (pas du hex):
# Regénérer le fichier en le renvoyant
```

### ❌ Fichier local pas supprimé

Causes:

1. Upload échoué → Vérifier les logs
2. Permission denied → Vérifier droits d'accès
3. Fichier verrouillé → Redémarrer l'app

### ❌ Serveur HTTP pas accessible

```bash
# 1. Vérifier que l'app est lancée
# 2. Vérifier l'IP:
ipconfig | findstr "IPv4"

# 3. Depuis un autre PC:
curl http://192.168.137.1:3738/bluetooth/status

# 4. Si erreur "Connection refused":
#    - Firewall bloque le port
#    - Ajouter exception: 3738 TCP
```

## 📊 Monitoring en production

### Logs importants

```bash
# Voir les logs en temps réel (Windows):
wsl cat ~/.derewol/logs/*.log

# Ou sur Mac/Linux:
tail -f ~/.derewol/logs/*.log
```

### Métriques

```bash
# Nombre de fichiers en attente
SELECT COUNT(*) FROM bluetooth_files WHERE status = 'uploaded';

# Espace occupé par les fichiers chiffrés
SELECT SUM(file_size) / 1024 / 1024 AS total_mb FROM bluetooth_files;

# Taux d'erreur
SELECT status, COUNT(*) FROM bluetooth_files GROUP BY status;
```

### Alertes

À implémenter:

```javascript
// Exemple: Alerte si Plus de 100 fichiers en attente
const result = await supabase
  .from("bluetooth_files")
  .select("COUNT(*)")
  .eq("status", "uploaded");

if (result.count > 100) {
  console.warn("⚠️  100+ fichiers en attente!");
  // Envoyer alerte email/SMS
}
```

## 🔒 Sécurité

### Checklist sécurité

- [ ] `.env` n'est pas en git (`git check-ignore .env`)
- [ ] Rôles RLS configurés dans Supabase
- [ ] Chiffrage de la clé implémenté (voir TODO)
- [ ] HTTPS en production (utiliser nginx/cloudflare)
- [ ] Rate limiting sur l'endpoint HTTP
- [ ] Validation de la taille de fichier
- [ ] Logs d'accès aux fichiers sensibles

### À implémenter avant production

1. **Master key pour chiffrer les clés**

```javascript
const masterKey = process.env.ENCRYPTION_MASTER_KEY;
const encryptedKey = encrypt(fileKey, masterKey);
// Stocker encryptedKey en DB au lieu de key
```

2. **RLS stricter**

```sql
-- Voir fichiers BT uniquement via app
CREATE POLICY "Only app can access BT files" ON bluetooth_files
  USING (current_user_id() = 'app-user-id');
```

3. **HTTPS/TLS**

```bash
# Utiliser nginx en reverse proxy avec certificat SSL
# Ou Cloudflare Tunnel pour sortir du PC
```

## 📈 Performance

### Optimisations possibles

1. **Compression avant upload**

```javascript
const gzip = require("zlib");
const compressed = gzip.gzipSync(fileBuffer);
```

2. **Uploads en parallèle** (max 3)

```javascript
const pLimit = require("p-limit");
const limit = pLimit(3);
// Faire les uploads avec limit
```

3. **Cache local**

```javascript
// Garder les métadata des derniers fichiers en RAM
const fileCache = new Map();
```

## 📞 Support

### Pour déboguer:

1. **Activer logs détaillés**

```javascript
// Dans bluetooth.js
console.log("[BT-DEBUG]", ...args);
```

2. **Exporter les logs**

```bash
cp ~/.derewol/logs/derewol-*.log ~/Desktop/
```

3. **Créer une issue** avec:

- Logs complets
- OS (Windows/Mac/Linux)
- Version Node.js
- Taille du fichier en test
- Message d'erreur exact

## ✅ Validation finale

Après le déploiement:

```bash
# 1. Test de réception
node test-bluetooth.js test.pdf http://[IP]:3738

# 2. Attendre 30s, vérifier DB
SELECT COUNT(*) FROM bluetooth_files;

# 3. Vérifier chiffrement
SELECT size(encryption_key) FROM bluetooth_files LIMIT 1;
# Résultat: 64 (32 bytes = 64 hex chars)

# 4. Vérifier suppression locale
ls ~/.derewol/bt-receipts/ | wc -l
# Résultat: 0 ou très peu

# ✅ Tout OK!
```

## 🎉 Fin!

Bravo! Votre système Bluetooth est déployé. Vous pouvez maintenant:

1. Envoyer des fichiers via Bluetooth/HTTP
2. Ils sont chiffrés localement
3. Uploadés vers Supabase
4. Supprimés sécurisément
5. Historique en DB

Pour questions: Consultez `BLUETOOTH-README.md`
