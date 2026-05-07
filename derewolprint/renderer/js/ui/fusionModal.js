// renderer/js/ui/fusionModal.js
// Module Fusion CNI — canvas pur JS, zéro dépendance
// Flow : 2 fichiers sélectionnés → téléchargement Supabase → canvas preview → filtres → PDF → remplace les 2 fichiers

const FUSION_PRESETS = [
  {
    id: "original",
    label: "Original",
    icon: "🖼️",
    filters: {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      grayscale: 0,
      sharpen: 0,
    },
  },
  {
    id: "print_bw",
    label: "Impression N&B",
    icon: "🖨️",
    filters: {
      brightness: 105,
      contrast: 120,
      saturation: 0,
      grayscale: 100,
      sharpen: 15,
    },
  },
  {
    id: "enhance",
    label: "Amélioré",
    icon: "✨",
    filters: {
      brightness: 108,
      contrast: 115,
      saturation: 110,
      grayscale: 0,
      sharpen: 20,
    },
  },
  {
    id: "document",
    label: "Document",
    icon: "📄",
    filters: {
      brightness: 110,
      contrast: 130,
      saturation: 80,
      grayscale: 0,
      sharpen: 10,
    },
  },
  {
    id: "scan",
    label: "Scan",
    icon: "📷",
    filters: {
      brightness: 95,
      contrast: 140,
      saturation: 60,
      grayscale: 30,
      sharpen: 25,
    },
  },
];

// État global de la modal
let _state = {
  files: [], // [{ jobId, fileId, fileName, storagePath, url, img, label }]
  layout: "horizontal", // horizontal | vertical
  preset: "original",
  filters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    grayscale: 0,
    sharpen: 0,
  },
  canvas: null,
  ctx: null,
  onComplete: null, // callback(pdfBlob, fileName)
};

// ── Entrée publique ──────────────────────────────────────────────────
export async function openFusionModal(selectedFiles, onComplete) {
  // selectedFiles = [{ jobId, fileId, fileName, storagePath }, ...]
  if (selectedFiles.length !== 2) return;

  const existing = document.getElementById("fusion-modal-overlay");
  if (existing) existing.remove();

  _state = {
    files: selectedFiles.map((f, i) => ({
      ...f,
      label: i === 0 ? "Recto" : "Verso",
      url: null,
      img: null,
    })),
    layout: "horizontal",
    preset: "original",
    filters: { ...FUSION_PRESETS[0].filters },
    rotations: [0, 0],
    scales: [1, 1],
    offsets: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    dragging: null,
    canvas: null,
    ctx: null,
    onComplete,
  };

  _buildModal();
  await _loadImages();
  _renderCanvas();
}

