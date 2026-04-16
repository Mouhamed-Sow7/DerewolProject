// ════════════════════════════════════════════════════════════════
// FILE EDITOR MODULE — ELECTRON ONLY ════════════════════════════
// ════════════════════════════════════════════════════════════════
// Purpose: Preview and edit files locally before printing
// - Image preview + rotation
// - PDF preview
// - Electron ONLY (NOT PWA)

class FileEditor {
  constructor() {
    this.currentFile = null;
    this.currentRotation = 0;
    this.modal = null;
  }

  openFile(filePath, fileName) {
    console.log("[EDITOR] Opening file:", fileName);

    if (!filePath) {
      console.error("[EDITOR] No file path provided");
      return;
    }

    this.currentFile = { path: filePath, name: fileName };
    this.currentRotation = 0;

    const ext = fileName.toLowerCase().split(".").pop();

    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      this.showImageEditor(filePath, fileName);
    } else if (ext === "pdf") {
      this.showPDFPreview(filePath, fileName);
    } else {
      this.showGenericPreview(filePath, fileName);
    }
  }

  showImageEditor(filePath, fileName) {
    console.log("[EDITOR] Showing image editor for:", fileName);

    this.modal = document.createElement("div");
    this.modal.className = "file-editor-modal";
    this.modal.setAttribute("data-type", "image");

    const html = `
      <div class="file-editor-backdrop"></div>
      <div class="file-editor-container">
        <div class="file-editor-header">
          <h3><i class="fa-solid fa-image"></i> ${this.escapeHtml(fileName)}</h3>
          <button class="file-editor-close" onclick="fileEditor.closeEditor()">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
        
        <div class="file-editor-content">
          <div class="image-preview-wrapper">
            <img 
              id="editor-image" 
              src="file://${filePath}" 
              alt="Preview"
              style="transform: rotate(${this.currentRotation}deg);"
            />
          </div>
        </div>
        
        <div class="file-editor-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn" onclick="fileEditor.rotateImage(-90)" title="Rotate left">
              <i class="fa-solid fa-redo"></i> 90° ←
            </button>
            <button class="toolbar-btn" onclick="fileEditor.rotateImage(90)" title="Rotate right">
              <i class="fa-solid fa-undo"></i> 90° →
            </button>
            <button class="toolbar-btn" onclick="fileEditor.resetRotation()" title="Reset rotation">
              <i class="fa-solid fa-refresh"></i> Reset
            </button>
          </div>
          <div class="toolbar-group">
            <button class="toolbar-btn primary" onclick="fileEditor.confirmAndClose()">
              <i class="fa-solid fa-check"></i> Confirm
            </button>
            <button class="toolbar-btn" onclick="fileEditor.closeEditor()">
              <i class="fa-solid fa-times"></i> Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    this.modal.innerHTML = html;
    document.body.appendChild(this.modal);

    // Prevent closing on backdrop click
    this.modal.querySelector(".file-editor-backdrop").onclick = (e) => {
      e.stopPropagation();
    };

    console.log("[EDITOR] Image editor initialized");
  }

  showPDFPreview(filePath, fileName) {
    console.log("[EDITOR] Showing PDF preview for:", fileName);

    this.modal = document.createElement("div");
    this.modal.className = "file-editor-modal";
    this.modal.setAttribute("data-type", "pdf");

    const html = `
      <div class="file-editor-backdrop"></div>
      <div class="file-editor-container">
        <div class="file-editor-header">
          <h3><i class="fa-solid fa-file-pdf"></i> ${this.escapeHtml(fileName)}</h3>
          <button class="file-editor-close" onclick="fileEditor.closeEditor()">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
        
        <div class="file-editor-content pdf-preview">
          <iframe 
            src="file://${filePath}" 
            class="pdf-iframe"
            title="PDF Preview"
          ></iframe>
        </div>
        
        <div class="file-editor-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn primary" onclick="fileEditor.confirmAndClose()">
              <i class="fa-solid fa-check"></i> Confirm
            </button>
            <button class="toolbar-btn" onclick="fileEditor.closeEditor()">
              <i class="fa-solid fa-times"></i> Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    this.modal.innerHTML = html;
    document.body.appendChild(this.modal);

    this.modal.querySelector(".file-editor-backdrop").onclick = (e) => {
      e.stopPropagation();
    };

    console.log("[EDITOR] PDF preview initialized");
  }

  showGenericPreview(filePath, fileName) {
    console.log("[EDITOR] Showing generic preview for:", fileName);

    this.modal = document.createElement("div");
    this.modal.className = "file-editor-modal";
    this.modal.setAttribute("data-type", "generic");

    const html = `
      <div class="file-editor-backdrop"></div>
      <div class="file-editor-container">
        <div class="file-editor-header">
          <h3><i class="fa-solid fa-file"></i> ${this.escapeHtml(fileName)}</h3>
          <button class="file-editor-close" onclick="fileEditor.closeEditor()">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
        
        <div class="file-editor-content generic-preview">
          <div class="preview-placeholder">
            <i class="fa-solid fa-file-lines fa-3x"></i>
            <p>File preview not available</p>
            <small>${this.escapeHtml(fileName)}</small>
          </div>
        </div>
        
        <div class="file-editor-toolbar">
          <div class="toolbar-group">
            <button class="toolbar-btn primary" onclick="fileEditor.confirmAndClose()">
              <i class="fa-solid fa-check"></i> Confirm
            </button>
            <button class="toolbar-btn" onclick="fileEditor.closeEditor()">
              <i class="fa-solid fa-times"></i> Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    this.modal.innerHTML = html;
    document.body.appendChild(this.modal);

    this.modal.querySelector(".file-editor-backdrop").onclick = (e) => {
      e.stopPropagation();
    };

    console.log("[EDITOR] Generic preview initialized");
  }

  rotateImage(degrees) {
    this.currentRotation += degrees;
    this.currentRotation = this.currentRotation % 360;
    const img = document.getElementById("editor-image");
    if (img) {
      img.style.transform = `rotate(${this.currentRotation}deg)`;
    }
    console.log("[EDITOR] Image rotated to:", this.currentRotation + "°");
  }

  resetRotation() {
    this.currentRotation = 0;
    const img = document.getElementById("editor-image");
    if (img) {
      img.style.transform = "rotate(0deg)";
    }
    console.log("[EDITOR] Rotation reset");
  }

  confirmAndClose() {
    console.log(
      "[EDITOR] Confirmed with rotation:",
      this.currentRotation + "°",
    );
    // Save rotation data if needed for later processing
    if (this.currentFile) {
      this.currentFile.rotation = this.currentRotation;
    }
    this.closeEditor();
  }

  closeEditor() {
    if (this.modal) {
      this.modal.style.transition = "opacity 0.2s";
      this.modal.style.opacity = "0";
      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.parentNode.removeChild(this.modal);
        }
        this.modal = null;
        this.currentFile = null;
        this.currentRotation = 0;
      }, 200);
      console.log("[EDITOR] Editor closed");
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize globally
const fileEditor = new FileEditor();
window.fileEditor = fileEditor;

// ════════════════════════════════════════════════════════════════
// FILE EDITOR STYLES ════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════

const fileEditorStyles = `
.file-editor-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100002;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.file-editor-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.file-editor-container {
  position: relative;
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  max-width: 90vw;
  max-height: 90vh;
  width: 800px;
  height: 600px;
  overflow: hidden;
}

.file-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
}

