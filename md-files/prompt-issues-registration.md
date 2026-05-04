# Registration Flow — Current Implementation

## DIAGNOSTIC CHIRURGICAL EN COURS

### Issue Identifiée

Les logs montrent **ZÉRO trace** de `[REGISTER] ▶ Début registration` après le clic.  
⇒ L'IPC `auth:register` n'est jamais atteint.  
⇒ Le problème est **preload ↔ setup.html ↔ main.js**.

---

## ÉTAPE 1 — STATUS DU PRELOAD ✅ VÉRIFIÉE

Fichier: `derewolprint/preload/preload.js`

**Exposition confirmée:**

- ✅ `window.derewol.register` exposée (ligne 5)
- ✅ `window.electronAPI.register` exposée (ligne 70)
- ✅ Les deux pointent vers le channel `'auth:register'`
- ✅ export de contextBridge OK

**Code dans preload.js:**

```javascript
contextBridge.exposeInMainWorld("electronAPI", {
  register: (d) => ipcRenderer.invoke("auth:register", d),
  // ...
});
```

---

## ÉTAPE 2 — STATUS DE setup.html ✅ VÉRIFIÉE

Fichier: `derewolprint/renderer/setup.html`

**Utilisation confirmée:**

- ✅ Appel IPC: `window.electronAPI.register(...)` (ligne 634)
- ✅ Validation email/phone avant appel
- ✅ Try/catch pour erreurs

**Problème possible:** Les logs de diagnostic ne s'affichent PAS.

**Logs ajoutés (ÉTAPE 4 - en cours):**

```javascript
try {
  console.log("[SETUP] electronAPI disponible:", typeof window.electronAPI);
  console.log(
    "[SETUP] register disponible:",
    typeof window.electronAPI?.register,
  );
  console.log("[SETUP] Appel register avec:", { email, name, phone, slug });

  const result = await window.electronAPI.register({
    email,
    name,
    phone,
    slug,
  });
  console.log("[SETUP] ✅ register réponse:", result);
  // ...
} catch (error) {
  console.error("[SETUP] ❌ Exception lors de register:", error.message);
  console.error("[SETUP] Stack:", error.stack);
  // ...
}
```

---

## ÉTAPE 3 — STATUS DU PRELOAD PATH ✅ VÉRIFIÉE

Fichier: `derewolprint/main/main.js` ligne 818, dans `showAuthWindow()`

```javascript
authWindow = new BrowserWindow({
  // ...
  webPreferences: {
    preload: path.join(__dirname, "../preload/preload.js"), // ✅ CORRECT
    contextIsolation: true,
    nodeIntegration: false,
  },
});

authWindow.loadFile(path.join(__dirname, "../renderer/setup.html")); // ✅ CORRECT
```

**Vérification:**

- `__dirname` = `/main`
- `../preload/preload.js` = `/preload/preload.js` ✅
- `../renderer/setup.html` = `/renderer/setup.html` ✅

---

## ÉTAPE 4 — HANDLER `auth:register` ENREGISTREMENT

Fichier: `derewolprint/main/main.js` ligne 865

**Status:** ❓ À CHERCHER

```javascript
ipcMain.handle("auth:register", async (_, { name, slug, email, phone }) => {
  console.log("[REGISTER] ▶ Début registration:", { name, slug, email });
  // ...
});
```

**Questions:**

1. ❓ Le handler **commence à quel ligne exactement** ?
2. ❓ Le handler est-il **au niveau racine du fichier** ou dans une fonction ?
3. ❓ Y a-t-il un **try/catch qui avale l'erreur** avant le console.log ?
4. ❓ Les dépendances (`supabase`, `supabaseAdmin`) sont-elles **initialisées avant** le handler ?

---

## NEXT STEPS — PROCHAINS TESTS

### Test 1: Ouvrir DevTools de setup.html

```bash
cd derewolprint
npm start
```

- Clic droit dans la fenêtre auth → **Inspect** (DevTools)
- Aller à l'onglet **Console**
- Remplir le formulaire (nom, email, téléphone)
- Cliquer **"Créer mon espace"**
- Regarder la **Console DevTools**

**Attendu:**

```
[SETUP] electronAPI disponible: object ← DOIT VOIR
[SETUP] register disponible: function     ← DOIT VOIR
[SETUP] Appel register avec: { email, name, phone, slug }
--- Puis dans le terminal Electron ---
[REGISTER] ▶ Début registration: { ... }
```

**Si on voit:**

- `electronAPI disponible: undefined` → Preload ne charge pas
- `register disponible: undefined` → Preload n'expose pas register
- Aucun log → setup.html ne lance pas l'appel (validation email/phone?)
- Exception → Erreur réseau IPC

---

## 1. Handler `auth:register` in `main/main.js` (lines 865-967)

