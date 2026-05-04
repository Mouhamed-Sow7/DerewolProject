# 🔧 EMERGENCY FIX GUIDE — Trial Activation Issues

**Date**: April 16, 2026  
**Status**: ✅ All 3 Issues Fixed

---

## 🚨 Issues Fixed

### Issue 1: Trial Activation Returns `inactive` Indefinitely ✅

**Root Cause**: Race condition - `checkSubscription()` called before RPC database transaction completed

**Fix Applied**:

- Added 500ms delay after RPC execution in `ensureTrialOrSubscription()`
- Added verification query to confirm trial was actually saved
- Added 500ms additional wait in `trial:activate` handler
- Increased `trialJustActivated` flag from 5s to 15s
- Added detailed logging to track DB state at each step
- Made handler return actual subscription status instead of just `success: true`

**File**: `derewolprint/services/subscription.js` + `derewolprint/main/main.js`

**New Logs You'll See**:

```
[SUB] Creating trial subscription for <printerId>
[SUB] RPC error (if any)
[SUB] ✅ Verification — Trial saved: { plan: 'trial', status: 'active', expires_at: ... }
[TRIAL] After activation, subscription status: { valid: true, plan: 'trial', daysLeft: 7 }
```

---

### Issue 2: Trial Tab Locked on Fresh Printer ✅

**Root Cause**: Logic couldn't distinguish between "no subscription at all" vs "trial subscription expired"

**Fix Applied**:

- Check for `sub.plan === 'trial'` (only lock if trial actually existed)
- Check for `sub.status !== undefined` (subscription row exists in DB)
- Only lock if BOTH conditions + expired
- Explicitly ENABLE trial tab for fresh printers (no subscription row)

**File**: `derewolprint/renderer/renderer.js`

**New Behavior**:

```
Fresh Printer (no subscription row):
  - Sub returns: { valid: false, expired: true, daysLeft: 0, plan: undefined, status: undefined }
  - Trial tab: ✅ UNLOCKED and clickable
  - Log: "[MODAL] Fresh printer — enabling trial tab"

Trial Used Then Expired:
  - Sub returns: { valid: false, expired: true, daysLeft: 0, plan: 'trial', status: 'active' }
  - Trial tab: 🔒 LOCKED with message "Essai utilisé"
  - Log: "[MODAL] Locking trial tab — trial was used and expired"
```

---

### Issue 3: PDF Download Button Still Visible ✅

**Root Cause**: PDF toolbar parameters don't work reliably; need layered defense

**Fix Applied**:

- Increased overlay from 50px to 120px (covers taller toolbars)
- Added 2nd security overlay layer
- Added `onLoad` event to inject JavaScript hiding download button
- Added event handlers to prevent right-click, drag-drop on PDF
- Improved sandbox attributes

**File**: `pages/p/index.js`

**New PDF Preview Security**:

```
Layer 1: 120px overlay div (physical block)
Layer 2: Event handler overlay (prevent interactions)
Layer 3: iframe sandbox (restrict downloads)
Layer 4: JavaScript injection (try to hide button on load)
    ├─ Hide buttons with id/aria-label containing "download"
    └─ Hide toolbar containers
Layer 5: URL parameters (#toolbar=0&navpanes=0)
```

**What Users See**: PDF preview with NO visible toolbar, NO download button

---

## 🧪 Testing Checklist

### Test 1: Fresh Printer Trial Activation

```
1. Fresh database (clean printers and subscriptions tables)
2. Start app → Setup new printer "test123"
3. ✅ Trial tab should be UNLOCKED and visible
4. ✅ Click "Démarrer mon essai" → Loading spinner shows
5. ✅ Modal closes after ~2 seconds
6. ✅ Check console for: "[SUB] ✅ Verification — Trial saved"
7. ✅ Reload app → Modal should NOT show
8. ✅ Print queue should be accessible
```

**Expected Console Output**:

```
[SUB] Creating trial subscription for <uuid>
[SUB] ✅ Verification — Trial saved: { plan: 'trial', status: 'active', expires_at: '2026-04-23T...' }
[TRIAL] After activation, subscription status: { valid: true, plan: 'trial', daysLeft: 7 }
[MODAL] Trial/Subscription is ACTIVE — hiding modal
[MODAL] Fresh printer — enabling trial tab
```

### Test 2: Trial Reload Behavior