// ── Construction DOM ─────────────────────────────────────────────────
function _buildModal() {
  const overlay = document.createElement("div");
  overlay.id = "fusion-modal-overlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:10000;
    background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
    display:flex;align-items:center;justify-content:center;
    font-family:'Inter',sans-serif;
  `;

  overlay.innerHTML = `
    <div id="fusion-modal" style="
      background:#fff;border-radius:16px;border:1px solid #e5e7eb;
      width:780px;max-width:95vw;max-height:92vh;
      display:flex;flex-direction:column;overflow:hidden;
      box-shadow:0 24px 60px rgba(0,0,0,0.25);
    ">
      <!-- Header -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:16px 20px;border-bottom:1px solid #f0f0f0;
        background:#fafafa;flex-shrink:0;
      ">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="
            width:32px;height:32px;border-radius:8px;
            background:#1B5E35;display:flex;align-items:center;justify-content:center;
          ">
            <i class="fa-solid fa-layer-group" style="color:#fff;font-size:13px;"></i>
          </div>
          <div>
            <p style="margin:0;font-size:14px;font-weight:700;color:#111;">Fusion CNI / Recto-Verso</p>
            <p style="margin:0;font-size:11px;color:#888;">2 fichiers → 1 PDF A4</p>
          </div>
        </div>
        <button id="fusion-close" style="
          background:none;border:none;cursor:pointer;
          color:#999;font-size:18px;padding:4px 8px;border-radius:6px;
        "><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body scrollable -->
      <div style="display:flex;flex:1;overflow:hidden;min-height:0;">

        <!-- Panneau gauche : labels + layout + presets + filtres -->
        <div style="
          width:220px;flex-shrink:0;border-right:1px solid #f0f0f0;
          padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;
          background:#fafafa;
        ">

          <!-- Labels recto/verso -->
          <div>
            <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Fichiers</p>
            ${_state.files
              .map(
                (f, i) => `
              <div style="
                display:flex;align-items:center;gap:8px;margin-bottom:6px;
                padding:7px 10px;background:#fff;border-radius:8px;border:1px solid #e5e7eb;
              ">
                <div id="fusion-thumb-${i}" style="
                  width:28px;height:20px;border-radius:4px;
                  background:#f0f0f0;border:1px solid #ddd;
                  display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;
                ">
                  <i class="fa-solid fa-spinner fa-spin" style="font-size:9px;color:#aaa;"></i>
                </div>
                <div style="min-width:0;">
                  <p style="margin:0;font-size:10px;font-weight:600;color:#1B5E35;">${f.label}</p>
                  <p style="margin:0;font-size:10px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="${f.fileName}">${f.fileName}</p>
                </div>
                <button class="fusion-rotate-btn" data-idx="${i}" style="
                  background:none;border:1px solid #e5e7eb;border-radius:5px;
                  cursor:pointer;padding:2px 5px;color:#1B5E35;font-size:10px;
                  margin-left:auto;flex-shrink:0;
                " title="Rotation 90°"><i class="fa-solid fa-rotate-right"></i></button>
                <button class="fusion-swap-label" data-idx="${i}" style="
                  background:none;border:1px solid #e5e7eb;border-radius:5px;
                  cursor:pointer;padding:2px 5px;color:#999;font-size:10px;
                  flex-shrink:0;
                " title="Inverser recto/verso"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>
              </div>
            `,
              )
              .join("")}
          </div>

          <!-- Layout -->
          <div>
            <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Disposition</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <button id="layout-horizontal" class="fusion-layout-btn active-layout" data-layout="horizontal" style="
                padding:8px 4px;border-radius:8px;cursor:pointer;font-size:11px;
                border:2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600;
                display:flex;flex-direction:column;align-items:center;gap:4px;
              ">
                <svg width="28" height="18" viewBox="0 0 28 18"><rect x="1" y="1" width="12" height="16" rx="2" fill="#1B5E35" opacity=".3" stroke="#1B5E35" stroke-width="1.2"/><rect x="15" y="1" width="12" height="16" rx="2" fill="#1B5E35" opacity=".3" stroke="#1B5E35" stroke-width="1.2"/></svg>
                Côte à côte
              </button>
              <button id="layout-vertical" class="fusion-layout-btn" data-layout="vertical" style="
                padding:8px 4px;border-radius:8px;cursor:pointer;font-size:11px;
                border:1px solid #ddd;background:#fff;color:#666;font-weight:400;
                display:flex;flex-direction:column;align-items:center;gap:4px;
              ">
                <svg width="18" height="28" viewBox="0 0 18 28"><rect x="1" y="1" width="16" height="12" rx="2" fill="#666" opacity=".3" stroke="#666" stroke-width="1.2"/><rect x="1" y="15" width="16" height="12" rx="2" fill="#666" opacity=".3" stroke="#666" stroke-width="1.2"/></svg>
                Empilé
              </button>
            </div>
          </div>

          <!-- Presets -->
          <div>
            <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Presets</p>
            <div style="display:flex;flex-direction:column;gap:5px;">
              ${FUSION_PRESETS.map(
                (p) => `
                <button class="fusion-preset-btn" data-preset="${p.id}" style="
                  display:flex;align-items:center;gap:8px;
                  padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;
                  border:${p.id === "original" ? "2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600" : "1px solid #e5e7eb;background:#fff;color:#555;font-weight:400"};
                  text-align:left;width:100%;
                ">
                  <span>${p.icon}</span> ${p.label}
                </button>
              `,
              ).join("")}
            </div>
          </div>

          <!-- Filtres manuels -->
          <div>
            <p style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Filtres</p>
            ${_buildSlider("brightness", "Luminosité", 50, 150)}
            ${_buildSlider("contrast", "Contraste", 50, 200)}
            ${_buildSlider("saturation", "Saturation", 0, 200)}
            ${_buildSlider("grayscale", "Niveaux de gris", 0, 100)}
            ${_buildSlider("sharpen", "Netteté", 0, 50)}
          </div>

        </div>

        <!-- Panneau droit : canvas preview -->
        <div style="
          flex:1;display:flex;flex-direction:column;align-items:center;
          justify-content:center;padding:20px;background:#f8f8f8;
          min-width:0;overflow:hidden;
        ">
          <div style="
            background:#fff;border-radius:4px;
            box-shadow:0 4px 20px rgba(0,0,0,0.12);
            position:relative;overflow:hidden;
            max-width:100%;max-height:calc(92vh - 180px);
          ">
            <canvas id="fusion-canvas" style="display:block;max-width:100%;max-height:calc(92vh - 180px);"></canvas>
            <div id="fusion-loading" style="
              position:absolute;inset:0;display:flex;flex-direction:column;
              align-items:center;justify-content:center;background:#f8f8f8;gap:8px;
            ">
              <i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:#1B5E35;"></i>
              <p style="margin:0;font-size:12px;color:#888;">Chargement des images…</p>
            </div>
          </div>
          <p style="margin:10px 0 0;font-size:11px;color:#aaa;">Aperçu A4 — Les filtres s'appliquent à l'impression</p>
        </div>

      </div>

      <!-- Footer -->
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;border-top:1px solid #f0f0f0;
        background:#fff;flex-shrink:0;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <i class="fa-solid fa-circle-info" style="color:#aaa;font-size:12px;"></i>
          <span style="font-size:11px;color:#999;">Les 2 fichiers originaux seront remplacés par ce PDF fusionné</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="fusion-cancel" style="
            padding:9px 18px;border-radius:8px;border:1px solid #ddd;
            background:#fff;cursor:pointer;font-size:13px;color:#666;
            font-family:'Inter',sans-serif;
          ">Annuler</button>
          <button id="fusion-confirm" style="
            padding:9px 20px;border-radius:8px;border:none;
            background:#D4A017;cursor:pointer;font-size:13px;font-weight:600;
            color:#fff;font-family:'Inter',sans-serif;
            display:flex;align-items:center;gap:6px;
          ">
            <i class="fa-solid fa-file-pdf"></i> Générer & Remplacer
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Canvas ref
  _state.canvas = document.getElementById("fusion-canvas");
  _state.ctx = _state.canvas.getContext("2d");

  // Events
  document
    .getElementById("fusion-close")
    .addEventListener("click", _closeModal);
  document
    .getElementById("fusion-cancel")
    .addEventListener("click", _closeModal);
  overlay.addEventListener("click", (e) => {
    e.stopPropagation();
    // Ne pas fermer au clic backdrop — utiliser uniquement le ✕ et Annuler
  });
  // Prevent backdrop click from closing when clicking inside modal
  document.getElementById("fusion-modal").addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document
    .getElementById("fusion-confirm")
    .addEventListener("click", _generatePDF);

  // Layout buttons
  document.querySelectorAll(".fusion-layout-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _state.layout = btn.dataset.layout;
      _updateLayoutButtons();
      _renderCanvas();
    });
  });

  // Preset buttons
  document.querySelectorAll(".fusion-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = FUSION_PRESETS.find((p) => p.id === btn.dataset.preset);
      _state.preset = preset.id;
      _state.filters = { ...preset.filters };
      _updateSlidersFromFilters();
      _updatePresetButtons();
      _renderCanvas();
    });
  });

  // Sliders
  ["brightness", "contrast", "saturation", "grayscale", "sharpen"].forEach(
    (key) => {
      const slider = document.getElementById(`slider-${key}`);
      const valEl = document.getElementById(`slider-val-${key}`);
      if (!slider || !valEl) return;
      slider.addEventListener("input", () => {
        _state.filters[key] = Number(slider.value);
        valEl.textContent = slider.value;
        _renderCanvas();
      });
    },
  );

  // Swap labels
  document.querySelectorAll(".fusion-swap-label").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      if (idx === 0) {
        _state.files.reverse();
      } else {
        _state.files.reverse();
      }
      _state.files[0].label = "Recto";
      _state.files[1].label = "Verso";
      _renderCanvas();
      _updateThumbs();
    });
  });

  // Rotation buttons
  document.querySelectorAll(".fusion-rotate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      if (!_state.rotations) _state.rotations = [0, 0];
      _state.rotations[idx] = (_state.rotations[idx] + 90) % 360;
      if (_state.files[idx]?.img) _updateThumb(idx, _state.files[idx].img);
      _renderCanvas();
    });
  });

  // ── Drag pour repositionner ──────────────────────────────────────────
  const canvas = document.getElementById("fusion-canvas");

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const A4W = 560,
      A4H = 792,
      MARGIN = 16;

    // Détecter quelle cellule est cliquée
    let idx = -1;
    if (_state.layout === "horizontal") {
      const cellW = (A4W - MARGIN * 3) / 2;
      idx = mx < MARGIN + cellW ? 0 : 1;
    } else {
      const cellH = (A4H - MARGIN * 3) / 2;
      idx = my < MARGIN + cellH ? 0 : 1;
    }
    if (idx < 0 || !_state.files[idx]?.img) return;

    _state.dragging = {
      idx,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: (_state.offsets || [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ])[idx].x,
      startOffsetY: (_state.offsets || [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ])[idx].y,
    };
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!_state.dragging) return;
    const { idx, startX, startY, startOffsetX, startOffsetY } = _state.dragging;
    const scaleRatio = canvas.width / canvas.getBoundingClientRect().width;
    _state.offsets[idx].x = startOffsetX + (e.clientX - startX) * scaleRatio;
    _state.offsets[idx].y = startOffsetY + (e.clientY - startY) * scaleRatio;
    _renderCanvas();
  });

  canvas.addEventListener("mouseup", () => {
    _state.dragging = null;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("mouseleave", () => {
    _state.dragging = null;
    canvas.style.cursor = "grab";
  });

  // ── Scroll pour zoomer ───────────────────────────────────────────────
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const A4W = 560,
        A4H = 792,
        MARGIN = 16;

      let idx = -1;
      if (_state.layout === "horizontal") {
        const cellW = (A4W - MARGIN * 3) / 2;
        idx = mx < MARGIN + cellW ? 0 : 1;
      } else {
        const cellH = (A4H - MARGIN * 3) / 2;
        idx = my < MARGIN + cellH ? 0 : 1;
      }
      if (idx < 0 || !_state.files[idx]?.img) return;

      if (!_state.scales) _state.scales = [1, 1];
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      _state.scales[idx] = Math.max(
        0.2,
        Math.min(3, _state.scales[idx] + delta),
      );
      _renderCanvas();
    },
    { passive: false },
  );

  canvas.style.cursor = "grab";
}

