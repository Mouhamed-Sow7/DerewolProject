# 🚀 Début rapide - Bluetooth Derewol

**Temps estimé: 10 minutes**

## 1️⃣ Vérifier Bluetooth

Ouvrez PowerShell et exécutez:

```powershell
Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
```

**Vous devriez voir:**

```
Status      FriendlyName
------      -----------
OK          Bluetooth Radio
```

❌ **Pas de Bluetooth?** → Achetez un dongle USB (~5€) et installez les drivers

## 2️⃣ Configurer Supabase (5 min)

### A. Créer le schéma BD

1. Allez sur https://supabase.com/dashboard
2. Ouvrez votre projet
3. **SQL Editor** → **New Query**
4. Copier le contenu de `supabase-schema.bluetooth.sql`
5. Cliquer **Exécuter**

### B. Récupérer les clés API

1. **Settings** → **API**
2. Copier:
   - `Project URL`
   - `anon public key`

### C. Créer le fichier .env

```bash
# Dans le dossier derewolprint/
cp .env.example .env
```

Modifier `.env` avec vos clés:

```
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_KEY=eyJhbGc...
```

## 3️⃣ Installer (2 min)

```bash
cd derewolprint
npm install
```

## 4️⃣ Tester (3 min)

### Terminal 1: Démarrer l'app

```bash
npm start
```

**Attendez les logs:**

```
[BT-HTTP] Serveur démarré sur 192.168.137.1:3738
[BT] Listener démarré ✅
[BT-SYNC] ✅ Sync démarrée
```

### Terminal 2: Envoyer un fichier

> Important: lancez cette commande depuis le dossier `derewolprint`, pas depuis `D:\workspace\Derewol`.

```bash
cd d:\workspace\Derewol\derewolprint
# Créer un fichier de test
echo "Test" > test.txt

# Envoyer depuis le même PC que l'app Derewol
node test-bluetooth.js test.txt http://localhost:3738
```

Si vous envoyez depuis un autre appareil connecté au même réseau, utilisez l’IP affichée par l’app (`[BT-HTTP] Serveur démarré sur ...`).

**Résultat attendu:**

```
✅ Réponse du serveur:
   Status: received
   Message: Fichier reçu et en attente de traitement
```

## 5️⃣ Vérifier (1 min)

### Vérifier le fichier local chiffré

```bash
ls ~/.derewol/bt-receipts/
```

Vous devriez voir: `bt-reception-xxxxx@test.txt`

### Vérifier la base de données

Dans Supabase **SQL Editor**:

```sql
SELECT * FROM bluetooth_files LIMIT 1;
```

Vous devriez voir 1 ligne avec:

- `bt_id` = `bt-reception-xxxxx`
- `status` = `uploaded`
- `file_hash` = (SHA-256 du fichier)

## ✅ C'est fait!

Votre système Bluetooth fonctionne! 🎉

## 📚 Étape suivante

### Adapter au hotspot existant

Dans `main.js`, dans la fonction `launchApp()`:

```javascript
// Déjà intégré ✅
startBTListener((metadata) => {
  console.log("[APP] Fichier Bluetooth reçu:", metadata.btId);
  if (mainWindow) {
    mainWindow.webContents.send("bluetooth:file-received", metadata);
  }
});

startBTSync();
```

Le serveur Bluetooth démarre automatiquement quand le hotspot démarre.

### Ajouter l'UI

Pour voir les fichiers reçus dans le renderer:

```html
<!-- Dans renderer/index.html -->
<div id="bluetooth-panel"></div>

<script>
  // Charger l'UI Bluetooth
  const { BluetoothUI } = require("./bluetooth-ui.js");
  const btUI = new BluetoothUI();
  btUI.init();

  // Injecter dans le DOM
  document.getElementById("bluetooth-panel").innerHTML =
    BluetoothUI.getTemplate();
</script>
```

## 🔗 Envoyer depuis un autre appareil

Une fois le hotspot actif:

```bash
# Depuis n'importe quel PC/Phone connecté au hotspot Derewol

# 1. Trouver l'IP du serveur
ping derewol-pc

# 2. Envoyer un fichier (cURL)
curl -X POST \
  -F "file=@photo.jpg" \
  http://192.168.137.1:3738/bluetooth/upload

# 3. Fichier reçu immédiatement et visible en DB ✅
```

## 📖 Documentation complète

Pour plus de détails, voir:

- `BLUETOOTH-README.md` - Fonctionnalités complètes
- `BLUETOOTH-DEPLOYMENT.md` - Guide déploiement producti
- `BLUETOOTH-ARCHITECTURE.md` - Architecture technique
- `.env.example` - Configuration

## ❌ Problèmes courants

### "Connection refused" au envoi

```bash
# Solution:
# 1. Vérifier que npm start est toujours actif
# 2. Vérifier l'IP correcte: ipconfig
# 3. Vérifier le firewall Windows autorise port 3738
```

### Le fichier n'apparaît pas en DB après 30s

```bash
# 1. Vérifier les logs dans Terminal 1: y-a-t-il des erreurs [BT-SYNC]?
# 2. Vérifier Supabase URL et clé en .env
# 3. Forcer une sync: depuis l'app UI (Forcer sync)
```

### Fichier local pas supprimé

```bash
# Cette fonction est à la fin du processus
# Attendre 40+ secondes minimum
# Sinon: Permission denied = redémarrer l'app
```

## 🎯 Cas d'usage

Une fois en prod:

1. **Imprimeur reçoit des fichiers via Bluetooth**

   ```
   Appareil (PDF) → Bluetooth → PC → Chiffré → Supabase
   ```

2. **Historique sauvegardé**

   ```
   SELECT * FROM bluetooth_files WHERE printer_id = 'xxxx';
   ```

3. **Suppression sécurisée locale**
   ```
   Fichier chiffré écrasé + supprimé après upload
   ```

## 🚨 Production checklist

Avant de mettre en prod:

- [ ] Master key pour chiffrer les clés (voir `.env.example`)
- [ ] RLS Supabase configué
- [ ] HTTPS activé (Cloudflare Tunnel)
- [ ] Rate limiting sur endpoint HTTP
- [ ] Logs monitoring en place
- [ ] Backup Supabase configuré

**Voir:** `BLUETOOTH-DEPLOYMENT.md` → "Sécurité"

---

**Des questions?** Lire `BLUETOOTH-README.md` ou ouvrir une issue! 🎯
