#!/usr/bin/env node

/**
 * Script de test Bluetooth - Peut envoyer des fichiers de test au serveur
 * Usage:
 *   node test-bluetooth.js <file-path> <server-url>
 *   node test-bluetooth.js test.pdf http://192.168.137.1:3738
 */

const fs = require("fs");
const path = require("path");

function showUsage() {
  console.log(`
📱 Bluetooth Test Script

Usage:
  node test-bluetooth.js <file-path> [server-url]

Examples:
  node test-bluetooth.js test.pdf http://192.168.137.1:3738
  node test-bluetooth.js report.pdf (uses default http://localhost:3738)

Environment:
  BT_SERVER_URL - Override server URL
  `);
}

async function sendFile(filePath, serverUrl) {
  try {
    // Vérifie que le fichier existe
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Fichier introuvable: ${filePath}`);
      process.exit(1);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const fileSize = fileBuffer.length;

    console.log(`\n📤 Envoi du fichier:`);
    console.log(`   Nom: ${fileName}`);
    console.log(`   Taille: ${(fileSize / 1024).toFixed(2)} KB`);
    console.log(`   Vers: ${serverUrl}/bluetooth/upload\n`);

    const form = new globalThis.FormData();
    const blob = new globalThis.Blob([fileBuffer], {
      type: "application/octet-stream",
    });
    form.append("file", blob, fileName);

    const response = await fetch(`${serverUrl}/bluetooth/upload`, {
      method: "POST",
      body: form,
    });

    const responseData = await response.json();

    console.log(`✅ Réponse du serveur:`);
    console.log(`   Status: ${responseData.status}`);
    console.log(`   Message: ${responseData.message}`);
    console.log(`   Size received: ${responseData.size} bytes\n`);

    return responseData;
  } catch (err) {
    console.error(`❌ Erreur: ${err.message}`);
    process.exit(1);
  }
}

async function testBTServer(serverUrl, triedFallback = false) {
  try {
    console.log(
      `🔍 Test de connexion au serveur: ${serverUrl}/bluetooth/status\n`,
    );

    const response = await fetch(`${serverUrl}/bluetooth/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    console.log(`✅ Serveur Bluetooth actif!`);
    console.log(`   Statut: ${result.status}`);
    console.log(`   Serveur: ${result.server}\n`);
    return serverUrl;
  } catch (err) {
    if (
      !triedFallback &&
      !serverUrl.includes("localhost") &&
      !serverUrl.includes("127.0.0.1")
    ) {
      const fallbackUrl = "http://127.0.0.1:3738";
      console.warn(
        `⚠️  Échec sur ${serverUrl}, tentative locale sur ${fallbackUrl}...`,
      );
      return testBTServer(fallbackUrl, true);
    }

    console.error(`❌ Serveur Bluetooth introuvable`);
    console.error(`   ${err.message}\n`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showUsage();
    process.exit(0);
  }

  const filePath = args[0];
  let serverUrl =
    args[1] || process.env.BT_SERVER_URL || "http://localhost:3738";

  // Normalise l'URL
  if (!serverUrl.startsWith("http")) {
    serverUrl = `http://${serverUrl}`;
  }

  console.log("\n🧪 Test Bluetooth Derewol");
  console.log("═".repeat(50));

  // Test de connexion d'abord
  const connectedUrl = await testBTServer(serverUrl);

  if (!connectedUrl) {
    console.log("💡 Conseil:");
    console.log("   1. Vérifiez que l'app Derewol est lancée");
    console.log("   2. Assurez-vous que le hotspot est actif");
    console.log("   3. Vérifiez l'adresse IP du serveur");
    process.exit(1);
  }

  // Envoie le fichier
  try {
    await sendFile(filePath, connectedUrl);
    console.log("✅ Fichier envoyé avec succès!\n");
    console.log("ℹ️  Prochaines étapes:");
    console.log("   1. Attendez quelques secondes");
    console.log(`   2. Vérifiez le dossier: ~/.derewol/bt-receipts/`);
    console.log("   3. Consultez la DB: SELECT * FROM bluetooth_files;");
    console.log("   4. Vérifiez Supabase Storage: /bluetooth-files/\n");
  } catch (err) {
    process.exit(1);
  }
}

main();
