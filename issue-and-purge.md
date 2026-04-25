# Issue and Purge System Review

## Overview
This document captures the current failure points in the DerewolPrint system and defines a unified purge/refactor plan for both the PWA and Electron sides.

The system currently suffers from:
- inconsistent group and job status handling
- premature expiry and cleanup of active printing flows
- unreliable PWA history rendering
- duplicated state logic across the front-end and Electron backend

The goal is to treat this as one coherent system rather than isolated fixes.

---

## PWA Section

### Current issues
- `pages/p/index.js` mixes `file_groups.status`, `print_jobs.status`, and file-level flags to determine UI sections.
- `partial_completed` groups are not consistently rendered as history or partial results.
- The active queue can disappear after the first completed file because group status may already be finalized in the backend.
- History depends on transient job records that may have been deleted or expired before the UI can display them.

### Paths to fix
1. Normalize the status model in the PWA:
   - `waiting`
   - `printing`
   - `completed`
   - `partial`
   - `failed`
   - `expired`
2. Use a stable fetch layer from `lib/supabase.js` that returns derived group status and file-level job state.
3. Separate UI sections clearly:
   - active groups = groups with pending or printing files
   - history groups = completed / partial / rejected / expired groups
4. Ensure the `Historique` section is always rendered when there are history groups, even if the active queue is empty.
5. Do not rely solely on the presence of `print_jobs` rows if the backend can delete them after cleanup.

### Recommended changes
- In `lib/supabase.js`, derive a consistent `status` for each `file_groups` record.
- In `pages/p/index.js`, classify groups by the derived status, not by the raw DB status alone.
- Render `partial_completed` as `Partiel` in the UI and include it in history.
- Add stable labels and badges for file-level statuses.

---

## Electron Section

### Current issues
- `derewolprint/main/main.js` finalizes `file_groups.status` too early inside `printSingleJobNoDelay()`.
- This causes a multi-file print group to be marked completed after the first successful file.
- `derewolprint/services/polling.js` treats expired queued jobs too aggressively, deleting storage and marking groups expired while printing may still be active.
- There is redundancy and mismatch between `file_groups.status` and `print_jobs.status`.

### Paths to fix
1. Change `printSingleJobNoDelay()` so it only updates the current `print_job`.
2. Keep group status at `printing` while any job in the group is still queued or printing.
3. Finalize the group status only once after all files in the group are processed.
4. Preserve error/failure details in the job record for retries and diagnostics.
5. Only expire `queued` jobs, never `printing` jobs, and only clean storage once the group is confirmed expired.

### Recommended changes
- In `main.js`:
  - remove premature `file_groups.status = "completed"` inside single-file print helper
  - derive final group status from the actual result set at the end of the print group flow
  - support `partial_completed` as a valid and meaningful final state
- In `services/polling.js`:
  - run expiry only on `queued` jobs whose `expires_at` has passed
  - do not touch `printing` jobs during normal expiration checks
  - clean files and groups only after expiration is confirmed

---

## Purge Plan

### Purpose
The purge plan must remove stale data safely without affecting active printing sessions or losing history.

### Purge rules
1. Only purge groups that are definitively expired.
   - A group is expired if all its jobs are `expired` or all files are rejected.
   - A group with any `printing` or `queued` job should not be purged.
2. Only purge `print_jobs` when the job is either completed, failed, rejected, or expired.
3. Only delete storage paths when the associated group is finalized and no retry or recovery path can use the file.
4. Keep history insertion separate from purge/cleanup.

### Suggested expiration workflow
1. Find `print_jobs` with `status = queued` and `expires_at < now`.
2. Mark those jobs as `expired`.
3. For each affected group, if no job remains in `queued` or `printing`, mark the group as `expired`.
4. Delete storage only for groups that are `expired` and have no active pending jobs.
5. Keep `history` records intact for all finalized groups.

### Suggested cleanup workflow
- Completed job cleanup can remove `print_jobs` rows after a delay, but only after group status is finalized.
- Storage cleanup can happen after the print delay, but only if the job or group is no longer active.
- Do not remove file records from `files` until the history UI can safely render them if needed.

---

## System refactor priorities

1. Fix Electron group finalization logic first.
2. Fix polling/expiration so active jobs are not purged.
3. Normalize state derivation in the PWA data layer.
4. Restore history rendering using stable group status and history records.
5. Add a clean system-wide status model document once the previous steps are done.

---

## Notes
- This is not a CSS-only fix; the root cause is state management and lifecycle handling.
- The PWA and Electron sides must share the same state vocabulary for `waiting`, `printing`, `completed`, `partial`, `failed`, and `expired`.
- Once the fix is implemented, a separate refactor should eliminate redundant status fields and unify the logic across the whole system.
