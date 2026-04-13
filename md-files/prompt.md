# DerewolPrint Bluetooth UI - Résumé Complet des Modifications

## 📋 Contexte Initial

L'application `DerewolPrint` est une application Electron avec une interface PWA web. Elle utilise:

- **Frontend**: Next.js avec React, hébergé dans `pages/` et `renderer/`
- **Backend**: Electron main process avec services dans `derewolprint/`
- **Stockage**: Supabase pour la synchronisation des fichiers
- **Sécurité**: Chiffrement AES-256-GCM et contextBridge Electron pour IPC sécurisé

## 🎯 Problème Identifié

L'utilisateur rapportait que:

1. **Aucun fichier Bluetooth ne s'affiche** malgré un upload réussi via HTTP
2. **Métadonnées manquantes** pour les fichiers Bluetooth (clés de chiffrement, IV, hash)
3. **Les changements dans bluetooth-ui.js ne s'appliquaient pas** au dossier renderer
4. **CSP violations** bloquant l'exécution des inline event handlers
5. **Styling inadapté** - l'interface Bluetooth ne correspondait pas au design DerewolPrint

## 🔧 Solutions Implémentées

### 1. **Intégration du Panneau Bluetooth dans index.html**

**Fichier**: `derewolprint/renderer/index.html`

**Changement**:

- Ajout d'un conteneur vide: `<div id="bluetooth-panel"></div>`
- Import du script: `<script src="bluetooth-ui.js"></script>`

**Raison**: Le HTML n'avait pas d'emplacement pour injecter l'interface Bluetooth. Le script bluetooth-ui.js était complètement ignoré par le renderer.

---

### 2. **Exposition des APIs Bluetooth via Preload Script**

**Fichier**: `derewolprint/preload/preload.js`

**Changements**:

```javascript
// Ajout de 4 APIs Bluetooth exposées via contextBridge
window.derewol.bluetoothGetUrl(); // Récupère l'URL du serveur BT
window.derewol.bluetoothStartServer(); // Démarre le serveur HTTP BT
window.derewol.bluetoothGetPendingFiles(); // Liste les fichiers en attente
window.derewol.bluetoothForceSync(); // Force la synchronisation
window.derewol.bluetoothStopServer(); // Arrête le serveur

window.derewol.onBluetoothFileReady(); // Listener: fichier chiffré et prêt
window.derewol.onBluetoothFileReceived(); // Listener: fichier reçu
```

**Raison**: Le renderer Electron ne peut pas utiliser `require("electron")` directement (CSP et sécurité). Les APIs doivent passer par le preload script avec IPC sécurisé.

---

### 3. **Suppression du `require("electron")` dans bluetooth-ui.js**

**Fichier**: `derewolprint/renderer/bluetooth-ui.js`

**Avant**:

```javascript
const { ipcRenderer } = require("electron");
// Utilisation directe: ipcRenderer.invoke(...)
```

**Après**:

```javascript
// Utilisation via window.derewol exposé par preload
window.derewol.bluetoothGetUrl();
window.derewol.bluetoothStartServer();
```

**Raison**: Le code causait `ReferenceError: require is not defined` en contexte renderer. Les appels IPC doivent passer par le preload script pour respecter la sécurité Electron et la CSP.

---

### 4. **Création de Fichiers Métadonnées pour Files Bluetooth**

**Fichiers créés**: `derewolprint/data/<fileName>.json`

**Exemple**:

```json
{
  "btId": "bt-reception-2214232a@CV_Seydou_SOW",
  "originalFileName": "CV_Seydou_SOW.pdf",
  "fileHash": "sha256hash...",
  "encryption": {
    "key": "base64encodedkey",
    "iv": "base64encodediv",
    "algorithm": "aes-256-gcm"
  },
  "receivedAt": "2026-04-06T13:04:26.000Z",
  "status": "pending"
}
```

**Raison**: Le service de synchronisation Supabase n'avait aucune metadata pour déchiffrer les fichiers. Ces fichiers `.json` sidecar permettent au système de connaître les clés de chiffrement et les hashs pour valider les fichiers reçus.

---

### 5. **Remplacement des Inline Event Handlers par Event Listeners**

**Fichier**: `derewolprint/renderer/bluetooth-ui.js`

**Avant (CSP violation)**:

```html
<button onclick="btUI.copyUrl()">
  <i class="fa-solid fa-copy"></i> Copier
</button>
<button onclick="btUI.forceSync()" class="btn-primary">...</button>
```

**Après (Valide avec CSP)**:

```html
<button id="bt-copy-url"><i class="fa-solid fa-copy"></i> Copier</button>
<button id="bt-force-sync" class="btn-primary">...</button>

<!-- Dans setupButtonListeners() -->
document.getElementById("bt-copy-url").addEventListener("click", () =>
this.copyUrl());
document.getElementById("bt-force-sync").addEventListener("click", () =>
this.forceSync());
```

**Raison**: La CSP définie dans `index.html` bloque `script-src: 'self' https://cdnjs.cloudflare.com` sans `'unsafe-inline'`. Les inline event handlers violaient cette politique et étaient bloqués.

