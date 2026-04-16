# DEREWOL — Guide de navigation projet

## Structure complète

```
D:\workspace\Derewol\
│
├── derewolprint/                    ← App Electron (imprimeur)
│   ├── main/
│   │   └── main.js                 ← CERVEAU : boot, IPC, impression, subscription
│   ├── preload/
│   │   └── preload.js              ← Pont sécurisé renderer ↔ main
│   ├── renderer/
│   │   ├── index.html              ← UI principale (4 vues + modal activation)
│   │   ├── renderer.js             ← Logique UI, jobs, modal, settings
│   │   ├── renderer.css            ← Styles dark/light mode
│   │   ├── setup.html              ← Onboarding (premier lancement)
│   │   ├── i18n.js                 ← Traductions FR/EN/WO
│   │   └── js/
│   │       ├── bridge/
│   │       │   └── derewolBridge.js ← Reçoit jobs du polling, groupe par fileGroupId
│   │       ├── state/
│   │       │   └── jobStore.js     ← État centralisé des jobs
│   │       └── ui/
│   │           └── renderJobs.js   ← Génère les cards jobs dans le DOM
│   ├── services/
│   │   ├── supabase.js             ← Client Supabase (lit config.json)
│   │   ├── subscription.js         ← checkSubscription, activateCode, PLANS
│   │   ├── polling.js              ← Fetch jobs Supabase toutes les 1s
│   │   ├── printerConfig.js        ← loadConfig/saveConfig (userData/derewol-config.json)
│   │   ├── converter.js            ← PDF/Image/Word/Excel → PDF
│   │   ├── crypto.js               ← Chiffrement/déchiffrement fichiers
│   │   ├── logger.js               ← Logs structurés
│   │   └── printer.js              ← Liste imprimantes système
│   ├── scripts/
│   │   └── clean-dist.js           ← Nettoyage avant build
│   ├── config.json                 ← Clés Supabase (NE PAS commiter)
│   └── package.json
│
├── pages/                          ← PWA Next.js (client mobile/web)
│   ├── p/
│   │   └── index.js                ← SPA PRINCIPALE : upload + statut + preview
│   ├── _app.js
│   ├── _document.js                ← Headers sécurité CSP
│   └── index.js                    ← Landing page
│
├── lib/
│   ├── supabase.js                 ← Client Supabase PWA + fetchGroupsByOwner + upload
│   └── helpers.js                  ← createAnonymousSession, generateOwnerId
│
├── styles/
│   └── globals.css                 ← Variables CSS PWA + containers scroll
│
├── admin/                          ← Dashboard admin HTML/CSS/JS
│   ├── index.html                  ← Login admin
│   ├── dashboard.html              ← Vue principale
│   ├── css/admin.css
│   └── js/
│       ├── supabase-client.js
│       ├── auth.js
│       ├── dashboard.js
│       ├── subscriptions.js
│       └── printers.js
│
└── public/                         ← Assets statiques PWA
    ├── sw.js                       ← Service worker PWA
    └── offline.html
```

---

## Flux principal (ce qui se passe quand un client envoie un fichier)

```
1. Client scanne QR → ouvre /p/[slug] sur son téléphone
2. PWA : createAnonymousSession() → owner_id = "DW-anon-XXXXXXXX"
3. Client sélectionne fichiers + copies → clique Envoyer
4. PWA : createFileGroup() → INSERT file_groups (status=waiting)
5. PWA : uploadFileToGroup() pour chaque fichier :
   - Upload dans Supabase Storage (bucket derewol-files)
   - INSERT files
   - INSERT print_jobs (status=queued)
6. DerewolPrint polling (1s) : fetchPendingJobs() détecte le job
7. derewolBridge.js groupe les jobs par fileGroupId
8. jobStore.setJobs() → renderJobs.js affiche la card
9. Imprimeur clique "Imprimer tout"
10. job:confirm IPC → printSingleJobNoDelay() × N fichiers
11. Après impression : 45s delay → suppression Storage + print_job
12. file_groups.status = 'completed'
13. PWA polling 3s → voit 'completed' → affiche "Terminé"
```