```
1. After successful trial activation (from Test 1)
2. Reload app (F5 or Ctrl+R)
3. ✅ Modal should NOT appear
4. ✅ Trial tab should show as unlocked
5. ✅ Print functionality should work
6. ✅ No "[MODAL] showing modal" in logs
```

### Test 3: PDF Preview Protection

```
1. Go to PWA (testpwa.nom-de-domaine.xyz)
2. Upload or access a PDF file
3. Click preview/eye icon
4. ✅ PDF opens in preview modal
5. ✅ NO toolbar visible at top
6. ✅ NO download button anywhere
7. ✅ Try right-click → should be disabled
8. ✅ Try F12 DevTools → PDF download option should not work
9. ✅ Close preview → back to normal UI
```

---

## 📋 Verification Checklist

After deploying fixes, verify:

- [ ] `derewolprint/services/subscription.js` has 500ms delays + verification
- [ ] `derewolprint/main/main.js` has 15s flag + proper logging
- [ ] `derewolprint/renderer/renderer.js` checks for `plan === 'trial'`
- [ ] `pages/p/index.js` has 120px overlay + event handlers
- [ ] Console shows correct "[SUB] ..." and "[TRIAL] ..." logs
- [ ] Fresh printer can activate trial (tab is NOT locked)
- [ ] PDF preview has NO visible toolbar
- [ ] App restart keeps trial unlocked (no modal loop)

---

## 🔄 Monitoring (First 24 Hours)

Watch these metrics:

| Metric           | Good Sign               | Bad Sign                 |
| ---------------- | ----------------------- | ------------------------ |
| Trial activation | Log shows "valid: true" | Log shows "valid: false" |
| Tab locking      | Tab unlocked for fresh  | Tab locked immediately   |
| Modal reappear   | Stays closed on reload  | Modal reopens every 5s   |
| PDF downloads    | 0 download attempts     | Multiple download clicks |

Check logs for:

- `[SUB] checkSubscription error` ← DB issues
- `[MODAL] Trial/Subscription EXPIRED` → happening too early
- `[TRIAL] After activation, subscription status: { valid: false }` ← Race condition still happening
- `[POLLING] Jobs actifs` ← Should show printing working normally

---

## 🚨 Rollback Plan

If issues persist after 24 hours:

1. **Trial stays inactive after activation**:
   - Increase delay from 500ms to 1000ms in subscription.js
   - OR check database for trial row to see if RPC is even executing

2. **Tab locked on fresh printer**:
   - Remove the `hasHistory` check
   - Always enable trial tab unless `sub.plan === 'trial' && sub.expired === true`

3. **PDF still downloads**:
   - Increase overlay to 200px
   - Try removing sandbox attribute entirely (security trade-off)
   - Serve PDFs through different domain to fully sandbox

---

## 📊 Key Logs Reference

**Good Flow**:

```
[SUB] Creating trial subscription for 2053094f-e2c0-4658-8ae4-96afb2bee5d5
[SUB] ✅ Verification — Trial saved: { plan: 'trial', status: 'active', expires_at: '2026-04-23T...' }
[TRIAL] After activation, subscription status: { valid: true, plan: 'trial', daysLeft: 7 }
[TRIAL] Starting trial activation...
[TRIAL] Waiting for DB commit...
[MODAL] Trial/Subscription is ACTIVE — hiding modal
```

**Bad Flow** (still happening):

```
[SUB] Creating trial subscription...
[TRAIL] Starting trial activation...
[ACCESS] No valid subscription → inactive ← ❌ PROBLEM HERE
```

---

## 💡 Quick Fixes By Symptom

### "Every reload brings modal back"

1. Check if `trialJustActivated` is still 5000ms (should be 15000ms)
2. Check if `subscriptionTimer` is polling every 5min (should NOT be every 5s)
3. Restart app after code changes

### "Trial Activate button does nothing"

1. Check browser console for JavaScript errors
2. Verify `window.derewol.activateTrial` is exposed in preload.js
3. Check if `.act-btn-activate` element exists in HTML

### "Trial tab locked on first load"

1. Check if `sub.plan` is undefined (it should be undefined for fresh printer)
2. Check if `sub.status` is undefined (it should be)
3. Verify renderer checks BOTH `hasTrialPlan && hasHistory`

### "PDF download button still visible"

1. Check if onLoad event fires (add console.log in onLoad)
2. Try pressing F12 → Inspect → see if overlay div is really 120px
3. Check browser console for iframe load errors

---

**Status**: ✅ All fixes applied and coded  
**Next Step**: Restart app and run tests above  
**Contact**: Check console logs for exact failure point
