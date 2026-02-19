const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Déchiffre un fichier AES-256-GCM en RAM
 * @param {Buffer} encryptedBuffer - fichier chiffré
 * @param {string} aesKeyHex - clé AES en hexadécimal
 * @returns {Buffer} - fichier déchiffré en mémoire
 */
function decryptFile(encryptedBuffer, aesKeyHex) {
  // Mode dev : si clé placeholder, retourne le buffer tel quel
  if (!aesKeyHex || aesKeyHex === 'encrypted_key_placeholder') {
    console.log('[CRYPTO] Mode dev — fichier non chiffré, passage direct');
    return encryptedBuffer;
  }

  try {
    const key = Buffer.from(aesKeyHex, 'hex');
    const iv = encryptedBuffer.slice(0, 12);
    const authTag = encryptedBuffer.slice(12, 28);
    const encrypted = encryptedBuffer.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    throw new Error('Déchiffrement échoué : ' + err.message);
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
    const fd = fs.openSync(filePath, 'r+');
    const zeros = Buffer.alloc(size, 0);
    fs.writeSync(fd, zeros, 0, size, 0);
    fs.closeSync(fd);
    // Puis supprime
    fs.unlinkSync(filePath);
    console.log('[CRYPTO] Fichier supprimé sécurisé :', filePath);
  } catch (err) {
    console.error('[CRYPTO] Erreur suppression :', err.message);
  }
}

/**
 * Vérifie l'intégrité d'un fichier via hash SHA-256
 * @param {Buffer} buffer
 * @returns {string} hash hex
 */
function hashFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { decryptFile, secureDelete, hashFile };