---

## Où chercher quand quelque chose ne marche pas

| Symptôme | Fichier à regarder |
|----------|-------------------|
| App ne démarre pas / onboarding en boucle | `main/main.js` → section `app.whenReady()` |
| Jobs ne s'affichent pas dans DerewolPrint | `services/polling.js` + `derewolBridge.js` |
| Impression ne démarre pas | `main/main.js` → handler `job:confirm` |
| Un seul fichier imprimé | `main/main.js` → `printSingleJob` (délai bloquant) |
| Modal trial en boucle | `renderer/renderer.js` → `handleSubscriptionStatus` |
| Mauvais statut trial | `services/subscription.js` → `checkSubscription` |
| PWA n'affiche pas les statuts | `pages/p/index.js` → `usePrintStatus` + `GroupCard` |
| Preview téléchargeable | `pages/p/index.js` → iframe sandbox |
| Fichiers expirés absents | `lib/supabase.js` → `fetchGroupsByOwner` |
| Bouton "Générer code" admin bloqué | `admin/js/dashboard.js` → `handleGenCode` |
| Build EXE échoue | Fermer l'app + exclusion antivirus + `npm run build` |

---

## Variables d'environnement / Configuration

| Fichier | Ce qu'il contient |
|---------|------------------|
| `derewolprint/config.json` | `supabaseUrl` + `supabaseKey` (prod) |
| `.env.local` (PWA racine) | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `derewolprint/services/printerConfig.js` | Lit `%APPDATA%/DerewolPrint/derewol-config.json` |

---

## Commandes utiles

```bash
# Lancer DerewolPrint en dev
cd derewolprint && npm start

# Build EXE
cd derewolprint && npm run build

# Build PWA
npm run build  (à la racine)

# Nettoyer dist avant build
node derewolprint/scripts/clean-dist.js
```

---

## Tables Supabase — ce que chaque table fait

| Table | Rôle |
|-------|------|
| `printers` | Un enregistrement par boutique/imprimeur |
| `file_groups` | Un groupe par "session d'upload" client |
| `files` | Un fichier par ligne, lié à un file_group |
| `print_jobs` | Un job par fichier, status queued→printing→completed |
| `subscriptions` | Abonnement de chaque imprimeur (trial/payant) |
| `history` | Log de tout ce qui a été imprimé ou rejeté |
| `anon_sessions` | Sessions anonymes clients (analytics) |

---

## Plan de lancement (ce qu'il reste)

### Urgent (avant premier client)
- [ ] Fix multi-fichiers impression (Prompt `prompt-fix-4issues.md`)
- [ ] Fix modal trial boucle (même prompt)
- [ ] Preview sans téléchargement (même prompt)
- [ ] Fichiers expirés dans historique (même prompt)

### Court terme (semaine 1)
- [ ] Test complet avec vrai imprimeur WiFi
- [ ] Build EXE + test installation chez premier client
- [ ] Admin : générer premier code d'activation

### Moyen terme (mois 1)
- [ ] Viewer sécurisé fichiers (`prompt-viewer-v2.md`)
- [ ] OnlyOffice si clients demandent édition Word/Excel complète

---

## Notes importantes

1. **config.json n'est JAMAIS commité** — contient les clés Supabase prod
2. **La suppression des fichiers est différée de 45s** — délai imprimante
3. **Le polling Electron est à 1s** — pour réactivité impression
4. **Le polling PWA est à 3s** — LWS hébergement statique, pas de WebSocket
5. **owner_id format** = `DW-anon-XXXXXXXX` (8 chars alphanum)
6. **display_code format** = `#X-XXXXXXX` (visible dans l'app)
