// --------------------------------------------------------------------------
// viewer.js � DerewolPrint Secure File Viewer (100% local �ph�m�re)
// --------------------------------------------------------------------------

// -- SECURITY: Anti-exfiltration event blocking ----------------------------
document.addEventListener("copy", (e) => e.preventDefault());
document.addEventListener("cut", (e) => e.preventDefault());
document.addEventListener("paste", (e) => e.preventDefault());
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
document.addEventListener("dragover", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && ["c", "x", "s", "p", "a"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    return false;
  }
});

document.addEventListener("selectstart", (e) => e.preventDefault());
window.addEventListener("blur", () => {
  console.warn("[SECURITY] Viewer lost focus � content protected");
});

// -- State -----------------------------------------------------------------
const state = {
  jobId: null,
  fileId: null,
  type: null,
  bytes: null,
  name: null,
  displayName: null,
  // Image
  imgRotation: 0,
  imgBrightness: 100,
  imgContrast: 100,
  imgSaturate: 100,
  imgCropActive: false,
  imgCropStart: null,
  imgCropRect: null,
  // Excel
  xlsxWorkbook: null,
  xlsxActiveSheet: null,
  // TTL
  ttlSeconds: 30 * 60,
  ttlInterval: null,
};

// -- UI helpers -----------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function showPane(id) {
  [
    "pdf-container",
    "image-container",
    "excel-container",
    "word-container",
    "generic-container",
  ].forEach((p) => $(p).classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function showToolbar(id) {
  ["tb-pdf", "tb-image", "tb-excel"].forEach((t) =>
    $(t).classList.add("hidden"),
  );
  if (id) $(id).classList.remove("hidden");
}

function setStatus(msg, type = "") {
  const el = $("status-msg");
  el.textContent = msg;
  el.className = "status-msg " + type;
  if (msg)
    setTimeout(() => {
      el.textContent = "";
      el.className = "status-msg";
    }, 3500);
}

// -- Entry point: wait for file data from main -----------------------------
function waitForViewerReady(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (
        window.viewer &&
        typeof window.viewer.onData === "function" &&
        typeof window.viewer.onTTLExpired === "function"
      ) {
        return resolve(window.viewer);
      }
      if (Date.now() - start >= timeout) {
        return reject(new Error("Viewer IPC unavailable"));
      }
      setTimeout(check, 50);
    };
    check();
  });
}

async function initViewerBridge() {
  try {
    await waitForViewerReady();
    window.viewer.ready();

    window.viewer.onData((data) => {
      const bytes = data.bytesArray ? new Uint8Array(data.bytesArray) : null;
      Object.assign(state, {
        bytes,
        name: data.name,
        displayName: data.displayName || data.name,
        jobId: data.jobId,
        fileId: data.fileId,
        type: data.type,
        ttlSeconds: 30 * 60,
      });

      $("viewer-filename").textContent = state.displayName;
      $("loading-state").classList.add("hidden");

      startTTL();
      initActions(data.type);

      switch (data.type) {
        case "pdf":
          initPDF();
          break;
        case "image":
          initImage();
          break;
        case "excel":
          initExcel();
          break;
        case "word":
          initWord();
          break;
        default:
          initGeneric(data.name);
          break;
      }
    });

    window.viewer.onTTLExpired(() => {
      clearInterval(state.ttlInterval);
      $("ttl-countdown").textContent = "Expir�";
      $("ttl-countdown").style.color = "#dc2626";
      setStatus("Session expir�e � fermeture dans 3s", "error");
      setTimeout(closeViewer, 3000);
    });
  } catch (err) {
    $("loading-state").classList.add("hidden");
    setStatus("Erreur viewer interne : " + err.message, "error");
    console.error(err);
  }
}

initViewerBridge();

// -- TTL countdown ---------------------------------------------------------
function startTTL() {
  const el = $("ttl-countdown");
  state.ttlInterval = setInterval(() => {
    state.ttlSeconds = Math.max(0, state.ttlSeconds - 1);
    const m = String(Math.floor(state.ttlSeconds / 60)).padStart(2, "0");
    const s = String(state.ttlSeconds % 60).padStart(2, "0");
    el.textContent = `${m}:${s}`;
    if (state.ttlSeconds <= 60) el.style.color = "#dc2626";
    if (state.ttlSeconds <= 0) {
      clearInterval(state.ttlInterval);
      el.textContent = "Expir�";
    }
  }, 1000);
}

