# ✅ CHECKLIST DE NETTOYAGE - ACTIONS RECOMMANDÉES

**Basée sur:** Exploration complète du 2026-05-04  
**Priorité:** Ordre recommandé d'exécution

---

## 🔴 PRIORITÉ HAUTE - À Faire IMMÉDIATEMENT

### [ ] 1. Refactoriser `usePrintStatus()`

**Problème:** Fonction définie en 3 endroits différents

- pages/dashboard.js (ligne 8)
- pages/p/index.js (ligne 122)
- refacto/p-index.js (ligne 29) ← OLD VERSION

**Action recommandée:**

```bash
# 1. Créer le vrai hook
touch hooks/usePrintStatus.js

# 2. Extraire la logique depuis pages/p/index.js (ligne 122-150 environ)
# Contenu:
export default function usePrintStatus(ownerId) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("file_groups")
      .select(`...`)
      .eq("owner_id", ownerId)

    if (!error && data) {
      const filtered = data.filter((g) => g.status !== "deleted")
      setGroups(filtered)
    }
    setLoading(false)
  }, [ownerId])

  useEffect(() => {
    fetch()
    const channel = supabase.channel(...).on(...).subscribe()
    return () => supabase.removeChannel(channel)
  }, [ownerId, fetch])

  return { groups, loading }
}

# 3. Remplacer dans pages/dashboard.js
# OLD: function usePrintStatus(displayId) { ... }
# NEW: import usePrintStatus from "../hooks/usePrintStatus"

# 4. Remplacer dans pages/p/index.js
# OLD: function usePrintStatus(ownerId) { ... }
# NEW: import usePrintStatus from "../hooks/usePrintStatus"

# 5. Supprimer la vieille version de refacto/
```

**Effort:** ~30 minutes  
**Impact:** Maintenance améliorée, code plus maintenable

---

### [ ] 2. Supprimer le dossier `refacto/` entièrement

**Contiens:** Code obsolète/old versions

- refacto/p-index.js (ancien pages/p/index.js)
- refacto/supabase.js (ancien lib/supabase.js)
- refacto/derewol_activation_modal.html (HTML old)

**Avant de supprimer:**

```bash
# 1. Créer une branche git pour backup
git checkout -b backup/refacto-folder-2026-05-04

# 2. Commit et archiver
git add refacto/
git commit -m "ARCHIVE: Move refacto folder to git history"

# 3. Préserver si critiques:
git archive --format tgz HEAD refacto/ > refacto.backup.tgz

# 4. Supprimer
rm -rf refacto/
```

**Effort:** ~10 minutes  
**Impact:** 300+ lignes de code mort éliminées

---

### [ ] 3. Vérifier `pdfjs-dist` réelle utilisation

**Problème:** Dépendance NPM installée et copiée dans build, mais jamais importée dans le code

**Action recommandée:**

```bash
# 1. Vérifier si vraiment utilisé
grep -r "pdfjs" derewolprint/ --include="*.js"
grep -r "pdf.worker" derewolprint/ --include="*.js"

# 2. Si ZÉRO résultats:
  a. Supprimer du package.json
  b. Supprimer de electron-builder config
  c. npm install (rebuild package-lock.json)

# 3. Si utilisé:
  a. Ajouter import/require au fichier qui l'utilise
  b. Documenter l'usage
```

**Effort:** ~15 minutes  
**Impact:** Réduire build size (~1-2MB)

---

### [ ] 4. Supprimer `npm install electron-log`

**Problème:** Dépendance installée mais jamais utilisée  
**Solution:** Utiliser `services/logger.js` à la place

```bash
# 1. Vérifier zéro usage
grep -r "electron-log" . --include="*.js"
grep -r "require.*log" derewolprint/ --include="*.js"

# 2. Si confirmé orpheline:
cd derewolprint/
npm uninstall electron-log
npm install  # Update package-lock.json

# 3. Commit
git add package.json package-lock.json
git commit -m "Remove unused electron-log dependency"
```

**Effort:** ~5 minutes  
**Impact:** Réduire node_modules size

---

## 🟡 PRIORITÉ MOYEN - À Faire PROCHAINE SPRINT

### [ ] 5. Supprimer `components/Logo.js` (non utilisé)

**Problème:** Jamais importé, prend de l'espace

```bash
# 1. Vérifier zéro usage
grep -r "Logo" . --include="*.js" --include="*.jsx" --include="*.tsx"
grep -r "from.*Logo" . --include="*.js"

# 2. Si confirmé orpheline:
rm components/Logo.js

# 3. Commit
git add .
git commit -m "Remove unused Logo component"
```

**Effort:** ~2 minutes  
**Impact:** Minimal (3 lignes)

---

### [ ] 6. Supprimer `context/` dossier (vide)

**Contenu:** Rien (dossier créé probablement pour React Context)

```bash
# 1. Vérifier contenu
ls -la context/

# 2. Si vide:
rmdir context/

# 3. Commit
git add .
git commit -m "Remove empty context directory"
```

**Effort:** ~1 minute  
**Impact:** Minimal (dossier vide)

---

### [ ] 7. Vérifier `lib/i18n.js` réelle utilisation

**Problème:** Traductions existent (fr, en, wo) mais jamais importées