---

### 6. **Refonte du Template Bluetooth pour Correspondre au Design DerewolPrint**

**Fichier**: `derewolprint/renderer/bluetooth-ui.js` - `getTemplate()`

**Avant**:

- Panneau generic avec styling inline
- Boutons "Forcer synchronisation" et "Arrêter serveur" inutilisés
- Layout personnalisé sans cohérence avec l'app

**Après**:

```html
<div class="job-card bt-card">
  <div class="job-card-header">
    <div class="job-card-header-left">
      <span class="job-client-id"
        ><i class="fa-brands fa-bluetooth"></i> Réception Bluetooth</span
      >
      <div class="job-time">
        Les fichiers reçus par Bluetooth apparaissent ici
      </div>
    </div>
    <div class="job-actions">
      <span class="badge" id="bt-count">0 fichiers</span>
    </div>
  </div>

  <div class="bt-info">
    <!-- URL et info de partage -->
  </div>

  <div class="job-files-list">
    <!-- Liste des fichiers -->
  </div>
</div>
```

**Raison**: Réutilisation des classes CSS existantes (`.job-card`, `.file-row`, `.badge`, `.job-time`) pour une cohérence visuelle complète avec le reste de DerewolPrint.

---

### 7. **Implémentation du Système de Quantités (Copies)**

**Fichier**: `derewolprint/renderer/bluetooth-ui.js` - `updateUI()`

**Changement**:

```javascript
// Chaque fichier Bluetooth utilise le système de copies de print
<span class="copies-count">1</span>

// Structure identique aux jobs d'impression
<div class="file-row">
  <div class="file-row-name-wrap">
    <span class="file-row-icon"><i class="fa-solid fa-file-pdf"></i></span>
    <div>
      <div class="file-row-name">${f.fileName}</div>
      <div class="job-time">${size} KB • ${time}</div>
    </div>
  </div>
  <div class="file-row-right">
    <span class="copies-count">1</span>
    <span class="status ${f.status}">...</span>
  </div>
</div>
```

**Raison**: Les fichiers Bluetooth affichent maintenant "1" copie par défaut, en utilisant les mêmes composants que les jobs d'impression pour une UI cohérente.

---

### 8. **Ajout des Styles CSS Bluetooth à renderer.css**

**Fichier**: `derewolprint/renderer/renderer.css`

**Styles ajoutés**:

```css
#bluetooth-panel {
  /* Réutilise .job-card */
}

.bt-info {
  background: var(--bg);
  padding: 12px;
  border-radius: 4px;
  margin: 12px 0;
  border: 1px solid var(--border);
}

.bt-info code {
  font-family: monospace;
  background: var(--surface);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--text);
}

.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
}

.status.pending {
  background: #fff3cd;
  color: #856404;
}

.status.uploading {
  background: #d1ecf1;
  color: #0c5460;
}

.status.uploaded {
  background: #d4edda;
  color: #155724;
}

/* Dark mode support */
body.dark-mode .status.pending {
  background: #4d3d1a;
  color: #f5c842;
}
```

**Raison**: Les styles utilisent les variables CSS existantes (`--bg`, `--text`, `--border`, `--surface`) pour respecter le thème clair/sombre de DerewolPrint.

---

## 📊 État Actuel du Flux Bluetooth

### 1. **Réception du Fichier**

```
Client → HTTP POST /upload → Serveur BT (express)
                    ↓
         Fichier stocké + métadonnées JSON créées
                    ↓
         Événement 'fileReceived' émis au renderer
                    ↓
         btUI.onFileReceived() → affiche notification + ajoute fichier
```

### 2. **Chiffrement**

```
Fichier reçu → Chiffrement AES-256-GCM
                    ↓
         Métadonnées (clés, IV) stockées dans .json
                    ↓
         Événement 'fileReady' émis
                    ↓
         btUI.onFileReady() → notification "prêt pour sync"
```

### 3. **Affichage dans l'UI**

```
btUI.refreshPendingFiles() → Récupère list via IPC
                    ↓
         Filtre les fichiers (exclude .json)
                    ↓
         Rendu avec .file-row style (comme jobs d'impression)
                    ↓
         Affichage des status: En attente de sync / Upload en cours / Synchronisé
```

### 4. **Synchronisation**

```
btUI.forceSync() → window.derewol.bluetoothForceSync()
                    ↓
         IPC → Main process → Supabase upload
                    ↓
         Status du fichier mis à jour
                    ↓
         UI auto-refresh toutes les 5s
```

---

## 🔐 Architecture de Sécurité

### Electron IPC Sécurisé

```
Renderer (bluetooth-ui.js)
    ↓
window.derewol.bluetoothGetUrl()
    ↓
ContextBridge (preload.js)
    ↓
ipcMain.handle() (main.js)
    ↓
Services Bluetooth (services/bluetooth.js)
```

### Content Security Policy

```
default-src 'self'
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com
script-src 'self' https://cdnjs.cloudflare.com
```