// -- Close / Print ---------------------------------------------------------
function closeViewer() {
  clearInterval(state.ttlInterval);
  if (window._currentPdfBlobUrl) {
    URL.revokeObjectURL(window._currentPdfBlobUrl);
    window._currentPdfBlobUrl = null;
  }
  window.viewer.close(state.jobId, state.fileId);
}

function initActions(type) {
  $("btn-close").addEventListener("click", closeViewer);
}

// -- PDF -------------------------------------------------------------------
async function initPDF() {
  showPane("pdf-container");
  showToolbar(null);
  const container = $("pdf-container");
  container.innerHTML = "";

  try {
    const bytes = state.bytes;
    if (!bytes) throw new Error("Données PDF manquantes");

    const blob = new Blob([bytes], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    window._currentPdfBlobUrl = blobUrl;

    const obj = document.createElement("object");
    obj.data = blobUrl;
    obj.type = "application/pdf";
    obj.style.cssText = "width:100%;height:100%;border:none;display:block;";
    obj.innerHTML = `<div style="padding:40px;text-align:center;color:#aaa;">
      <p>Le PDF ne peut pas s'afficher ici.</p></div>`;

    container.appendChild(obj);
  } catch (err) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;color:#ef5350;">
        <p style="font-size:32px;">⚠</p>
        <p style="font-weight:700;">Erreur de lecture PDF</p>
        <p style="font-size:13px;">${err.message}</p>
      </div>`;
  }
}

// -- Image -----------------------------------------------------------------
function initImage() {
  showPane("image-container");
  showToolbar("tb-image");

  const bytes = state.bytes;
  if (!bytes) {
    initGeneric(state.name);
    return;
  }

  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    renderImage(img);
    bindImageControls(img);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    initGeneric(state.name);
  };
  img.src = url;
}

function renderImage(imgEl) {
  const canvas = $("image-canvas");
  const rad = (state.imgRotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const W = imgEl.naturalWidth;
  const H = imgEl.naturalHeight;
  const cw = W * cos + H * sin;
  const ch = W * sin + H * cos;

  canvas.width = cw;
  canvas.height = ch;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.drawImage(imgEl, -W / 2, -H / 2);

  canvas.style.filter = [
    `brightness(${state.imgBrightness}%)`,
    `contrast(${state.imgContrast}%)`,
    `saturate(${state.imgSaturate}%)`,
  ].join(" ");
}

function bindImageControls(imgEl) {
  $("img-rot-left").addEventListener("click", () => {
    state.imgRotation = (state.imgRotation - 90 + 360) % 360;
    renderImage(imgEl);
  });
  $("img-rot-right").addEventListener("click", () => {
    state.imgRotation = (state.imgRotation + 90) % 360;
    renderImage(imgEl);
  });
  $("img-reset").addEventListener("click", () => {
    state.imgRotation = 0;
    state.imgBrightness = 100;
    state.imgContrast = 100;
    state.imgSaturate = 100;
    state.imgCropRect = null;
    state.imgCropActive = false;
    $("filter-brightness").value = 100;
    $("filter-contrast").value = 100;
    $("filter-saturate").value = 100;
    $("img-crop-toggle").classList.remove("tb-btn--active");
    $("img-crop-apply").classList.add("hidden");
    $("crop-selection").classList.add("hidden");
    renderImage(imgEl);
  });

  ["brightness", "contrast", "saturate"].forEach((f) => {
    $(`filter-${f}`).addEventListener("input", (e) => {
      state[`img${f.charAt(0).toUpperCase() + f.slice(1)}`] = parseInt(
        e.target.value,
      );
      renderImage(imgEl);
    });
  });

  $("img-crop-toggle").addEventListener("click", () => {
    state.imgCropActive = !state.imgCropActive;
    $("img-crop-toggle").classList.toggle(
      "tb-btn--active",
      state.imgCropActive,
    );
    $("crop-selection").classList.toggle("hidden", !state.imgCropActive);
    if (!state.imgCropActive) {
      state.imgCropRect = null;
      $("crop-selection").style.cssText = "";
      $("img-crop-apply").classList.add("hidden");
    }
  });

  setupCropListeners();

  $("img-crop-apply").addEventListener("click", () => applyCrop(imgEl));
  $("img-save").addEventListener("click", () => saveImage());
}

function setupCropListeners() {
  const canvas = $("image-canvas");
  const sel = $("crop-selection");
  let dragging = false;
  let startX = 0,
    startY = 0;

  canvas.addEventListener("mousedown", (e) => {
    if (!state.imgCropActive) return;
    dragging = true;
    const r = canvas.getBoundingClientRect();
    startX = e.clientX - r.left;
    startY = e.clientY - r.top;
    sel.style.left = `${startX}px`;
    sel.style.top = `${startY}px`;
    sel.style.width = "0px";
    sel.style.height = "0px";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging || !state.imgCropActive) return;
    const r = canvas.getBoundingClientRect();
    const curX = e.clientX - r.left;
    const curY = e.clientY - r.top;
    const x = Math.min(curX, startX);
    const y = Math.min(curY, startY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    sel.style.left = `${x}px`;
    sel.style.top = `${y}px`;
    sel.style.width = `${w}px`;
    sel.style.height = `${h}px`;
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragging || !state.imgCropActive) return;
    dragging = false;
    const r = canvas.getBoundingClientRect();
    const curX = e.clientX - r.left;
    const curY = e.clientY - r.top;
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    state.imgCropRect = {
      x: Math.min(curX, startX) * scaleX,
      y: Math.min(curY, startY) * scaleY,
      w: Math.abs(curX - startX) * scaleX,
      h: Math.abs(curY - startY) * scaleY,
    };
    if (state.imgCropRect.w > 4 && state.imgCropRect.h > 4) {
      $("img-crop-apply").classList.remove("hidden");
    }
  });
}

function applyCrop(imgEl) {
  if (!state.imgCropRect) return;
  const { x, y, w, h } = state.imgCropRect;
  const src = $("image-canvas");
  const dst = document.createElement("canvas");
  dst.width = w;
  dst.height = h;
  dst.getContext("2d").drawImage(src, x, y, w, h, 0, 0, w, h);

  const mainCanvas = $("image-canvas");
  mainCanvas.width = w;
  mainCanvas.height = h;
  mainCanvas.getContext("2d").drawImage(dst, 0, 0);

  state.imgCropRect = null;
  $("crop-selection").classList.add("hidden");
  $("img-crop-toggle").classList.remove("tb-btn--active");
  $("img-crop-apply").classList.add("hidden");
  state.imgCropActive = false;
}

async function saveImage() {
  const canvas = $("image-canvas");
  const ext = state.name.split(".").pop().toLowerCase();
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  const btn = $("img-save");
  btn.disabled = true;
  btn.textContent = "? Sauvegarde�";

  canvas.toBlob(
    async (blob) => {
      if (!blob) {
        btn.disabled = false;
        btn.textContent = "?? Sauvegarder";
        return;
      }
      try {
        const ab = await blob.arrayBuffer();
        const data = Array.from(new Uint8Array(ab));
        const res = await window.viewer.save(state.jobId, state.fileId, data);
        if (res.success) {
          setStatus("Sauvegard� ?", "ok");
          btn.textContent = "? Sauvegard�";
        } else {
          setStatus("Erreur: " + res.error, "error");
          btn.textContent = "?? Sauvegarder";
          btn.disabled = false;
        }
      } catch (e) {
        setStatus("Erreur sauvegarde", "error");
        btn.textContent = "?? Sauvegarder";
        btn.disabled = false;
      }
    },
    mime,
    0.92,
  );
}

// -- Excel -----------------------------------------------------------------
function initExcel() {
  showPane("excel-container");
  showToolbar("tb-excel");
  loadExcelWarningThenLocal();
}

function loadExcelWarningThenLocal() {
  const warning = $("excel-warning");
  warning.classList.remove("hidden");

  let countdown = 3;
  const timerEl = $("excel-timer");
  const cbLabel = $("excel-checkbox-label");
  const cb = $("excel-confirm-cb");
  const proceed = $("btn-excel-proceed");

  const tick = setInterval(() => {
    countdown--;
    timerEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(tick);
      timerEl.classList.add("hidden");
      cbLabel.classList.remove("hidden");
    }
  }, 1000);

  cb.addEventListener("change", () => {
    proceed.disabled = !cb.checked;
  });

  proceed.addEventListener("click", () => {
    warning.classList.add("hidden");
    loadExcelLocal();
  });
}

async function loadExcelLocal() {
  try {
    const bytes = state.bytes;
    if (!bytes) throw new Error("Donn�es Excel manquantes");
    state.xlsxWorkbook = XLSX.read(bytes, { type: "array" });

    const sel = $("excel-sheet-select");
    sel.innerHTML = "";
    state.xlsxWorkbook.SheetNames.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });

    state.xlsxActiveSheet = state.xlsxWorkbook.SheetNames[0];
    renderSheet(state.xlsxActiveSheet);

    sel.addEventListener("change", (e) => {
      state.xlsxActiveSheet = e.target.value;
      renderSheet(state.xlsxActiveSheet);
    });

    $("excel-save").addEventListener("click", saveExcel);
  } catch (e) {
    $("excel-table-wrap").innerHTML =
      `<p style="color:#dc2626;padding:16px">Erreur: ${e.message}</p>`;
  }
}

function renderSheet(sheetName) {
  const sheet = state.xlsxWorkbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    $("excel-table-wrap").innerHTML =
      "<p style='padding:16px;color:#999'>Feuille vide</p>";
    return;
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const table = document.createElement("table");
  table.className = "excel-table";

  for (let r = range.s.r; r <= range.e.r; r++) {
    const tr = document.createElement("tr");
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      const el = document.createElement(r === range.s.r ? "th" : "td");
      el.textContent = cell ? XLSX.utils.format_cell(cell) : "";

      const isFormula = cell && cell.t === "f";
      el.contentEditable = !isFormula && r !== range.s.r ? "true" : "false";
      if (isFormula) el.title = "Formule (lecture seule)";

      el.dataset.r = r;
      el.dataset.c = c;
      el.dataset.sheet = sheetName;
      el.addEventListener("blur", onCellEdit);
      tr.appendChild(el);
    }
    table.appendChild(tr);
  }

  $("excel-table-wrap").innerHTML = "";
  $("excel-table-wrap").appendChild(table);
}

function onCellEdit(e) {
  const el = e.target;
  const r = parseInt(el.dataset.r);
  const c = parseInt(el.dataset.c);
  const sn = el.dataset.sheet;
  const sheet = state.xlsxWorkbook.Sheets[sn];
  const addr = XLSX.utils.encode_cell({ r, c });
  const raw = el.textContent.trim();
  const num = parseFloat(raw);

  sheet[addr] =
    !isNaN(num) && raw !== ""
      ? { t: "n", v: num, w: raw }
      : { t: "s", v: raw, w: raw };
}

async function saveExcel() {
  const btn = $("excel-save");
  btn.disabled = true;
  btn.textContent = "? Sauvegarde�";
  try {
    const out = XLSX.write(state.xlsxWorkbook, {
      bookType: "xlsx",
      type: "array",
    });
    const data = Array.from(new Uint8Array(out));
    const res = await window.viewer.save(state.jobId, state.fileId, data);
    if (res.success) {
      setStatus("Sauvegard� ?", "ok");
      btn.textContent = "? Sauvegard�";
    } else {
      setStatus("Erreur: " + res.error, "error");
      btn.textContent = "?? Sauvegarder";
      btn.disabled = false;
    }
  } catch (e) {
    setStatus("Erreur sauvegarde", "error");
    btn.textContent = "?? Sauvegarder";
    btn.disabled = false;
  }
}

// -- Word ------------------------------------------------------------------
async function initWord() {
  showPane("word-container");
  showToolbar(null);
  loadWordLocal();
}

async function loadWordLocal() {
  try {
    const bytes = state.bytes;
    if (!bytes) throw new Error("Donn�es Word manquantes");

    const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
    const content = $("word-content");
    content.innerHTML = result.value;

    content.contentEditable = "false";
    content.style.userSelect = "none";
    content.style.pointerEvents = "none";

    if (result.messages && result.messages.length > 0) {
      setStatus("Conversion approximative (certains styles ignor�s)", "");
    }
  } catch (e) {
    $("word-content").textContent = "Erreur de conversion : " + e.message;
  }
}

// -- Generic ---------------------------------------------------------------
function initGeneric(name) {
  showPane("generic-container");
  showToolbar(null);
  $("generic-name").textContent = name;
}
