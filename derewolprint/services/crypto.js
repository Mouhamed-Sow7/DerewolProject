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
  // VALIDATION 1: Vérifier les paramètres d'entrée
  if (!Buffer.isBuffer(encryptedBuffer)) {
    throw new Error("decryptFile: encryptedBuffer doit être un Buffer");
  }

  if (encryptedBuffer.length < 28) {
    // IV(12) + AuthTag(16) minimum
    throw new Error(
      `decryptFile: Buffer chiffré trop petit (${encryptedBuffer.length} bytes)`,
    );
  }

  // Mode dev : si clé placeholder, retourne le buffer tel quel
  if (!aesKeyHex || aesKeyHex === "encrypted_key_placeholder") {
    console.log("[CRYPTO] Mode dev — fichier non chiffré, passage direct");
    console.log(
      "[CRYPTO] Buffer original - type:",
      typeof encryptedBuffer,
      "length:",
      encryptedBuffer.length,
    );
    return encryptedBuffer;
  }

  try {
    console.log(
      "[CRYPTO] Début déchiffrement - buffer length:",
      encryptedBuffer.length,
    );

    const key = Buffer.from(aesKeyHex, "hex");
    const iv = encryptedBuffer.slice(0, 12);
    const authTag = encryptedBuffer.slice(12, 28);
    const encrypted = encryptedBuffer.slice(28);

    console.log(
      "[CRYPTO] Composants - IV:",
      iv.length,
      "AuthTag:",
      authTag.length,
      "Data:",
      encrypted.length,
    );

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    // VALIDATION 2: Vérifier que le résultat est un buffer valide
    if (!Buffer.isBuffer(decrypted)) {
      throw new Error("decryptFile: Le résultat n'est pas un Buffer valide");
    }

    if (decrypted.length === 0) {
      throw new Error("decryptFile: Le buffer déchiffré est vide");
    }

    console.log(
      "[CRYPTO] ✅ Déchiffrement réussi - buffer length:",
      decrypted.length,
    );
    console.log(
      "[CRYPTO] Premier bytes:",
      decrypted.slice(0, Math.min(20, decrypted.length)).toString("hex"),
    );

    return decrypted;
  } catch (err) {
    console.error("[CRYPTO] ❌ Erreur déchiffrement:", err.message);
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
 * Valide qu'un buffer déchiffré est correct
 * @param {Buffer} buffer - buffer à valider
 * @param {string} fileName - nom du fichier pour validation spécifique
 * @returns {boolean} true si valide
 */
function validateDecryptedBuffer(buffer, fileName) {
  try {
    // Vérifications de base
    if (!Buffer.isBuffer(buffer)) {
      console.error("[VALIDATION] ❌ Pas un Buffer");
      return false;
    }

    if (buffer.length === 0) {
      console.error("[VALIDATION] ❌ Buffer vide");
      return false;
    }

    if (buffer.length < 10) {
      console.error(
        "[VALIDATION] ❌ Buffer trop petit:",
        buffer.length,
        "bytes",
      );
      return false;
    }

    // Validation spécifique par type de fichier
    const ext = fileName.toLowerCase().split(".").pop();

    switch (ext) {
      case "pdf":
        if (!buffer.slice(0, 4).equals(Buffer.from("%PDF"))) {
          console.error("[VALIDATION] ❌ En-tête PDF invalide");
          return false;
        }
        break;

      case "docx":
        // DOCX est un ZIP, vérifie l'en-tête PK
        if (!buffer.slice(0, 2).equals(Buffer.from("PK"))) {
          console.error("[VALIDATION] ❌ En-tête DOCX invalide");
          return false;
        }
        break;

      case "xlsx":
        // XLSX est aussi un ZIP
        if (!buffer.slice(0, 2).equals(Buffer.from("PK"))) {
          console.error("[VALIDATION] ❌ En-tête XLSX invalide");
          return false;
        }
        break;

      case "doc":
        // DOC a un en-tête spécifique
        if (
          !buffer
            .slice(0, 8)
            .equals(
              Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            )
        ) {
          console.error("[VALIDATION] ❌ En-tête DOC invalide");
          return false;
        }
        break;

      case "xls":
        // XLS a le même en-tête que DOC
        if (
          !buffer
            .slice(0, 8)
            .equals(
              Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            )
        ) {
          console.error("[VALIDATION] ❌ En-tête XLS invalide");
          return false;
        }
        break;
    }

    console.log(
      `[VALIDATION] ✅ Buffer valide: ${buffer.length} bytes (${ext.toUpperCase()})`,
    );
    return true;
  } catch (err) {
    console.error("[VALIDATION] ❌ Erreur validation:", err.message);
    return false;
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

/**
 * Valide qu'un buffer déchiffré est correct
 * @param {Buffer} buffer - buffer à valider
 * @param {string} fileName - nom du fichier pour validation spécifique
 * @returns {boolean} true si valide
 */
function validateDecryptedBuffer(buffer, fileName) {
  try {
    // Vérifications de base
    if (!Buffer.isBuffer(buffer)) {
      console.error("[VALIDATION] ❌ Pas un Buffer");
      return false;
    }

    if (buffer.length === 0) {
      console.error("[VALIDATION] ❌ Buffer vide");
      return false;
    }

    if (buffer.length < 10) {
      console.error(
        "[VALIDATION] ❌ Buffer trop petit:",
        buffer.length,
        "bytes",
      );
      return false;
    }

    // Validation spécifique par type de fichier
    const ext = fileName.toLowerCase().split(".").pop();

    switch (ext) {
      case "pdf":
        if (!buffer.slice(0, 4).equals(Buffer.from("%PDF"))) {
          console.error("[VALIDATION] ❌ En-tête PDF invalide");
          return false;
        }
        break;

      case "docx":
        // DOCX est un ZIP, vérifie l'en-tête PK
        if (!buffer.slice(0, 2).equals(Buffer.from("PK"))) {
          console.error("[VALIDATION] ❌ En-tête DOCX invalide");
          return false;
        }
        break;

      case "xlsx":
        // XLSX est aussi un ZIP
        if (!buffer.slice(0, 2).equals(Buffer.from("PK"))) {
          console.error("[VALIDATION] ❌ En-tête XLSX invalide");
          return false;
        }
        break;

      case "doc":
        // DOC a un en-tête spécifique
        if (
          !buffer
            .slice(0, 8)
            .equals(
              Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            )
        ) {
          console.error("[VALIDATION] ❌ En-tête DOC invalide");
          return false;
        }
        break;

      case "xls":
        // XLS a le même en-tête que DOC
        if (
          !buffer
            .slice(0, 8)
            .equals(
              Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            )
        ) {
          console.error("[VALIDATION] ❌ En-tête XLS invalide");
          return false;
        }
        break;
    }

    console.log(
      `[VALIDATION] ✅ Buffer valide: ${buffer.length} bytes (${ext.toUpperCase()})`,
    );
    return true;
  } catch (err) {
    console.error("[VALIDATION] ❌ Erreur validation:", err.message);
    return false;
  }
}

module.exports = {
  generateAESKey,
  encryptFile,
  decryptFile,
  secureDelete,
  hashFile,
  validateDecryptedBuffer,
};
