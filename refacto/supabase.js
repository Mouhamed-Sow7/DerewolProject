// lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Résout un slug → printer record ──────────────────────────
export async function getPrinterBySlug(slug) {
  const { data, error } = await supabase
    .from('printers')
    .select('id, slug, name')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return data; // { id, slug, name }
}

// ── Crée un file_group lié à l'imprimeur ──────────────────────
export async function createFileGroup({ ownerId, printerId }) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const { data, error } = await supabase
    .from('file_groups')
    .insert({
      owner_id:   ownerId,
      printer_id: printerId,
      status:     'waiting',
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

// ── Upload + insert file ──────────────────────────────────────
export async function uploadFileToGroup({ file, groupId, ownerId, printerId }) {
  // 1. Sanitize uniquement pour storage_path — file_name reste original
  const safeName = file.name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
    .toLowerCase();

  // owner_id tronqué à 8 chars pour chemin lisible
  const storagePath = `${printerId}/${ownerId.slice(0, 8)}/${Date.now()}-${safeName}`;

  // 2. Upload Storage
  const { error: upErr } = await supabase.storage
    .from('derewol-files')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false });

  if (upErr) throw new Error(`Upload échoué : ${upErr.message}`);

  // 3. Insert files — file_name = nom ORIGINAL lisible
  const { data: fileData, error: fileErr } = await supabase
    .from('files')
    .insert({
      group_id:      groupId,
      file_name:     file.name,        // ← nom original, jamais sanitizé
      storage_path:  storagePath,
      encrypted_key: null,
      file_hash:     null,
    })
    .select('id')
    .single();

  if (fileErr) throw new Error(`Insert file échoué : ${fileErr.message}`);

  // 4. Insert print_job
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error: jobErr } = await supabase
    .from('print_jobs')
    .insert({
      group_id:          groupId,
      status:            'queued',
      copies_requested:  1,
      copies_remaining:  1,
      expires_at:        expiresAt,
    });

  if (jobErr) throw new Error(`Insert job échoué : ${jobErr.message}`);

  return fileData.id;
}

// ── Met à jour files_count après upload complet ───────────────
export async function updateFilesCount(groupId, count) {
  await supabase
    .from('file_groups')
    .update({ files_count: count })
    .eq('id', groupId);
}

// ── Fetch groupes d'un owner ──────────────────────────────────
export async function fetchGroupsByOwner(ownerId) {
  const { data, error } = await supabase
    .from('file_groups')
    .select(`
      id, status, expires_at, printer_id, files_count,
      files ( id, file_name, storage_path ),
      print_jobs ( id, status, copies_requested, copies_remaining, expires_at )
    `)
    .eq('owner_id', ownerId)
    .neq('status', 'deleted');

  if (error) return [];
  return data.sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at));
}

export default supabase;
