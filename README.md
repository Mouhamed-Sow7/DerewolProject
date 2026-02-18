# Derewol — Structure du projet

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
