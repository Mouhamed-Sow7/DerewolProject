# Roadmap Projet Derewol

## 1. Vision globale

**Objectif**
Créer une solution complète d’impression à distance qui combine :

- une application desktop Electron pour les imprimeurs (`derewolprint/`)
- une Progressive Web App (PWA) client pour l’envoi de fichiers
- un dashboard admin pour la gestion des abonnements, codes et imprimantes
- une infrastructure Supabase pour la gestion des jobs, fichiers, utilisateurs anonymes et abonnements

**Valeur ajoutée**

- upload simple depuis mobile via QR code
- pilotage d’impression en temps réel
- support multi-fichiers et types PDF/Word/Excel/Image
- suivi du statut d’impression depuis le client
- protection du flux de fichiers et configuration sécurisée

## 2. Architecture du projet

### 2.1 Dossiers principaux

- `derewolprint/` : application Electron imprimante
- `pages/` : PWA Next.js client
- `admin/` : interface d’administration HTML/CSS/JS
- `lib/` : utilitaires partagés et clients Supabase
- `styles/` : styles globaux PWA
- `public/` : assets statiques et service worker

### 2.2 Composants majeurs

#### Electron — `derewolprint/`

- `main/main.js` : boot, IPC, impression, gestion du polling, activer le traitement des jobs
- `preload/preload.js` : pont sécurisé entre renderer et main
- `renderer/index.html` + `renderer/renderer.js` : UI d’imprimeur, modales, gestion des jobs
- `services/supabase.js` : client Supabase pour l’imprimeur
- `services/polling.js` : récupération périodique des jobs
- `services/subscription.js` : gestion trial / abonnement
- `services/printerConfig.js` : lecture / écriture config locale
- `services/converter.js` : conversion dans un format imprimable
- `services/crypto.js` : chiffrement/déchiffrement fichiers
- `services/printer.js` : liste et configuration des imprimantes système

#### PWA client — `pages/`

- `pages/p/index.js` : UI d’upload, statut des jobs, preview
- `pages/index.js` : landing page et instructions QR
- `lib/supabase.js` : upload de fichiers, création de sessions anonymes, lecture de groupes
- `hooks/useUpload.js` : processus d’upload, création de file_groups, création de print_jobs
- `hooks/usePrintStatus.js` : suivi d’état des jobs depuis la page client

#### Admin — `admin/`

- `index.html` : login / accès admin
- `dashboard.html` : vue de gestion des imprimantes, abonnements, codes
- `js/dashboard.js` : logique de gestion de l’interface admin
- `js/subscriptions.js` : gestion des plans, activation et check abonnement
- `js/printers.js` : listing et état des imprimantes

#### Infrastructure Supabase

- Tables principales : `printers`, `file_groups`, `files`, `print_jobs`, `subscriptions`, `history`, `anon_sessions`
- Stockage : bucket `derewol-files`
- Realtime / polling : détection des jobs et affichage de changement d’état

## 3. Roadmap détaillée

### 3.1 Phase 0 — Analyse et préparation

Objectif : cartographier l’ensemble du système, fixer les priorités et s’assurer d’un terrain stable avant développement.

Tâches :

- [x] Documenter l’architecture globale
- [x] Identifier les modules critiques et les points de panne
- [x] Lister les fichiers de configuration et les secrets à protéger (`derewolprint/config.json`, `.env.local`)
- [x] Vérifier la structure de la base Supabase et les schémas
- [x] Lire et centraliser les rapports existants (`guide-projet-derewol.md`, `global-view-for-claude.md`, `COMPLETE-ANALYSIS-2026-v2.md`)

Livrables :

- document de vision
- liste de correctifs urgents
- checklist de lancement

### 3.2 Phase 1 — MVP fonctionnel

Objectif : mettre en place un flux complet upload → impression → suppression avec interface client et imprimante.

Tâches principales :

- [ ] Implémenter l’upload client et la création d’un groupe de fichiers
- [ ] Gérer l’upload multi-fichiers vers Supabase Storage
- [ ] Créer un `print_job` par fichier avec lien `file_id`
- [ ] Implémenter le polling dans Electron pour surveiller les `print_jobs` en `queued`
- [ ] Afficher les jobs dans l’UI Electron avec cards dynamiques
- [ ] Permettre l’impression de tous les jobs d’un groupe
- [ ] Ajouter la suppression différée de fichiers après impression
- [ ] Implémenter le suivi de statut côté client (waiting → printing → completed)
- [ ] Mettre en place le trial et l’abonnement
- [ ] Prévoir un onboarding / setup dans Electron

Points clés :

- `useUpload.js` doit générer un `print_job` individuel par fichier
- `derewolprint/main/main.js` doit éviter la suppression immédiate après spooling
- `renderer/renderer.js` doit gérer le store et les modales correctement

### 3.3 Phase 2 — Stabilisation et corrections critiques

Objectif : corriger les bugs bloquants, sécuriser le workflow et fiabiliser l’expérience utilisateur.

