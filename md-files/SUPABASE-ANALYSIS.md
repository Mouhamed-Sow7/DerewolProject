# 🔍 Analyse Supabase — Problème table USERS

## État actuel (12/04/2026)

### Tables avec données ✅

```
printers
├─ id
├─ slug
├─ name
├─ owner_id (FK to users - RÉFÉRENCE CASSÉE?)
└─ ... autre config

subscriptions
├─ id
├─ printer_id (FK to printers) ✅
├─ status (active, trial, expired)
├─ trial_expires_at
├─ renewed_at
└─ owner_id (FK to users - RÉFÉRENCE CASSÉE?)

print_jobs
├─ id
├─ status (queued, printing, completed, expired, rejected)
├─ file_id
├─ group_id (FK to file_groups)
└─ ...

file_groups
├─ id
├─ owner_id (FK to users - RÉFÉRENCE CASSÉE?)
├─ printer_id (FK to printers)
├─ status
└─ files (relation)

files
├─ id
├─ group_id (FK to file_groups)
├─ file_name
├─ storage_path
└─ ...
```

### Table USERS — VIDE ❌

```
users (anon? public?)
├─ id
├─ email
├─ phone
├─ created_at
└─ ... NO DATA
```

---

## Hypothèses du problème

### 1. Données utilisateurs perdues lors d'une migration

**Symptôme**:

- Tous les FK `owner_id` pointent vers une table vide
- Printers/subscriptions ont `owner_id` mais no matching user

**Cause possible**:

- Migration Supabase qui a supprimé la table ou les données
- Export/import de data qui a échoué
- Modification RLS (Row Level Security) qui cache les users

### 2. Données utilisateurs jamais persistées dans users

**Symptôme**:

- Clients envoient via PWA mais données vont où?
- Seulement dans `sessions` (localStorage)?

**Cause possible**:

- PWA crée `anon_sessions` (localStorage) au lieu de DB users
- Administrateur crée `printers` directement via setup.js (Electron)
- Pas de trigger DB pour créer user automatiquement

### 3. RLS policy cache les users

**Symptôme**:

- Table existe mais policies empêchent lecture/écriture

**Cause possible**:

- RLS restrictif pour sécurité
- Authentification Supabase pas configurée correctement

---

## Solution proposée

### Étape 1: Diagnostiquer

```sql
-- Vérifier si users existe et a des données
SELECT COUNT(*) FROM users;
-- Result: 0 rows found?

-- Vérifier les FK orphelines
SELECT * FROM printers WHERE owner_id NOT IN (SELECT id FROM users);
SELECT * FROM subscriptions WHERE owner_id NOT IN (SELECT id FROM users);

-- Vérifier RLS policies
SELECT tablename, policyname, QUAL
FROM pg_policies
WHERE tablename = 'users';
```

### Étape 2: Restaurer données users

```bash
# Option A: Extraire owner_ids et créer users
INSERT INTO users (id, created_at)
SELECT DISTINCT owner_id, NOW()
FROM printers
WHERE owner_id NOT IN (SELECT id FROM users);

# Option B: Export/import depuis backup
pg_dump -t users 2025-backup.sql > restore.sql
psql < restore.sql
```

### Étape 3: Ajouter middleware pour créer users automatiquement

```javascript
// Dans PWA (lib/supabase.js)
export async function ensureUserExists(ownerId) {
  const { data: exists } = await supabase
    .from("users")
    .select("id")
    .eq("id", ownerId)
    .single();

  if (!exists) {
    await supabase
      .from("users")
      .insert({ id: ownerId, created_at: new Date() });
  }
}

// Appeler avant createFileGroup
await ensureUserExists(session.owner_id);
```

### Étape 4: Audit et logging

- Ajouter logs chaque fois qu'un owner_id est utilisé
- Tracer d'où viennent les owner_ids
- Vérifier intégrité des FK

---

## À faire

- [ ] Vérifier si table users existe vraiment
- [ ] Compter les FK orphelines (printers/subscriptions sans user)
- [ ] Vérifier les RLS policies sur la table users
- [ ] Décider: restaurer les données perdues OU recréer les users
- [ ] Implémenter ensureUserExists dans le workflow
- [ ] Tester full flow QR → Upload → User created

---

**Impact**: Critique — Les données clients sont orphelines sans lien aux users
**Priorité**: 🔴 Haute — Doit être fixé avant production
