# 📚 Index - Documentation Bluetooth Derewol

## 🎯 Par où commencer?

### 👤 Pour les utilisateurs

1. **[BLUETOOTH-QUICKSTART.md](BLUETOOTH-QUICKSTART.md)** ⭐⭐⭐
   - 5-10 minutes pour tester
   - Configuration de base
   - Vérification du fonctionnement

2. **[BLUETOOTH-README.md](BLUETOOTH-README.md)**
   - Documentation complète
   - Toutes les fonctionnalités
   - FAQ et troubleshooting

3. **[.env.example](.env.example)**
   - Exemple de configuration
   - Explications de chaque paramètre
   - Checklist sécurité

### 🔧 Pour les développeurs

1. **[BLUETOOTH-ARCHITECTURE.md](BLUETOOTH-ARCHITECTURE.md)** ⭐⭐
   - Architecture système
   - Flux de données
   - Format des fichiers
   - Schéma Supabase

2. **[BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md)**
   - Installation détaillée
   - Tests complets
   - Troubleshooting
   - Performance et monitoring

3. **[BLUETOOTH-CHANGELOG.md](BLUETOOTH-CHANGELOG.md)**
   - Résumé des modifications
   - Fichiers affectés
   - Structures de données

### 📄 Fichiers source (implémentation)

- **services/bluetooth.js** - Service principal Bluetooth
- **services/bluetoothSync.js** - Sync Supabase
- **services/crypto.js** - Chiffrement (modifié)
- **main/localServer.js** - Serveur HTTP (modifié)
- **main/main.js** - Intégration Electron (modifié)
- **renderer/bluetooth-ui.js** - UI du renderer

---

## 🗺️ Navigation rapide

### Configuration

```
1. .env.example          ← Créer votre .env
2. supabase-schema.bluetooth.sql  ← Exécuter en Supabase
3. npm install           ← Installer dépendances
```

### Utilisation

```
1. npm start             ← Démarrer l'app
2. test-bluetooth.js     ← Tester avec un fichier
3. Vérifier BD Supabase  ← Consulter les données
```

### Déploiement

```
1. BLUETOOTH-DEPLOYMENT.md   ← Guide complet
2. BLUETOOTH-ARCHITECTURE.md ← Comprendre l'arch
3. BLUETOOTH-README.md       ← Référence complète
```

---

## 📖 Documentation Par Sujet

### Installation & Setup

