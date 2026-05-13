/**
 * Service de conversion de fichiers en PDF
 * - Images (.png, .jpg, .jpeg) → PDF via pdf-lib
 * - Documents (.doc, .docx, .xls, .xlsx) → PDF via LibreOffice headless
 *
 * Prérequis: LibreOffice doit être installé sur le système Windows
 * Download: https://www.libreoffice.org/download/download/
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { PDFDocument } = require("pdf-lib");

// Types de fichiers supportés
const FILE_TYPES = {
  PDF: "pdf",
  IMAGE: "image",
  DOCUMENT: "document",
  UNSUPPORTED: "unsupported",
};

// Extensions supportées
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const DOCUMENT_EXTENSIONS = [".doc", ".docx", ".xls", ".xlsx"];
const PDF_EXTENSION = ".pdf";

// Chemins possibles de LibreOffice sur Windows
const LIBREOFFICE_PATHS = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  path.join(
    process.env.LOCALAPPDATA || "",
    "LibreOffice",
    "program",
    "soffice.exe",
  ),
  path.join(
    process.env.PROGRAMFILES || "",
    "LibreOffice",
    "program",
    "soffice.exe",
  ),
];

/**
 * Détecte le type de fichier basé sur l'extension
 * @param {string} fileName - Nom du fichier
 * @returns {string} - Type: 'pdf', 'image', 'document', 'unsupported'
 */
function detectFileType(fileName) {
  if (!fileName) return FILE_TYPES.UNSUPPORTED;

  const ext = path.extname(fileName).toLowerCase();

  if (ext === PDF_EXTENSION) {
    return FILE_TYPES.PDF;
  }

  if (IMAGE_EXTENSIONS.includes(ext)) {
    return FILE_TYPES.IMAGE;
  }

  if (DOCUMENT_EXTENSIONS.includes(ext)) {
    return FILE_TYPES.DOCUMENT;
  }

  return FILE_TYPES.UNSUPPORTED;
}

/**
 * Trouve le chemin de LibreOffice installé
 * @returns {string|null} - Chemin vers soffice.exe ou null
 */
function findLibreOffice() {
  for (const p of LIBREOFFICE_PATHS) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Convertit une image en PDF
 * @param {string} inputPath - Chemin du fichier image
 * @param {string} outputPath - Chemin de sortie du PDF
 * @returns {Promise<string>} - Chemin du PDF généré
 */
async function convertImageToPDF(inputPath, outputPath) {
  console.log(`[CONVERTER] Conversion image: ${inputPath}`);

  // Lire l'image
  const imageBytes = fs.readFileSync(inputPath);
  const ext = path.extname(inputPath).toLowerCase();

  // Créer un nouveau PDF
  const pdfDoc = await PDFDocument.create();

  let image;
  if (ext === ".png") {
    image = await pdfDoc.embedPng(imageBytes);
  } else if (ext === ".jpg" || ext === ".jpeg") {
    image = await pdfDoc.embedJpg(imageBytes);
  } else {
    throw new Error(`Format d'image non supporté: ${ext}`);
  }

  // Dimensionner la page selon l'image (en points, 1 point = 1/72 inch)
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });

  // Sauvegarder le PDF
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);

  console.log(`[CONVERTER] Image convertie → ${outputPath}`);
  return outputPath;
}

/**
 * Convertit un document Office en PDF via LibreOffice
 * @param {string} inputPath - Chemin du fichier document
 * @param {string} outputPath - Chemin de sortie du PDF
 * @returns {Promise<string>} - Chemin du PDF généré
 */
async function convertDocumentToPDF(inputPath, outputPath) {
  console.log(`[CONVERTER] Conversion document: ${inputPath}`);

  const sofficePath = findLibreOffice();
  if (!sofficePath) {
    throw new Error(
      "LibreOffice non trouvé. Veuillez installer LibreOffice pour convertir les documents Office.",
    );
  }

  const outputDir = path.dirname(outputPath);

  // Commande LibreOffice headless
  // --convert-to pdf: convertit en PDF
  // --outdir: dossier de sortie
  const command = `"${sofficePath}" --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;

  try {
    execSync(command, {
      timeout: 60000, // 60 secondes max
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // LibreOffice génère un fichier avec le même nom mais extension .pdf
    const expectedOutput = path.join(
      outputDir,
      path.basename(inputPath, path.extname(inputPath)) + ".pdf",
    );

    // Vérifier que le fichier a été créé
    if (!fs.existsSync(expectedOutput)) {
      throw new Error("Le fichier PDF n'a pas été généré par LibreOffice");
    }

    // Renommer si le nom de sortie demandé est différent
    if (expectedOutput !== outputPath && fs.existsSync(expectedOutput)) {
      // Si le fichier de sortie existe déjà, le supprimer
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      fs.renameSync(expectedOutput, outputPath);
    }

    console.log(`[CONVERTER] Document converti → ${outputPath}`);
    return outputPath;
  } catch (err) {
    throw new Error(`Erreur conversion LibreOffice: ${err.message}`);
  }
}

/**
 * Convertit un fichier en PDF si nécessaire
 * @param {string} inputPath - Chemin du fichier d'entrée
 * @param {string} originalFileName - Nom original du fichier (pour détecter le type)
 * @returns {Promise<{pdfPath: string, isConverted: boolean, tempPath: string|null}>}
 */
async function convertToPDF(inputPath, originalFileName) {
  const fileType = detectFileType(originalFileName);

  console.log(`[CONVERTER] Type détecté: ${fileType} pour ${originalFileName}`);

  // Si c'est déjà un PDF, pas de conversion
  if (fileType === FILE_TYPES.PDF) {
    return {
      pdfPath: inputPath,
      isConverted: false,
      tempPath: null,
    };
  }

  // Générer le chemin de sortie
  const outputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${baseName}.pdf`);

  let convertedPath;

  switch (fileType) {
    case FILE_TYPES.IMAGE:
      convertedPath = await convertImageToPDF(inputPath, outputPath);
      break;

    case FILE_TYPES.DOCUMENT:
      convertedPath = await convertDocumentToPDF(inputPath, outputPath);
      break;

    case FILE_TYPES.UNSUPPORTED:
    default:
      throw new Error(
        `Type de fichier non supporté: ${path.extname(originalFileName)}`,
      );
  }

  return {
    pdfPath: convertedPath,
    isConverted: true,
    tempPath: convertedPath, // Le PDF converti devra être supprimé après impression
  };
}

/**
 * Nettoie les fichiers temporaires créés lors de la conversion
 * @param {string} pdfPath - Chemin du PDF converti
 * @param {string} originalPath - Chemin du fichier original temporaire
 */
function cleanupConversion(pdfPath, originalPath) {
  // Supprimer le PDF converti si différent de l'original
  if (pdfPath && pdfPath !== originalPath && fs.existsSync(pdfPath)) {
    try {
      fs.unlinkSync(pdfPath);
      console.log(`[CONVERTER] PDF temporaire supprimé: ${pdfPath}`);
    } catch (e) {
      console.warn(`[CONVERTER] Erreur suppression PDF: ${e.message}`);
    }
  }

  // Supprimer le fichier original temporaire
  if (originalPath && fs.existsSync(originalPath)) {
    try {
      fs.unlinkSync(originalPath);
      console.log(`[CONVERTER] Fichier temporaire supprimé: ${originalPath}`);
    } catch (e) {
      console.warn(`[CONVERTER] Erreur suppression fichier: ${e.message}`);
    }
  }
}

module.exports = {
  detectFileType,
  convertToPDF,
  cleanupConversion,
  FILE_TYPES,
};