→ Pas `'unsafe-inline'` pour scripts, donc les event listeners doivent être attachés programmatiquement.

---

## 🎨 Cohérence Visuelle

### Classes CSS Réutilisées

| Élément          | Classe             | Source            |
| ---------------- | ------------------ | ----------------- |
| Panneau          | `.job-card`        | Jobs d'impression |
| Header           | `.job-card-header` | Jobs d'impression |
| Fichiers         | `.file-row`        | Jobs d'impression |
| Statuts          | `.status`          | Jobs d'impression |
| Badges           | `.badge`           | Top bar           |
| Texte secondaire | `.job-time`        | Jobs d'impression |

### Couleurs et Variables

```css
--vert: #1e4d2b /* Principal */ --jaune: #f5c842 /* Accent (Copier, Print) */
  --noir: #111510 /* Texte */ --blanc: #faf8f2 /* Fond clair */
  --text: var(--text-color) /* Adaptatif */ --border: var(--border-color)
  /* Adaptatif */;
```

---

## 📁 Fichiers Modifiés

### Créés/Modifiés

1. **`derewolprint/renderer/index.html`**
   - Container `<div id="bluetooth-panel"></div>`
   - Import `<script src="bluetooth-ui.js"></script>`

2. **`derewolprint/preload/preload.js`**
   - 7 APIs exposées via `contextBridge.exposeInMainWorld()`
   - IPC listeners pour events Bluetooth

3. **`derewolprint/renderer/bluetooth-ui.js`**
   - Suppression de `require("electron")`
   - Migration vers `window.derewol` API calls
   - Remplacement des inline handlers par `addEventListener()`
   - Template refactorisé avec classes `.job-card`, `.file-row`
   - Système de quantités (copies count = 1 par défaut)

4. **`derewolprint/renderer/renderer.css`**
   - Ajout de 50+ lignes de styles Bluetooth
   - Support du dark mode avec couleurs cohérentes
   - `.bt-info`, `.status.pending/uploading/uploaded`, etc.

5. **`derewolprint/data/<fileName>.json`** (multiples)
   - Fichiers métadonnées avec clés de chiffrement
   - Format: btId, originalFileName, fileHash, encryption config

---

## ⚠️ Erreurs Résolues

### 1. "require is not defined"

- **Cause**: Direct `require("electron")` en contexte renderer
- **Solution**: Utiliser `window.derewol` exposé par preload

### 2. "CSP directive violated"

- **Cause**: Inline `onclick="btUI.copyUrl()"`
- **Solution**: Event listeners attachés programmatiquement

### 3. "Bluetooth panel not rendering"

- **Cause**: Pas de container `#bluetooth-panel` dans le DOM
- **Solution**: Ajout du `<div id="bluetooth-panel"></div>` dans index.html

### 4. "Fichiers Bluetooth impossibles à synchroniser"

- **Cause**: Métadonnées manquantes (clés de chiffrement)
- **Solution**: Création de fichiers `.json` sidecar avec encryption config

### 5. "Design ne correspondant pas à l'app"

- **Cause**: Styling custom générique
- **Solution**: Réutilisation des classes `.job-card`, `.file-row`, `.badge` existantes

---

## 🚀 Fonctionnalités Finales

✅ Panneau Bluetooth intégré dans la vue Jobs
✅ Affichage des fichiers en attente de synchronisation
✅ Statuts: "En attente de sync" / "Upload en cours" / "Synchronisé"
✅ URLs de partage avec bouton Copier (sans inline handlers)
✅ Auto-refresh toutes les 5 secondes
✅ Notifications pour receptions et erreurs
✅ Support du dark mode
✅ Interface cohérente avec DerewolPrint
✅ Système de quantités par défaut (1 copie)
✅ Métadonnées chiffrées stockées localement

---

## 🔍 Vérification de l'Installation

Pour vérifier que tous les changements sont en place:

```bash
cd derewolprint
npm start
```

Puis vérifier:

1. ✅ Panneau Bluetooth visible dans la section "Jobs en attente"
2. ✅ Format identique aux jobs d'impression (card + file rows)
3. ✅ Fichiers testés via: `node test-bluetooth.js <file.pdf> http://localhost:3738`
4. ✅ Status badges colorées (jaune=attente, bleu=uploading, vert=synced)
5. ✅ Pas d'erreurs CSP dans la console
6. ✅ Notifications s'affichent correctement

---

## 📝 Notes de Maintenance

- **IPC Handlers**: Définis dans `derewolprint/main/main.js`
- **Métadonnées**: Stockées dans `derewolprint/data/` avec pattern `<btId>.json`
- **Chiffrement**: AES-256-GCM avec IV aléatoire par fichier
- **Supabase Sync**: Déclenché via `forceSync()` ou auto-poll toutes les 5s
- **CSS Palette**: Utilise CSS variables pour compatibilité thème clair/sombre
- **Dark Mode**: Contrôlé par classe `body.dark-mode` (voir `styles/globals.css`)