Bugs à régler :

- [ ] Fix multi-fichiers imprimés partiellement
- [ ] Fix modal trial en boucle
- [ ] Fix preview qui force le téléchargement
- [ ] Fix suppression trop rapide des fichiers
- [ ] Fix duplicate slug / registration printer

Améliorations immédiates :

- [ ] Ajouter des messages d’erreur utilisateurs plus clairs
- [ ] Améliorer la gestion des états de jobs dans `jobStore`
- [ ] Vérifier la logique de `checkSubscription` pour trial/paid
- [ ] Tester la génération de code activation admin
- [ ] Auditer le rechargement et l’affichage de l’UI Electron

Livrables :

- patch release fonctionnelle
- checklist de validation QA
- documentation de configuration

### 3.4 Phase 3 — Expérience realtime et performance

Objectif : réduire le délai de détection des jobs, diminuer le polling et améliorer la réactivité.

Tâches :

- [ ] Activer Supabase Realtime si nécessaire
- [ ] Créer `lib/realtimeManager.js` ou équivalent
- [ ] Ajouter fallback polling 1s / 3s
- [ ] Mettre à jour `usePrintStatus` pour supporter realtime
- [ ] Ajouter badge de connexion réactive dans PWA
- [ ] Implémenter un mode hybride Realtime + polling
- [ ] Tester sur mobile et WiFi instable

Résultats attendus :

- latence de statut < 100ms quand realtime OK
- fiabilité accrue en cas de perte réseau
- consommation réseau plus faible

### 3.5 Phase 4 — Mise en production et déploiement

Objectif : préparer la version opérationnelle, documenter le déploiement et assurer le suivi.

Tâches :

- [ ] Tester build Electron complet (`npm run build` dans `derewolprint`)
- [ ] Tester installation EXE sur machine Windows cible
- [ ] Valider la PWA sur environnement statique / Vercel / Netlify
- [ ] Vérifier les variables d’environnement et la configuration Supabase
- [ ] Mettre en place les process de nettoyage (`clean-dist.js`)
- [ ] Préparer les notes de déploiement et le guide d’installation
- [ ] Former le premier imprimeur / client

Vérifications :

- `derewolprint/config.json` n’est pas commité
- `.env.local` contient uniquement les clés non sensibles appropriées
- les jobs complétés sont correctement archivés dans `history`
- les fichiers sont supprimés après délai et non immédiatement

### 3.6 Phase 5 — Evolutions et maintenance

Objectif : enrichir le produit, ouvrir aux nouveaux usages et maintenir la stabilité.

Fonctionnalités à envisager :

- [ ] Viewer sécurisé pour fichiers avant impression
- [ ] Edition en ligne Word/Excel si demandée
- [ ] Support d’imprimantes réseau / WiFi plus avancé
- [ ] Dashboard analytique des impressions et revenus
- [ ] Modes multi-utilisateur pour plusieurs imprimeurs
- [ ] API d’administration automatisée
- [ ] Support de la signature numérique / PDF sécurisé

Maintenance :

- [ ] Tests réguliers de build
- [ ] Mise à jour des dépendances (`supabase-js`, Electron, Next.js)
- [ ] Surveillance des erreurs et logs
- [ ] Backups de la base de données Supabase
- [ ] Revue des règles de sécurité et des accès

## 4. Scénario d’usage complet

### 4.1 Client mobile

1. Scanner QR code → ouvre `https://.../p/[slug]`
2. La PWA appelle `createAnonymousSession()`
3. Le client choisit fichiers et copies
4. `createFileGroup()` crée une entrée dans `file_groups` status=`waiting`
5. Chaque fichier est uploadé dans Suppabase Storage
6. Un `file` et un `print_job` sont créés par fichier
7. Le client voit l’état du groupe évoluer jusqu’à `completed`

### 4.2 Imprimeur Electron

1. Electron poll ou reçoit realtime les `print_jobs` en `queued`
2. `derewolBridge.js` regroupe les jobs par `fileGroupId`
3. `jobStore.setJobs()` met à jour l’UI dans `renderJobs.js`
4. L’imprimeur clique `Imprimer tout`
5. `main/main.js` envoie chaque fichier au spooler
6. Le système attend la durée de delay avant suppression
7. Le job passe à `completed` et la PWA est notifiée

### 4.3 Admin

1. Se connecter via `admin/index.html`
2. Gérer les imprimantes dans `dashboard.html`
3. Générer et activer les codes de trial / abonnement
4. Contrôler les accès et les statuts d’abonnement

## 5. Checklist technique complète

### Electron

- [ ] `main/main.js` : gestion des jobs, impression, delays
- [ ] `preload/preload.js` : API sécurisée entre renderer et main
- [ ] `renderer/renderer.js` : gestion du store, modales, UI
- [ ] `services/polling.js` : récupération jobs toutes les secondes
- [ ] `services/subscription.js` : calcul trial/paid
- [ ] `services/printerConfig.js` : config locale et lecture JSON
- [ ] `services/converter.js` : conversion vers PDF/imprimable
- [ ] `services/crypto.js` : chiffrement/déchiffrement
- [ ] `services/printer.js` : listing imprimantes système
- [ ] `config.json` : clés Supabase (production)

