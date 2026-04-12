const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Génère une clé AES-256 aléatoire
 * @returns {string} clé en hexadécimal
 */
function generateAESKey() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Chiffre un fichier en AES-256-GCM
 * @param {Buffer} fileBuffer - contenu du fichier
 * @param {string} keyHex - clé AES en hexadécimal (optionnel, auto-générée)
 * @returns {{encrypted: Buffer, key: string, iv: string}} données chiffrées
 */
function encryptFile(fileBuffer, keyHex = null) {
  const key = keyHex ? Buffer.from(keyHex, "hex") : crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (12 bytes) + AuthTag (16 bytes) + Encrypted data
  const result = Buffer.concat([iv, authTag, encrypted]);

  return {
    encrypted: result,
    key: key.toString("hex"),
    iv: iv.toString("hex"),
  };
}

/**
 * Déchiffre un fichier AES-256-GCM en RAM
 * @param {Buffer} encryptedBuffer - fichier chiffré
 * @param {string} aesKeyHex - clé AES en hexadécimal
 * @returns {Buffer} - fichier déchiffré en mémoire
 */
function decryptFile(encryptedBuffer, aesKeyHex) {
  // Mode dev : si clé placeholder, retourne le buffer tel quel
  if (!aesKeyHex || aesKeyHex === "encrypted_key_placeholder") {
    console.log("[CRYPTO] Mode dev — fichier non chiffré, passage direct");
    return encryptedBuffer;
  }

  try {
    const key = Buffer.from(aesKeyHex, "hex");
    const iv = encryptedBuffer.slice(0, 12);
    const authTag = encryptedBuffer.slice(12, 28);
    const encrypted = encryptedBuffer.slice(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    throw new Error("Déchiffrement échoué : " + err.message);
  }
}

/**
 * Suppression sécurisée d'un fichier
 * Écrase le contenu avant de supprimer
 * @param {string} filePath
 */
function secureDelete(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const size = fs.statSync(filePath).size;
    // Écrase avec des zéros
    const fd = fs.openSync(filePath, "r+");
    const zeros = Buffer.alloc(size, 0);
    fs.writeSync(fd, zeros, 0, size, 0);
    fs.closeSync(fd);
    // Puis supprime
    fs.unlinkSync(filePath);
    console.log("[CRYPTO] Fichier supprimé sécurisé :", filePath);
  } catch (err) {
    console.error("[CRYPTO] Erreur suppression :", err.message);
  }
}

/**
 * Vérifie l'intégrité d'un fichier via hash SHA-256
 * @param {Buffer} buffer
 * @returns {string} hash hex
 */
function hashFile(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = {
  generateAESKey,
  encryptFile,
  decryptFile,
  secureDelete,
  hashFile,
};
