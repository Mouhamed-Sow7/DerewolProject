const supabase = require('./services/supabase');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function createTestJob() {
  try {
    console.log('🔄 Création d\'un job de test...');

    // 1. Créer un fichier test simple (PDF minimaliste)
    const testPdfPath = path.join(__dirname, 'test.pdf');
    // Un vrai petit PDF (structure minimaliste mais valide)
    const pdfContent = Buffer.from(`%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Test Job) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000214 00000 n
0000000281 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
375
%%EOF`);

    fs.writeFileSync(testPdfPath, pdfContent);
    console.log('✓ Fichier PDF test créé');

    // 2. Générer clé de chiffrement
    const encryptedKey = crypto.randomBytes(32).toString('base64');
    console.log('✓ Clé de chiffrement générée');

    // 3. Uploader le fichier test dans Supabase Storage
    const fileName = `test-${Date.now()}.pdf`;
    const storagePath = `test-jobs/${fileName}`;

    const fileBuffer = fs.readFileSync(testPdfPath);
    const { error: uploadError } = await supabase
      .storage
      .from('derewol-files')
      .upload(storagePath, fileBuffer, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      throw new Error('Upload failed: ' + uploadError.message);
    }
    console.log('✓ Fichier uploadé dans Supabase Storage:', storagePath);

    // 4. Créer un print_job
    const { data: jobData, error: jobError } = await supabase
      .from('print_jobs')
      .insert({
        print_token: `test-${Date.now()}`,
        status: 'queued'
      })
      .select()
      .single();

    if (jobError) {
      throw new Error('Job creation failed: ' + jobError.message);
    }
    const jobId = jobData.id;
    console.log('✓ Job créé avec ID:', jobId);

    // 5. Créer un file_group
    const { data: fileGroupData, error: fgError } = await supabase
      .from('file_groups')
      .insert({
        owner_id: 'test-user-123'
      })
      .select()
      .single();

    if (fgError) {
      throw new Error('File group creation failed: ' + fgError.message);
    }
    const fileGroupId = fileGroupData.id;
    console.log('✓ File group créé avec ID:', fileGroupId);

    // 6. Créer un fichier dans file_group
    const { error: fileError } = await supabase
      .from('files')
      .insert({
        group_id: fileGroupId,
        file_name: fileName,
        storage_path: storagePath,
        encrypted_key: encryptedKey
      });

    if (fileError) {
      throw new Error('File creation failed: ' + fileError.message);
    }
    console.log('✓ Fichier enregistré dans la DB');

    // Nettoyer le fichier local
    fs.unlinkSync(testPdfPath);

    console.log('\n✅ JOB TEST CRÉÉ AVEC SUCCÈS!');
    console.log('═══════════════════════════════');
    console.log(`Job ID: ${jobId}`);
    console.log(`Storage Path: ${storagePath}`);
    console.log(`File Group ID: ${fileGroupId}`);
    console.log('═══════════════════════════════\n');
    console.log('Maintenance: clique le bouton "Rejeter" dans l\'interface');

  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
}

createTestJob();