.file-editor-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111510;
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-editor-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.file-editor-close:hover {
  color: #111510;
  background: #e5e7eb;
}

.file-editor-content {
  flex: 1;
  overflow: auto;
  background: #f9fafb;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.image-preview-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 8px;
  padding: 20px;
  max-width: 100%;
  max-height: 100%;
}

.image-preview-wrapper img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 4px;
  transition: transform 0.2s ease;
}

.pdf-preview {
  padding: 0;
}

.pdf-iframe {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
}

.generic-preview {
  color: #7a8c78;
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}

.preview-placeholder i {
  color: #d4dbd2;
}

.preview-placeholder p {
  margin: 0;
  font-size: 16px;
  color: #111510;
}

.preview-placeholder small {
  color: #999;
  word-break: break-all;
}

.file-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-btn {
  padding: 8px 14px;
  background: #f3f4f6;
  border: 1px solid #d4dbd2;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #111510;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-btn:hover {
  background: #e5e7eb;
  border-color: #c1c7bf;
}

.toolbar-btn.primary {
  background: #1e4d2b;
  color: white;
  border-color: #1e4d2b;
}

.toolbar-btn.primary:hover {
  background: #163a20;
  border-color: #163a20;
}

@media (max-width: 768px) {
  .file-editor-container {
    width: 95vw;
    height: 95vh;
  }
  
  .file-editor-toolbar {
    flex-direction: column;
  }
  
  .toolbar-group {
    width: 100%;
  }
  
  .toolbar-btn {
    flex: 1;
    justify-content: center;
  }
}
`;

// Inject styles if not already present
if (!document.getElementById("file-editor-styles")) {
  const styleEl = document.createElement("style");
  styleEl.id = "file-editor-styles";
  styleEl.textContent = fileEditorStyles;
  document.head.appendChild(styleEl);
  console.log("[EDITOR] Styles injected");
}

export default fileEditor;