function _buildSlider(key, label, min, max) {
  const val = _state.filters[key];
  return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:11px;color:#666;">${label}</span>
        <span id="slider-val-${key}" style="font-size:11px;color:#1B5E35;font-weight:600;">${val}</span>
      </div>
      <input type="range" id="slider-${key}" min="${min}" max="${max}" value="${val}" style="
        width:100%;accent-color:#1B5E35;height:4px;cursor:pointer;
      ">
    </div>
  `;
}

// ── Chargement images ────────────────────────────────────────────────
async function _loadImages() {
  // Réutilise le pdfjsLib déjà chargé par viewerPreload.js (même instance v3.11 que le viewer)
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    console.error("[FUSION] pdfjsLib non disponible sur window");
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const promises = _state.files.map(async (file, i) => {
    try {
      const isPdf =
        file.fileName?.toLowerCase().endsWith(".pdf") ||
        file.mimeType === "application/pdf";

      if (isPdf) {
        // PDF → canvas via pdfjs + IPC (évite CSP)
        // Main process télécharge + déchiffre, renderer reçoit le buffer
        const { buffer, fileName } = await window.derewol.getFusionPreview(
          file.fileId,
        );
        const uint8 = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({ data: uint8 });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1); // première page

        const viewport = page.getViewport({ scale: 1.5 });
        const offscreen = document.createElement("canvas");
        offscreen.width = viewport.width;
        offscreen.height = viewport.height;
        const ctx = offscreen.getContext("2d");

        await page.render({ canvasContext: ctx, viewport }).promise;

        // Convertir canvas en Image
        const img = new Image();
        img.src = offscreen.toDataURL("image/png");
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        file.img = img;
        file.pageCount = pdf.numPages; // utile pour recto/verso
        _updateThumb(i, img);
      } else {
        // Image normale (PNG, JPG) — passer par IPC aussi pour cohérence CSP
        const { buffer, fileName } = await window.derewol.getFusionPreview(
          file.fileId,
        );
        const blob = new Blob([new Uint8Array(buffer)]);
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        file.img = img;
        _updateThumb(i, img);
      }
    } catch (err) {
      console.error("[FUSION] Erreur chargement fichier", file.fileName, err);
    }
  });

  await Promise.all(promises);
  const loading = document.getElementById("fusion-loading");
  if (loading) loading.style.display = "none";
}

function _updateThumb(idx, img) {
  const el = document.getElementById(`fusion-thumb-${idx}`);
  if (!el || !img) return;
  const rot = (_state.rotations && _state.rotations[idx]) || 0;
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 56;
  thumbCanvas.height = 40;
  const tc = thumbCanvas.getContext("2d");
  tc.save();
  tc.translate(28, 20);
  tc.rotate((rot * Math.PI) / 180);
  const scale = Math.min(56 / img.width, 40 / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  tc.drawImage(img, -w / 2, -h / 2, w, h);
  tc.restore();
  el.innerHTML = "";
  thumbCanvas.style.cssText = "width:100%;height:100%;object-fit:contain;";
  el.appendChild(thumbCanvas);
}

function _updateThumbs() {
  _state.files.forEach((f, i) => {
    if (f.img) _updateThumb(i, f.img);
  });
}

// ── Rendu Canvas ─────────────────────────────────────────────────────
function _renderCanvas() {
  const canvas = _state.canvas;
  const ctx = _state.ctx;
  if (!canvas || !ctx) return;

  const [f0, f1] = _state.files;
  const img0 = f0?.img;
  const img1 = f1?.img;

  // A4 ratio : 210×297mm → on affiche en 560×792 px (72dpi preview)
  const A4W = 560,
    A4H = 792;
  const MARGIN = 16;

  if (_state.layout === "horizontal") {
    canvas.width = A4W;
    canvas.height = A4H;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, A4W, A4H);

    const cellW = (A4W - MARGIN * 3) / 2;
    const cellH = A4H - MARGIN * 2;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(MARGIN, MARGIN, cellW, cellH);
    ctx.fillRect(MARGIN * 2 + cellW, MARGIN, cellW, cellH);
    ctx.restore();

    if (img0)
      _drawImageFit(
        ctx,
        img0,
        MARGIN,
        MARGIN,
        cellW,
        cellH,
        (_state.rotations || [0, 0])[0],
        (_state.scales || [1, 1])[0],
        (_state.offsets || [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ])[0],
      );
    if (img1)
      _drawImageFit(
        ctx,
        img1,
        MARGIN * 2 + cellW,
        MARGIN,
        cellW,
        cellH,
        (_state.rotations || [0, 0])[1],
        (_state.scales || [1, 1])[1],
        (_state.offsets || [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ])[1],
      );

    ctx.save();
    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(MARGIN + cellW + MARGIN / 2, MARGIN);
    ctx.lineTo(MARGIN + cellW + MARGIN / 2, A4H - MARGIN);
    ctx.stroke();
    ctx.restore();
  } else {
    // Vertical
    canvas.width = A4W;
    canvas.height = A4H;

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, A4W, A4H);

    const cellW = A4W - MARGIN * 2;
    const cellH = (A4H - MARGIN * 3) / 2;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.04)";
    ctx.fillRect(MARGIN, MARGIN, cellW, cellH);
    ctx.fillRect(MARGIN, MARGIN * 2 + cellH, cellW, cellH);
    ctx.restore();

    if (img0)
      _drawImageFit(
        ctx,
        img0,
        MARGIN,
        MARGIN,
        cellW,
        cellH,
        (_state.rotations || [0, 0])[0],
        (_state.scales || [1, 1])[0],
        (_state.offsets || [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ])[0],
      );
    if (img1)
      _drawImageFit(
        ctx,
        img1,
        MARGIN,
        MARGIN * 2 + cellH,
        cellW,
        cellH,
        (_state.rotations || [0, 0])[1],
        (_state.scales || [1, 1])[1],
        (_state.offsets || [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ])[1],
      );

    ctx.save();
    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(MARGIN, MARGIN + cellH + MARGIN / 2);
    ctx.lineTo(A4W - MARGIN, MARGIN + cellH + MARGIN / 2);
    ctx.stroke();
    ctx.restore();
  }

  // Appliquer filtres CSS sur le canvas via filter (preview only — pour PDF on applique pixel par pixel)
  _applyCanvasFilter(canvas);
}

function _drawImageFit(
  ctx,
  img,
  zoneX,
  zoneY,
  zoneW,
  zoneH,
  rotation = 0,
  scale = 1,
  offset = { x: 0, y: 0 },
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(zoneX, zoneY, zoneW, zoneH);
  ctx.clip();

  const cx = zoneX + zoneW / 2;
  const cy = zoneY + zoneH / 2;
  const PADDING = 16;

  const maxW = zoneW - PADDING * 2;
  const maxH = zoneH - PADDING * 2;

  const iW = img.naturalWidth || img.width;
  const iH = img.naturalHeight || img.height;
  const ratioNormal = Math.min(maxW / iW, maxH / iH);
  const baseRatio = ratioNormal;

  const drawW = iW * baseRatio;
  const drawH = iH * baseRatio;

  ctx.translate(cx + offset.x, cy + offset.y);
  ctx.scale(scale, scale);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function _applyCanvasFilter(canvas) {
  const f = _state.filters;
  // CSS filter pour le preview (rapide)
  canvas.style.filter = [
    `brightness(${f.brightness}%)`,
    `contrast(${f.contrast}%)`,
    `saturate(${f.saturation}%)`,
    `grayscale(${f.grayscale}%)`,
  ].join(" ");
}

// ── UI helpers ───────────────────────────────────────────────────────
function _updateLayoutButtons() {
  document.querySelectorAll(".fusion-layout-btn").forEach((btn) => {
    const active = btn.dataset.layout === _state.layout;
    btn.style.border = active ? "2px solid #1B5E35" : "1px solid #ddd";
    btn.style.background = active ? "#E8F5E9" : "#fff";
    btn.style.color = active ? "#1B5E35" : "#666";
    btn.style.fontWeight = active ? "600" : "400";
  });
}

function _updatePresetButtons() {
  document.querySelectorAll(".fusion-preset-btn").forEach((btn) => {
    const active = btn.dataset.preset === _state.preset;
    btn.style.border = active ? "2px solid #1B5E35" : "1px solid #e5e7eb";
    btn.style.background = active ? "#E8F5E9" : "#fff";
    btn.style.color = active ? "#1B5E35" : "#555";
    btn.style.fontWeight = active ? "600" : "400";
  });
}

function _updateSlidersFromFilters() {
  const f = _state.filters;
  Object.entries(f).forEach(([key, val]) => {
    const slider = document.getElementById(`slider-${key}`);
    const valEl = document.getElementById(`slider-val-${key}`);
    if (slider) slider.value = val;
    if (valEl) valEl.textContent = val;
  });
}

// ── Génération PDF ───────────────────────────────────────────────────
async function _generatePDF() {
  const btn = document.getElementById("fusion-confirm");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération…';
  }

  try {
    // Construire un canvas "propre" haute résolution pour le PDF
    // A4 à 150dpi : 1240×1754px
    const A4W_HQ = 1240,
      A4H_HQ = 1754;
    const MARGIN = 40;
    const scale = A4W_HQ / 560; // facteur par rapport au preview

    const hqCanvas = document.createElement("canvas");
    hqCanvas.width = A4W_HQ;
    hqCanvas.height = A4H_HQ;
    const ctx = hqCanvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, A4W_HQ, A4H_HQ);

    const [f0, f1] = _state.files;

    if (_state.layout === "horizontal") {
      const cellW = (A4W_HQ - MARGIN * 3) / 2;
      const cellH = A4H_HQ - MARGIN * 2;
      if (f0?.img)
        _drawImageFit(
          ctx,
          f0.img,
          MARGIN,
          MARGIN,
          cellW,
          cellH,
          _state.rotations[0],
          _state.scales[0],
          _state.offsets[0],
        );
      if (f1?.img)
        _drawImageFit(
          ctx,
          f1.img,
          MARGIN * 2 + cellW,
          MARGIN,
          cellW,
          cellH,
          _state.rotations[1],
          _state.scales[1],
          _state.offsets[1],
        );
    } else {
      const cellW = A4W_HQ - MARGIN * 2;
      const cellH = (A4H_HQ - MARGIN * 3) / 2;
      if (f0?.img)
        _drawImageFit(
          ctx,
          f0.img,
          MARGIN,
          MARGIN,
          cellW,
          cellH,
          _state.rotations[0],
          _state.scales[0],
          _state.offsets[0],
        );
      if (f1?.img)
        _drawImageFit(
          ctx,
          f1.img,
          MARGIN,
          MARGIN * 2 + cellH,
          cellW,
          cellH,
          _state.rotations[1],
          _state.scales[1],
          _state.offsets[1],
        );
    }

    // Appliquer filtres pixel par pixel sur le canvas HQ
    await _applyFiltersPixel(hqCanvas, ctx);

    // Convertir en blob PNG
    const pngBlob = await new Promise((res) =>
      hqCanvas.toBlob(res, "image/png"),
    );

    // Générer PDF via IPC (main process)
    const pngArrayBuffer = await pngBlob.arrayBuffer();
    const pngUint8 = new Uint8Array(pngArrayBuffer);

    // Nom du PDF fusionné
    const fusedName = `fusion_${_state.files.map((f) => f.fileName.replace(/\.[^.]+$/, "")).join("_")}.pdf`;

    const result = await window.derewol.fusionGenerate({
      pngData: Array.from(pngUint8),
      fileName: fusedName,
      sourceFiles: _state.files.map((f) => ({
        jobId: f.jobId,
        fileId: f.fileId,
        storagePath: f.storagePath,
      })),
    });

    if (result.success) {
      _showFusionToast(`✅ PDF créé : ${fusedName}`);
      _closeModal();
      _state.onComplete?.({
        success: true,
        fileName: fusedName,
        newFileId: result.newFileId,
      });
    } else {
      throw new Error(result.error || "Erreur inconnue");
    }
  } catch (err) {
    console.error("[FUSION] Erreur génération:", err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<i class="fa-solid fa-file-pdf"></i> Générer & Remplacer';
    }
    _showFusionToast(`❌ Erreur : ${err.message}`, "error");
  }
}

// Appliquer filtres pixel par pixel (pour PDF haute qualité)
async function _applyFiltersPixel(canvas, ctx) {
  const f = _state.filters;
  if (
    f.brightness === 100 &&
    f.contrast === 100 &&
    f.saturation === 100 &&
    f.grayscale === 0
  )
    return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const brightness = (f.brightness - 100) * 2.55; // -255 à +255
  const contrast = f.contrast / 100;
  const saturation = f.saturation / 100;
  const grayscale = f.grayscale / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];

    // Brightness
    r = Math.min(255, Math.max(0, r + brightness));
    g = Math.min(255, Math.max(0, g + brightness));
    b = Math.min(255, Math.max(0, b + brightness));

    // Contrast
    r = Math.min(255, Math.max(0, ((r / 255 - 0.5) * contrast + 0.5) * 255));
    g = Math.min(255, Math.max(0, ((g / 255 - 0.5) * contrast + 0.5) * 255));
    b = Math.min(255, Math.max(0, ((b / 255 - 0.5) * contrast + 0.5) * 255));

    // Saturation + Grayscale
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const gsAmount = grayscale + (1 - saturation) * (1 - grayscale);
    r = r + (gray - r) * gsAmount;
    g = g + (gray - g) * gsAmount;
    b = b + (gray - b) * gsAmount;

    data[i] = Math.round(r);
    data[i + 1] = Math.round(g);
    data[i + 2] = Math.round(b);
  }

  ctx.putImageData(imageData, 0, 0);
}

function _closeModal() {
  const el = document.getElementById("fusion-modal-overlay");
  if (el) el.remove();
}

function _showFusionToast(msg, type = "info") {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:18px;right:18px;z-index:11000;
    padding:12px 16px;border-radius:10px;color:#fff;font-size:13px;
    font-family:'Inter',sans-serif;
    background:${type === "success" ? "#16a34a" : type === "error" ? "#dc2626" : "#334155"};
    box-shadow:0 4px 18px rgba(0,0,0,.16);
  `;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 4000);
}