```bash
# 1. Vérifier usage
grep -r "from.*i18n" . --include="*.js"
grep -r "import.*i18n" . --include="*.js"
grep -r "getLang\|setLang\|t(" . --include="*.js"

# 2. Si ZÉRO résultats:
  a. Considérer si les traductions sont nécessaires
  b. Ou mettre en localStorage key
  c. Ou documenter intention

# 3. Si utilisé:
  a. Ajouter dans pages/_app.js ou ailleurs
  b. Vérifier que langue est persistée
```

**Effort:** ~10 minutes  
**Impact:** Clarifier intent (traductions utiles?)

---

### [ ] 8. Organiser test files

**Actuel:** Files à la racine derewolprint/

- test-bluetooth.js
- test-trial-ended.js

```bash
# Option 1: If used in CI/CD, keep in repo but document
# Option 2: Move to dedicated tests/ folder
mkdir -p derewolprint/tests
mv derewolprint/test-*.js derewolprint/tests/

# Option 3: Archive and delete
git mv test-*.js tests/
git commit -m "Organize test files"
```

**Effort:** ~5 minutes  
**Impact:** Mieux organisation

---

## 🟢 PRIORITÉ BASSE - Nice to Have

### [ ] 9. Supprimer/Archiver `fix-modal-scope.js`

**Statut:** Script FIX temporaire (pas dans npm scripts)

```bash
# Vérifier si toujours nécessaire
grep -n "isActivating" . --include="*.js" -r

# Si FIX appliqué:
git mv fix-modal-scope.js .archive/
# Ou
rm fix-modal-scope.js

# Commit
git commit -m "Remove temporary fix script (already applied)"
```

**Effort:** ~3 minutes  
**Impact:** Minimal

---

### [ ] 10. Consolider clients Supabase

**Problème:** Plusieurs instances Supabase créées

```javascript
// Actuel:
lib/supabase.js          → createClient(url, key)
lib/helpers.js           → createClient(url, key)  // DUPLICATE!
refacto/supabase.js      → createClient(url, key)  // OLD VERSION

// Solution:
// Après refactor #1, utiliser SEUL:
lib/supabase.js [frontend]
derewolprint/services/supabase.js [backend]
```

**Effort:** ~20 minutes (après cleanup priorité 1-4)  
**Impact:** Meilleure maintenabilité

---

### [ ] 11. Documentation des traductions multilingues

**Trouvé:** Support pour 3 langues

- fr (Français)
- en (English)
- wo (Wolof) ← Rare!

```markdown
# Créer: docs/I18N.md

## Traductions actuelles

- Français (fr) ✅
- English (en) ✅
- Wolof (wo) ✅

## Implémentation

- Frontend: À vérifier (lib/i18n.js non utilisé?)
- DerewolPrint: derewolprint/renderer/i18n.js (5 functions)

## Comment ajouter nouvelle langue

1. Edit lib/i18n.js > translations object
2. Add key-value pairs
3. Set localStorage
```

**Effort:** ~5 minutes  
**Impact:** Meilleure documentation

---

## 📊 RÉSUMÉ DES CHANGEMENTS RECOMMANDÉS

### Avant Cleanup

```
Files total:        53
Lines of dead code: ~500+
Orphaned imports:   0
Duplications:       4 major
Unused deps:        1-2
Codebase health:    65-70% 🟡
```

### Après Cleanup (Priorité Haute)

```
Files total:        ~45 (-8)
Lines of dead code: ~0 (-500)
Orphaned imports:   0
Duplications:       0 (-4)
Unused deps:        0 (-1)
Codebase health:    85-90% 🟢
```

### Estimated Effort:

- 🔴 **Priorité Haute:** 1-2 hours
- 🟡 **Priorité Moyen:** 30 minutes
- 🟢 **Priorité Basse:** 15 minutes
- **Total:** ~2-3 hours for complete cleanup

---

## 🚀 EXECUTION STRATEGY

### Phase 1 (Day 1) - Priorité Haute

```bash
# 1. Backup
git checkout -b cleanup/phase-1

# 2. Create real usePrintStatus hook
# 3. Remove refacto/ folder
# 4. Check pdfjs-dist + npm uninstall electron-log
# 5. Test build

git commit -m "Phase 1: Remove dead code & duplicates"
git push origin cleanup/phase-1
```

### Phase 2 (Day 2) - Priorité Moyen

```bash
# 1. Remove unused components/files
# 2. Check i18n usage
# 3. Organize test files

git commit -m "Phase 2: Clean up orphaned files"
```

### Phase 3 (Later) - Nice to Have

```bash
# 1. Consolidate Supabase clients
# 2. Document traductions
# 3. Archive optimization

git commit -m "Phase 3: Maintenance improvements"
```

---

## ✅ VALIDATION CHECKLIST

After cleanup, validate:

- [ ] All imports resolve correctly
- [ ] npm install succeeds
- [ ] Build succeeds: `npm run build`
- [ ] Electron build succeeds: `npm run build` (derewolprint/)
- [ ] Tests pass (if any)
- [ ] No console errors in dev mode
- [ ] File size reduced (compare builds)
- [ ] Git history preserved (all changes committed)

---

## 📚 RÉFÉRENCES

- [Full Report](#) EXPLORATION-COMPLETE-RAPPORT.md
- [Executive Summary](#) RESUME-EXECUTIF.md
- [Import Matrix](#) MATRICE-IMPORTS-COMPLETE.md
- [This Checklist](#) CLEANUP-CHECKLIST.md

---

**Generated:** 2026-05-04  
**Version:** 1.0  
**Maintenance:** Update checklist as items are completed
