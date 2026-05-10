/**
 * renderer.js — EXTRAIT : startPrinterStatusPolling()
 * Remplace ta fonction existante par ce bloc complet.
 *
 * RÈGLES :
 *  - Le dot est TOUJOURS visible (jamais display:none ni opacity:0)
 *  - Jaune = en cours de vérification (état transitoire uniquement au 1er tick)
 *  - Vert  = online
 *  - Rouge = offline / erreur / timeout
 *  - Polling toutes les 30s, premier check immédiat
 */

const PRINTER_POLL_MS = 30_000;
let   _printerPollTimer = null;

/**
 * Met à jour le dot visuellement + active/désactive les boutons d'impression
 * @param {'checking'|'online'|'offline'} state
 * @param {string} [tooltip]
 */
function setPrinterDotState(state, tooltip = '') {
  const dot = document.getElementById('printer-status-dot');
  if (!dot) {
    console.warn('[Renderer][PrinterDot] #printer-status-dot introuvable dans le DOM');
    return;
  }

  // Toujours visible
  dot.style.display      = 'inline-block';
  dot.style.opacity      = '1';
  dot.style.visibility   = 'visible';

  // Retirer toutes les classes d'état précédentes
  dot.classList.remove('dot-checking', 'dot-online', 'dot-offline');

  switch (state) {
    case 'checking':
      dot.classList.add('dot-checking');       // jaune/pulsé — CSS défini dans renderer.css
      dot.title = tooltip || 'Vérification de l\'imprimante…';
      break;
    case 'online':
      dot.classList.add('dot-online');         // vert
      dot.title = tooltip || 'Imprimante en ligne';
      break;
    case 'offline':
    default:
      dot.classList.add('dot-offline');        // rouge
      dot.title = tooltip || 'Imprimante hors ligne ou introuvable';
      break;
  }

  console.log(`[Renderer][PrinterDot] état → ${state} | tooltip : "${dot.title}"`);
}

/**
 * Effectue un seul check et met à jour le dot + boutons
 */
async function checkPrinterOnce() {
  console.log('[Renderer][PrinterDot] checkPrinterOnce() démarré');

  // Marquer "en cours" uniquement si on était hors-ligne (évite le flash jaune inutile)
  const dot = document.getElementById('printer-status-dot');
  const wasOnline = dot?.classList.contains('dot-online');
  if (!wasOnline) {
    setPrinterDotState('checking');
  }

  try {
    // window.derewol.checkPrinterStatus() est exposé par preload.js
    const result = await window.derewol.checkPrinterStatus();

    console.log('[Renderer][PrinterDot] résultat IPC :', result);

    if (!result || typeof result.online !== 'boolean') {
      console.error('[Renderer][PrinterDot] résultat invalide → offline forcé');
      setPrinterDotState('offline', 'Réponse invalide du processus principal');
      updatePrintButtons(false);
      return;
    }

    const tooltip = result.name
      ? `${result.name} — ${result.online ? 'En ligne' : 'Hors ligne'} (${result.method})`
      : result.online ? 'Imprimante en ligne' : 'Imprimante hors ligne';

    setPrinterDotState(result.online ? 'online' : 'offline', tooltip);
    updatePrintButtons(result.online);

  } catch (err) {
    console.error('[Renderer][PrinterDot] checkPrinterStatus() rejeté :', err);
    setPrinterDotState('offline', `Erreur : ${err.message}`);
    updatePrintButtons(false);
  }
}

/**
 * Lance le polling périodique — appeler UNE SEULE FOIS au DOMContentLoaded
 */
function startPrinterStatusPolling() {
  console.log('[Renderer][PrinterDot] startPrinterStatusPolling() initialisé');

  // Arrêter un éventuel polling précédent
  if (_printerPollTimer) {
    clearInterval(_printerPollTimer);
    _printerPollTimer = null;
  }

  // Premier check immédiat
  checkPrinterOnce();

  // Polling régulier
  _printerPollTimer = setInterval(() => {
    console.log('[Renderer][PrinterDot] tick polling 30s');
    checkPrinterOnce();
  }, PRINTER_POLL_MS);
}

/**
 * Arrêter le polling proprement (ex : avant rechargement)
 */
function stopPrinterStatusPolling() {
  if (_printerPollTimer) {
    clearInterval(_printerPollTimer);
    _printerPollTimer = null;
    console.log('[Renderer][PrinterDot] polling arrêté');
  }
}

// ─── CSS à ajouter dans renderer.css ──────────────────────────────────────────
/*
#printer-status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
  transition: background-color 0.3s ease;
}

#printer-status-dot.dot-online {
  background-color: #22c55e;   /* vert  * /
  box-shadow: 0 0 4px #22c55e88;
}

#printer-status-dot.dot-offline {
  background-color: #ef4444;   /* rouge * /
  box-shadow: 0 0 4px #ef444488;
}

#printer-status-dot.dot-checking {
  background-color: #eab308;   /* jaune * /
  animation: dot-pulse 1s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
*/
