# Derewol — Structure du projet
Type : Application desktop/web de gestion d’impression en temps réel

Objectif :
Permettre aux utilisateurs (clients) d’envoyer des fichiers à imprimer et aux administrateurs de gérer ces jobs via une interface simple et réactive.

Fonctionnalités clés :

Liste des jobs en attente – Voir tous les fichiers reçus, avec infos client, taille, date/heure.

Actions sur les jobs – Imprimer ou rejeter un job directement depuis l’interface.

Modale de confirmation – Pour éviter les suppressions accidentelles.

Mise à jour en temps réel – Polling Supabase / backend → jobStore → UI.

Architecture propre –

jobStore = source unique de vérité (équivalent Redux/React state)

UI = passive, se met à jour via abonnement au store

Backend → store → UI, pas de logique métier dans l’interface

Test local facile – Possibilité de simuler des jobs avec mockJobs pour le développement.

Technologies :

Frontend : HTML, CSS, JavaScript, modules ES6

Backend : Supabase pour la gestion des jobs et le temps réel

IPC/Bridge : window.derewol pour la communication avec le backend / Electron

Architecture résumé :

Supabase (backend)
      │
      ▼
  jobStore (central data)
      │
      ▼
 renderJobs (UI passive)


Avantages :

UI réactive sans recharger la page

Code maintenable et évolutif

Facile à brancher sur vrai backend et futur statut des impressions
Ceci est une vue d'ensemble rapide de l'arborescence du projet.

## Description

- Projet Next.js avec un répertoire `derewolprint` (app Electron / renderer)
- Fichiers de configuration et dossiers principaux listés ci-dessous.

## Structure (vue simplifiée)

```
Derewol/
├─ components/
│  ├─ Button.js
│  ├─ Countdown.js
│  ├─ Header.js
│  ├─ IDCard.js
│  ├─ Logo.js
│  └─ Modal.js
├─ context/
│  └─ SessionContext.js
├─ derewolprint/
│  ├─ package.json
│  ├─ assets/
│  ├─ main/
│  │  └─ main.js
│  ├─ preload/
│  │  └─ preload.js
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ renderer.css
│  │  └─ renderer.js
│  └─ services/
├─ hooks/
│  └─ useSession.js
├─ lib/
│  ├─ crypto.js
│  ├─ helpers.js
│  └─ supabase.js
├─ pages/
│  ├─ _app.js
│  ├─ index.js
│  └─ upload.js
├─ public/
│  └─ patterns/
├─ styles/
│  └─ globals.css
├─ next.config.js
├─ package.json
├─ tsconfig.json
└─ next-env.d.ts

``` 

Si vous voulez une arborescence plus détaillée (tous les fichiers), dites-le et je l'ajouterai.

---
Commit initial: `introduction` (créé par script)
