# README Buffer

## Qu'est-ce qu'un `Buffer` en Node.js ?

En Node.js, un `Buffer` est une structure de données qui contient une suite d'octets (bytes). C'est l'équivalent d'un tableau de données binaires en mémoire. On l'utilise pour manipuler des fichiers, des flux réseau ou des données chiffrées sans les convertir en texte.

### Pourquoi le Buffer est important ici

Dans `derewolprint/main/main.js`, le buffer est utilisé pour :

1. Télécharger le fichier depuis Supabase Storage.
2. Le déchiffrer (si le fichier est chiffré).
3. Le sauvegarder temporairement sur disque.
4. L'imprimer dans son format d'origine.

Cela garantit que :

- un PDF reste un PDF,
- un Word reste un Word,
- un Excel reste un Excel,
- un PNG reste un PNG.

Aucune conversion de format n'est appliquée dans le chemin d'impression principal.

---

## Exemple de code de buffer utilisé dans `main.js`

```js
const { data: fileData, error: dlError } = await supabase.storage
  .from("derewol-files")
  .download(file.storage_path);

const decryptedBuffer = decryptFile(
  Buffer.from(await fileData.arrayBuffer()),
  file.encrypted_key,
);

if (!decryptedBuffer || decryptedBuffer.length < 100)
  throw new Error("Fichier invalide ou trop petit");

fs.writeFileSync(tmpPath, decryptedBuffer);
```

### Explication

- `fileData.arrayBuffer()` récupère le contenu binaire du fichier depuis Supabase.
- `Buffer.from(...)` convertit ce contenu binaire en `Buffer` Node.js.
- `decryptFile(...)` retourne un autre `Buffer` contenant les octets du fichier déchiffré.
- `fs.writeFileSync(tmpPath, decryptedBuffer)` écrit le buffer sur le disque, sans transformer le format.

---

## Logique de l'impression multiple

### Contexte actuel

Dans `derewolprint/main/main.js`, l'impression d'un groupe de fichiers se fait par appel à :

- `job:confirm` → déclenche un groupement de fichiers/emplois (`items`)
- Puis pour chaque fichier : `printSingleJobNoDelay(...)`
- Après impression, la suppression du fichier de stockage Supabase et la suppression du job DB sont planifiées indépendamment

### Ce que cela fait

- les fichiers sont imprimés en **séquence**,
- chaque fichier est traité dans son format natif,
- les nettoyages du stockage se déroulent après un délai (`PRINT_DELAY_MS`) pour laisser le temps à l'imprimante d'enregistrer la tâche,
- le statut du `file_group` est mis à jour en `printing` puis en `completed`.

### Exemple simplifié du flux

```js
for (const item of items) {
  const result = await printSingleJobNoDelay(
    item.jobId,
    printerName,
    item.copies,
  );

  await insertHistory({
    ownerId: result.ownerId,
    fileName: result.fileName,
    copies: result.copies,
    printerName,
    status: "completed",
    groupId: result.fileGroupId,
  });

  setTimeout(async () => {
    await supabase.storage.from("derewol-files").remove([result.storagePath]);
    await supabase.from("print_jobs").delete().eq("id", item.jobId);
  }, PRINT_DELAY_MS);
}
```

### Ce que cela ne fait pas

- Il n'y a pas de conversion des fichiers en PDF.
- Il n'y a pas de transformation du format original.
- L'application imprime le fichier tel qu'il a été reçu.

---

## Pourquoi la PWA/Electron peut se bloquer

Le blocage peut venir du main process Electron, pas de la PWA.

### Points critiques actuels

- L'ancien code utilisait `execSync(...)` pour lancer PowerShell.
- `execSync` bloque totalement le thread principal Node/Electron pendant l'impression.
- Si Word ou Excel met du temps à démarrer, l'app peut sembler figée.

### Ce qui a été corrigé

- les commandes PowerShell sont maintenant lancées avec `exec(...)` asynchrone,
- le thread principal n'est plus bloqué pendant l'impression,
- la suppression du spooler est exécutée en asynchrone,
- le chemin original est conservé : aucun fichier n'est converti.

---

## Format natif conservé

Le fichier temporaire créé conserve l'extension originale :

```js
const ext = path.extname(file.file_name) || ".bin";
const tmpPath = path.join(os.tmpdir(), `dw-${jobId}${ext}`);
```

Cela signifie que :

- `monfichier.pdf` sera imprimé en tant que PDF,
- `monfichier.docx` sera imprimé en tant que Word,
- `monfichier.xlsx` sera imprimé en tant qu'Excel,
- `image.png` sera imprimée en tant qu'image (si supportée).

---

## Recommandation

Pour éviter toute nouvelle gelure :

- imprimer les fichiers Office via un appel asynchrone,
- ne pas utiliser `execSync()` sur le main thread,
- éviter de redémarrer le spooler à chaque groupe imprimé,
- garder le nettoyage du stockage séparé du flux d'impression.

---

## Conclusion rapide

- `Buffer` = binaire en mémoire
- utilisation = télécharger, déchiffrer, écrire, vérifier
- logique mulitple fichiers = séquence + nettoyage différé
- pas de conversion = format original préservé
- cause de freeze probable = exécution bloquante du shell