### PWA

- [ ] `pages/p/index.js` : upload et statut live
- [ ] `lib/supabase.js` : création de session & upload
- [ ] `hooks/useUpload.js` : création de fichiers et jobs
- [ ] `hooks/usePrintStatus.js` : suivi du statut client
- [ ] `styles/globals.css` : styles PWA responsive
- [ ] `public/sw.js` : service worker offline

### Admin

- [ ] `admin/js/dashboard.js` : gestion imprimantes et codes
- [ ] `admin/js/subscriptions.js` : plans et activation
- [ ] `admin/js/printers.js` : état et tests imprimantes
- [ ] `admin/css/admin.css` : affichage dashboard

### Infrastructure

- [ ] Supabase tables correctes
- [ ] Storage bucket `derewol-files`
- [ ] Realtime éventuellement activé
- [ ] Résolution des erreurs unique slug / doublons
- [ ] Logique de purge des fichiers après délai

### Déploiement

- [ ] `npm install` à la racine + dans `derewolprint`
- [ ] `npm run build` PWA
- [ ] `npm run build` Electron
- [ ] `node derewolprint/scripts/clean-dist.js`
- [ ] Test EXE sur Windows cible
- [ ] Vérifier activer les ports / antivirus pour Electron

## 6. Risques et actions de mitigation

### Risque 1 : Suppression de fichiers trop tôt

- Mitigation : délai de suppression configurable dans `main/main.js`
- Vérifier que la logique attend bien après le spooler

### Risque 2 : Impressions incomplètes sur multi-fichiers

- Mitigation : un `print_job` créé par fichier
- Vérifier la correspondance `file_id` dans Supabase

### Risque 3 : Modal trial bloquée

- Mitigation : corriger `handleSubscriptionStatus` dans `renderer/renderer.js`
- Tester le passage trial → actif → expiré

### Risque 4 : Polling trop lent / expérience utilisateur lente

- Mitigation : implémenter realtime / fallback hybrid
- Tester latence sur réseau mobile

### Risque 5 : Mauvaise configuration de Supabase

- Mitigation : documentation claire de `.env.local` et `derewolprint/config.json`
- Ajouter validation de clé au démarrage

## 7. Suivi et validation

### Critères d’acceptation

- [ ] Un client peut uploader plusieurs fichiers depuis mobile
- [ ] Chaque fichier devient un job imprimable unique
- [ ] L’imprimeur voit les jobs groupés et peut lancer l’impression
- [ ] Les fichiers sont supprimés après délai et non immédiatement
- [ ] Le client voit l’état en temps réel ou quasi réel
- [ ] L’admin peut générer et activer des codes d’accès
- [ ] Le produit se build et s’installe sur Windows
- [ ] Les logs permettent de diagnostiquer les erreurs

### Tests recommandés

- [ ] Test upload 1 fichier
- [ ] Test upload 5 fichiers
- [ ] Test impression réelle sur imprimante locale
- [ ] Test impression sur imprimante réseau lente
- [ ] Test trial / abonnement / expiration
- [ ] Test admin création code + activation
- [ ] Test PWA offline partiel (service worker)
- [ ] Test réinstallation / premier lancement Electron
- [ ] Test purge des jobs et historique

## 8. Fichier de configuration et secrets

- `derewolprint/config.json` : clés Supabase prod
- `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `derewolprint/PRINT-DELAY-CONFIG.md` : guide configuration

> Attention : ne jamais commiter `derewolprint/config.json` ou les clés sensibles.

## 9. Notes de communication pour Claude

- Le projet s’appelle Derewol et se compose d’une PWA client, d’un app Electron imprimeur et d’un admin dashboard.
- Le flux central est : upload → création de groupe → jobs → impression → purge.
- Le point le plus critique est la fiabilité multi-fichiers et la suppression différée.
- Les étapes de lancement sont bien identifiées : MVP, stabilisation, realtime, production.

---

## 10. Annexes utiles

### Commandes clefs

```bash
# Lancer l’app Electron
cd derewolprint && npm start

# Build Electron
cd derewolprint && npm run build

# Build PWA
npm run build

# Nettoyer dist avant build
node derewolprint/scripts/clean-dist.js
```

### Structure rapide

- `derewolprint/main/main.js` : coeur impression
- `derewolprint/renderer/renderer.js` : UI + jobs
- `pages/p/index.js` : upload client
- `lib/supabase.js` : partage Supabase
- `admin/js/dashboard.js` : admin codes / printers

### Tables Supabase critiques

- `printers`
- `file_groups`
- `files`
- `print_jobs`
- `subscriptions`
- `history`
- `anon_sessions`