- [Démarrage rapide](BLUETOOTH-QUICKSTART.md) - 5 min
- [Déploiement](BLUETOOTH-DEPLOYMENT.md#🔧-installation-détaillée) - 15 min
- [Configuration](BLUETOOTH-README.md#🏗️-architecture) - variables d'env

### Utilisation

- [API IPC](BLUETOOTH-README.md#🛠️-api-ipc-electron) - Fonctions disponibles
- [Endpoint HTTP](BLUETOOTH-ARCHITECTURE.md#🌐-api-http) - POST /bluetooth/upload
- [UI](renderer/bluetooth-ui.js) - Composant React

### Architecture

- [Flux complet](BLUETOOTH-ARCHITECTURE.md#🔄-flux-complet-d'un-fichier) - Diagramme
- [Chiffrement](BLUETOOTH-ARCHITECTURE.md#🔐-sécurité-du-chiffrement) - AES-256-GCM
- [Schéma BD](BLUETOOTH-ARCHITECTURE.md#🗄️-schéma-supabase) - Tables et indexes

### Sécurité

- [Sécurité](BLUETOOTH-README.md#🔐-sécurité) - Chiffrement et RLS
- [Production](BLUETOOTH-ARCHITECTURE.md#✅-checklist-avant-production) - Avant prod
- [Master Key](BLUETOOTH-README.md#sécurité) - À implémenter

### Troubleshooting

- [FAQ](BLUETOOTH-README.md#troubleshooting) - Problèmes courants
- [Deployment FAQ](BLUETOOTH-DEPLOYMENT.md#🐛-troubleshooting) - Détaillé
- [Logs](BLUETOOTH-DEPLOYMENT.md#monitoring-en-production) - Où regarder

### Tests

- [test-bluetooth.js](test-bluetooth.js) - Script de test
- [Tests complets](BLUETOOTH-DEPLOYMENT.md#🧪-tests-complets) - Checklist

---

## 🔗 Fichiers clés

### Documentation

| File                                                   | Purpose         | Audience     |
| ------------------------------------------------------ | --------------- | ------------ |
| [BLUETOOTH-QUICKSTART.md](BLUETOOTH-QUICKSTART.md)     | Démarrage 5 min | Tous         |
| [BLUETOOTH-README.md](BLUETOOTH-README.md)             | Docs complètes  | Utilisateurs |
| [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md)     | Production      | DevOps       |
| [BLUETOOTH-ARCHITECTURE.md](BLUETOOTH-ARCHITECTURE.md) | Architecture    | Devs         |
| [BLUETOOTH-CHANGELOG.md](BLUETOOTH-CHANGELOG.md)       | Changements     | Devs         |

### Configuration

| File                                                           | Purpose          |
| -------------------------------------------------------------- | ---------------- |
| [.env.example](.env.example)                                   | Config de base   |
| [.gitignore](.gitignore)                                       | Git ignore rules |
| [supabase-schema.bluetooth.sql](supabase-schema.bluetooth.sql) | Schéma BD        |

### Source

| File                                                   | Purpose       | Type     |
| ------------------------------------------------------ | ------------- | -------- |
| [services/bluetooth.js](services/bluetooth.js)         | Service BT    | NEW      |
| [services/bluetoothSync.js](services/bluetoothSync.js) | Sync Supabase | NEW      |
| [main/localServer.js](main/localServer.js)             | Serveur HTTP  | MODIFIED |
| [main/main.js](main/main.js)                           | Intégration   | MODIFIED |
| [services/crypto.js](services/crypto.js)               | Chiffrement   | MODIFIED |
| [renderer/bluetooth-ui.js](renderer/bluetooth-ui.js)   | UI            | NEW      |

### Tests

| File                                   | Purpose             |
| -------------------------------------- | ------------------- |
| [test-bluetooth.js](test-bluetooth.js) | Script de test HTTP |

---

## ⏱️ Timeline de lecture estimée

### Démarrage rapide (15 min)

- [BLUETOOTH-QUICKSTART.md](BLUETOOTH-QUICKSTART.md) - 5 min
- Installation & test - 10 min

### Utilisateur lambda (1h)

- QUICKSTART - 5 min
- [BLUETOOTH-README.md](BLUETOOTH-README.md) - 30 min
- Configuration & tests - 25 min

### Développeur (2h)

- QUICKSTART - 5 min
- [BLUETOOTH-ARCHITECTURE.md](BLUETOOTH-ARCHITECTURE.md) - 30 min
- [Source files](services/bluetooth.js) - 40 min
- [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md) - 45 min

### DevOps/Production (1h)

- [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md) - 45 min
- Checklist sécurité - 15 min

---

## 🎯 Questions fréquentes par profil

### "Je veux juste tester rapidement"

→ [BLUETOOTH-QUICKSTART.md](BLUETOOTH-QUICKSTART.md)

### "Comment ça marche?"

→ [BLUETOOTH-ARCHITECTURE.md](BLUETOOTH-ARCHITECTURE.md) + [BLUETOOTH-README.md](BLUETOOTH-README.md#🏗️-architecture)

### "Ça ne marche pas, je dois déboguer"

→ [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md#🐛-troubleshooting)

### "Je dois mettre en production"

→ [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md) + [Checklist sécurité](BLUETOOTH-ARCHITECTURE.md#✅-checklist-avant-production)

### "Je dois intégrer le code"

→ [BLUETOOTH-ARCHITECTURE.md](BLUETOOTH-ARCHITECTURE.md#📦-structure-des-fichiers-clés) + [source files](services/bluetooth.js)

### "Quels changements ont été faits?"

→ [BLUETOOTH-CHANGELOG.md](BLUETOOTH-CHANGELOG.md)

---

## 🔄 Workflow recommandé

```
1. Lire BLUETOOTH-QUICKSTART.md (5 min)
   ↓
2. Préparer Supabase (5 min)
   - Créer tables avec supabase-schema.bluetooth.sql
   - Copier clés API
   ↓
3. Configuration locale (.env) (2 min)
   ↓
4. npm install & npm start (5 min)
   ↓
5. Tester avec test-bluetooth.js (3 min)
   ↓
6. Vérifier en BD Supabase (2 min)
   ↓
7. ✅ Fonctionne!
   ↓
8. Si besoin: lire BLUETOOTH-README.md
   ↓
9. Avant prod: lire BLUETOOTH-DEPLOYMENT.md
```

---

## 📞 Support & Ressources

### Documentation interne

- Tous les fichiers `.md` dans ce dossier
- Scripts: `test-bluetooth.js`
- Source: dossier `services/` et `main/`

### Ressources externes

- [Supabase Docs](https://supabase.com/docs)
- [Node.js Crypto](https://nodejs.org/en/docs/guides/working-with-big-prime-numbers/)
- [Electron IPC](https://www.electronjs.org/docs/api/ipc-main)

### En cas de problème

1. Vérifier [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md#🐛-troubleshooting)
2. Consulter [BLUETOOTH-README.md](BLUETOOTH-README.md#troubleshooting)
3. Vérifier les logs: `~/.derewol/logs/`
4. Créer une issue avec logs + contexte

---

## ✅ Checklist avant prod

- [ ] Lire [BLUETOOTH-DEPLOYMENT.md](BLUETOOTH-DEPLOYMENT.md)
- [ ] Lire [Checklist sécurité](BLUETOOTH-ARCHITECTURE.md#✅-checklist-avant-production)
- [ ] Tests complets passés
- [ ] Master key pour chiffrer les clés
- [ ] RLS Supabase configuré
- [ ] HTTPS activé
- [ ] Monitoring en place
- [ ] Plan de récupération défini

---

**Dernière mise à jour:** Juin 2024
**Version:** 1.0.0
**État:** ✅ Production-ready
