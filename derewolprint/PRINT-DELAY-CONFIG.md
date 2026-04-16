# Print Delay Configuration

## What is This?

When you send a file to print, the system doesn't wait for the printer to **physically finish printing**. Instead, it:

1. Sends the file to the Windows print spooler ✓
2. **Immediately** deletes the file from storage ❌
3. **Immediately** marks the print job as "completed" ❌

If the printer jams, runs out of paper, or goes offline during printing, the file is already gone and the system thinks it succeeded.

## The Fix

A **delay** is now applied before deleting files. This gives the printer time to handle potential errors.

### Default Configuration

```javascript
const PRINT_DELAY_MS = 30000; // 30 seconds
```

**Location:** [`derewolprint/main/main.js`](main/main.js) (line ~34)

### Adjusting the Delay

Edit the `PRINT_DELAY_MS` constant in `main.js`:

| Delay          | Value    | Use Case                       |
| -------------- | -------- | ------------------------------ |
| **10 seconds** | `10000`  | Fast, small files              |
| **20 seconds** | `20000`  | Default safe                   |
| **30 seconds** | `30000`  | **DEFAULT** - Recommended      |
| **60 seconds** | `60000`  | Slow printer or network issues |
| **2 minutes**  | `120000` | Heavily loaded printer         |

### What Happens During the Delay

While waiting:

- ✓ File stays in Supabase storage (can be recovered if needed)
- ✓ Print job status is "completed" (appears done in UI)
- ✓ User sees success message
- ⏳ System waits in background before cleaning up
- ✓ If printer fails, file is still available for recovery

### Monitoring

Check the console logs to see the delay in action:

```
[PRINT] ⏳ Attente 30s avant suppression (laisser le temps à l'imprimante)...
[PRINT] exemple-fichier.pdf → Storage supprimé ✅
```

---

## Future Improvements

Potential enhancements:

- Monitor printer queue status before deleting
- Configurable delay per printer
- Database flag to prevent premature deletion
- Webhook confirmation from printer driver