```javascript
ipcMain.handle("auth:register", async (_, { name, slug, email, phone }) => {
  console.log("[REGISTER] ▶ Début registration:", { name, slug, email });

  try {
    const { supabaseAdmin } = require("../services/supabase");
    if (!supabaseAdmin) {
      return {
        success: false,
        error:
          "Service role key non configurée — impossible de créer l'utilisateur.",
      };
    }

    // ── 1. Créer user Supabase Auth ──────────────────────────────────────────
    const tempPassword = `dwp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password: tempPassword,
      options: { data: { library_name: name, phone: phone || null } },
    });

    if (signUpErr) {
      console.error("[REGISTER] ❌ signUp error:", signUpErr.message);
      return { success: false, error: signUpErr.message };
    }
    if (!signUpData?.user) {
      console.error("[REGISTER] ❌ Pas de user retourné");
      return { success: false, error: "Création du compte échouée." };
    }

    console.log("[REGISTER] ✅ User créé:", signUpData.user.id);

    // ── 1.5 Vérifier que le slug est disponible ──────────────────────────────
    const { data: existingSlug } = await supabaseAdmin
      .from("printers")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingSlug) {
      console.error("[REGISTER] ❌ Slug déjà utilisé:", slug);
      // Nettoyer le user Supabase Auth créé
      await supabaseAdmin.auth.admin.deleteUser(signUpData.user.id);
      return {
        success: false,
        error: `L'identifiant "${slug}" est déjà utilisé. Choisissez un autre nom de boutique.`,
      };
    }
    console.log("[REGISTER] ✅ Slug disponible:", slug);

    // ── 2. Créer printer en DB ───────────────────────────────────────────────
    const { data: printer, error: printerErr } = await supabaseAdmin
      .from("printers")
      .insert({
        auth_user_id: signUpData.user.id,
        name,
        slug,
        email,
        owner_phone: phone || null,
        revoked: false,
        created_at: new Date().toISOString(),
      })
      .select("id, name, slug, email, owner_phone")
      .single();

    if (printerErr) {
      console.error("[REGISTER] ❌ printer insert error:", printerErr.message);
      return { success: false, error: printerErr.message };
    }

    console.log("[REGISTER] ✅ Printer inséré:", printer.id);

    // ── 3. Sauvegarder config locale ─────────────────────────────────────────
    console.log("[REGISTER] Sauvegarde config locale...");
    const { saveConfig } = require("../services/printerConfig");
    saveConfig({
      setupComplete: true,
      printerId: printer.id,
      printerName: printer.name,
      printerSlug: printer.slug,
      printerEmail: printer.email,
      ownerPhone: phone || null,
    });
    console.log("[REGISTER] ✅ Config locale sauvegardée");

    // ── 4. Stocker en mémoire ────────────────────────────────────────────────
    printerCfg = { ...printer };
    console.log("[REGISTER] ✅ printerCfg en mémoire:", printerCfg.id);

    // ── 5. Ouvrir main window ─────────────────────────────────────────────────
    console.log("[REGISTER] Ouverture main window...");
    isTransitioningToMain = true;
    showMainWindow(printer); // NE PAS await — sinon le return { success } bloque

    console.log("[REGISTER] ✅ showMainWindow appelé");
    return { success: true, printer };
  } catch (e) {
    console.error("[REGISTER] ❌ Exception non gérée:", e.message, e.stack);
    return { success: false, error: e.message };
  }
});
```

---

## 2. Handler `btn-register` click in `renderer/setup.html` (lines 607-679)

```javascript
btnRegister.addEventListener("click", async () => {
  const name = inputName.value.trim();
  const slug = currentSlug;
  const phone = inputPhone.value.trim();

  btnRegister.disabled = true;
  btnRegister.textContent = "Création en cours...";

  const email = inputEmail.value.trim();
  const phoneDigits = phone.replace(/\D/g, "");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    errEmail.style.display = "block";
    btnRegister.disabled = false;
    btnRegister.textContent = "Créer mon compte";
    return;
  }

  if (phoneDigits.length < 9) {
    errPhone.style.display = "block";
    btnRegister.disabled = false;
    btnRegister.textContent = "Créer mon compte";
    return;
  }

  try {
    // ── DIAGNOSTIC LOGS ──────────────────────────────────────────────
    console.log("[SETUP] electronAPI disponible:", typeof window.electronAPI);
    console.log(
      "[SETUP] register disponible:",
      typeof window.electronAPI?.register,
    );
    console.log("[SETUP] Appel register avec:", { email, name, phone, slug });

    const result = await window.electronAPI.register({
      email,
      name,
      phone,
      slug,
    });

    console.log("[SETUP] ✅ register réponse:", result);

    if (result.success) {
      document.getElementById("form-screen").style.display = "none";
      const successScreen = document.getElementById("success-screen");
      successScreen.style.display = "block";
      document.getElementById("success-msg").textContent =
        `Votre QR code est prêt. Les clients pourront scanner et envoyer leurs fichiers directement à "${name}".`;

      // ✅ NE PAS appeler authComplete ici
      // showMainWindow() est déjà appelé dans le handler auth:register côté main.js
      // Juste afficher un message de transition
      document.getElementById("btn-continue").textContent =
        "Ouverture de DerewolPrint...";
      document.getElementById("btn-continue").disabled = true;
    } else {
      btnRegister.disabled = false;
      btnRegister.textContent = "Créer mon compte";

      // Handle duplicate slug error: re-check availability and show error
      if (
        result.error.includes("slug") &&
        result.error.includes("déjà utilisé")
      ) {
        errSlug.style.display = "block";
        slugAvail.className = "avail nok";
        slugAvail.innerHTML =
          '<i class="fa-solid fa-circle-xmark"></i> Déjà utilisé';
        slugValid = false;
      } else {
        alert("Erreur : " + result.error);
      }
    }
  } catch (error) {
    console.error("[SETUP] ❌ Exception lors de register:", error.message);
    console.error("[SETUP] Stack:", error.stack);
    alert("Erreur lors de l'enregistrement: " + error.message);
    btnRegister.disabled = false;
    btnRegister.textContent = "Créer mon compte";
  }
});
```

---

## Summary

- **Main.js handler**: Creates Supabase user, checks slug availability, inserts printer record, saves local config, stores in memory, then calls `showMainWindow()` directly
- **Setup.html handler**: Validates email/phone, calls `register()` IPC, displays success screen when successful, and disables the continue button to prevent user from manually triggering app open
- **Diagnostic logs added**: DevTools will show if electronAPI is available and if register is callable
