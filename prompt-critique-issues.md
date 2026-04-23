# Prompt Critique - Issues Post-Build Electron App

## Contexte

Après le build de l'application Electron DerewolPrint, plusieurs problèmes critiques ont été identifiés lors des tests. Ces issues affectent la synchronisation entre la PWA et l'app Electron, la gestion des fichiers, et l'expérience utilisateur. Ce document détaille les problèmes rencontrés et les dernières implémentations effectuées pour les résoudre.

## Problèmes Identifiés

### 1. Fonctionnalité "Voir" dans PWA - Lecteur PDF Défaillant

- **Description** : Lors de l'envoi d'un fichier PDF pour test, la fonctionnalité "voir" côté PWA affiche un modal blanc avec le message "Download desactivé en vert".
- **Comportement souhaité** : Pas de téléchargement du fichier côté PWA (le fichier source est déjà sur l'appareil, ce serait redondant). Au lieu de cela, implémenter un lecteur PDF intégré pour visualiser le fichier directement.
- **Problème côté DerewolPrint** : Erreur "erreur de lecture PDF" avec message "pdf.js est introuvable", indiquant que la bibliothèque pdf.js n'est pas correctement intégrée ou chargée.
- **Impact** : L'utilisateur ne peut pas prévisualiser les PDFs dans l'app Electron, ce qui limite l'utilité de la fonctionnalité de visualisation.

### 2. Synchronisation du Statut d'Impression - Cas Excel

- **Description** : Pour un fichier Excel envoyé, DerewolPrint affiche "terminé" avec un historique correct, mais la PWA reste bloquée sur "en attente".
- **Impact** : Désynchronisation entre les deux interfaces, confusion pour l'utilisateur sur le statut réel de l'impression.
- **Comportement attendu** : Statut synchronisé en temps réel entre PWA et Electron via polling ou WebSocket.

### 3. Gestion Multi-Fichiers - Téléchargement et Modification

- **Description** : Le téléchargement multi-fichiers fonctionne avec autorisation (client peut accepter/rejeter, imprimeur peut relancer après rejet - comportement souhaité à conserver).
- **Préoccupation** : Après téléchargement, les fichiers vont dans le dossier dédié "derewol-files". Risque d'écrasement du fichier original si un fichier modifié porte le même nom.
- **Suggestion d'implémentation** : Ajouter un bouton "upload" dans DerewolPrint qui :
  - Compare les fichiers de même nom.
  - Demande confirmation d'écrasement si nécessaire.
  - Remplace le fichier du client par la version modifiée.
  - Synchronise Supabase en remplaçant le fichier sous le même nom/ID client.
- **Sécurité** : Assurer que seules les modifications autorisées peuvent écraser les fichiers originaux, avec logs d'audit.

### 4. Format d'ID Incohérent

- **Description** :
  - Côté PWA : ID au format "dw-anon-xxxxx".
  - Côté DerewolPrint (historique) : Même format "dw-anon-xxxxx".
  - Mais dans la réception de job de fichier : Format "#7f3r3r" (différent).
- **Impact** : Incohérence dans l'identification des utilisateurs/jobs, potentiellement causant des erreurs de synchronisation ou de tracking.
- **Comportement attendu** : Format d'ID uniforme "dw-anon-xxxxx" partout dans l'application.

### 5. Synchronisation Multi-Fichiers - Bouton "Tout Imprimé"

- **Description** : Lors de l'impression de plusieurs fichiers, après clic sur "tout imprimé", DerewolPrint affiche "terminé", mais la PWA reste sur "en attente".
- **Impact** : Même problème de désynchronisation que pour Excel, mais pour les jobs multi-fichiers.
- **Comportement attendu** : Mise à jour synchrone du statut dans les deux interfaces.

## Dernières Implémentations Effectuées

### 1. Fix Crash PWA (pages/p/index.js)

- **Problème résolu** : Référence incorrecte à 'displayStatus' au lieu de 'uiStatus'.
- **Implémentation** : Correction de la variable pour éviter les crashes lors de l'affichage du statut.
- **Résultat** : PWA build sans erreurs.

### 2. Optimisation Impression - Calls Shell Asynchrones (derewolprint/main/main.js)

- **Problème résolu** : Freezes lors de l'impression multi-fichiers dus à des appels shell synchrones (execSync).
- **Implémentation** :
  - Conversion des appels execSync vers exec asynchrone.
  - Création d'une fonction wrapper execShell pour gérer les appels async.
  - Modification de printSingleJobNoDelay et cleanSpooler pour utiliser des appels non-bloquants.
- **Résultat** : Élimination des freezes, impression séquentielle fluide.

### 3. Documentation Logique Buffer (README-buffer.md)

- **Implémentation** : Création d'un document expliquant l'usage des buffers pour la gestion des fichiers binaires sans conversion de format.
- **Contenu** : Exemples de code pour création de buffer depuis arrayBuffer, déchiffrement, écriture de fichier.
- **Langue** : Documentation en français comme demandé.

## Actions Recommandées

1. Intégrer pdf.js correctement dans DerewolPrint pour le lecteur PDF.
2. Implémenter un lecteur PDF intégré dans PWA au lieu du téléchargement.
3. Déboguer et corriger la synchronisation des statuts entre PWA et Electron.
4. Développer la fonctionnalité d'upload avec comparaison/écrasement dans DerewolPrint.
5. Uniformiser le format d'ID à "dw-anon-xxxxx" partout.
6. Tester et valider la synchronisation pour les jobs multi-fichiers.

Ce document doit être fourni à Claude pour analyse et résolution des issues critiques.
