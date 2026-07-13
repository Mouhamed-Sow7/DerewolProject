/**
 * Derewol Admin — Crédits IA
 * Tables réelles : ai_recharge_history + ai_usage_logs
 */

const AI_PACKS = [
  { id: "pack10", label: "10 crédits",    amount: 2000,  credits: 10 },
  { id: "pack20", label: "20 crédits",    amount: 3500,  credits: 20 },
  { id: "pack50", label: "50 crédits",    amount: 7500,  credits: 50 },
  { id: "custom", label: "Montant libre", amount: null,  credits: null },
];

async function loadAiCredits() {
  const tbody = document.getElementById("ai-credits-list");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="loading">Chargement...</td></tr>';

  try {
    const { data: printers, error: pErr } = await sb
      .from("printers").select("id, name, slug, owner_phone").order("name");
    if (pErr) throw pErr;

    if (!printers || printers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aucun imprimeur.</td></tr>';
      return;
    }

    const ids = printers.map((p) => p.id);

    const { data: recharges, error: rErr } = await sb
      .from("ai_recharge_history").select("printer_id, credits_added").in("printer_id", ids);
    if (rErr) throw rErr;

    const { data: usages, error: uErr } = await sb
      .from("ai_usage_logs").select("printer_id, tokens_used")
      .in("printer_id", ids).eq("status", "success");
    if (uErr) throw uErr;

    const bought = {};
    (recharges || []).forEach((r) => {
      bought[r.printer_id] = (bought[r.printer_id] || 0) + (r.credits_added || 0);
    });
    const used = {};
    (usages || []).forEach((u) => {
      used[u.printer_id] = (used[u.printer_id] || 0) + (u.tokens_used || 0);
    });

    document.getElementById("ai-credits-count").textContent = printers.length;

    tbody.innerHTML = printers.map((p) => {
      const totalBought = bought[p.id] || 0;
      const totalUsed   = used[p.id]   || 0;
      const available   = Math.max(0, totalBought - totalUsed);
      const phone       = (p.owner_phone || "").replace(/\D/g, "");
      const badgeCls    = available <= 0 ? "badge-expired" : available <= 5 ? "badge-warning" : "badge-active";

      return `<tr>
        <td><strong>${escAttr(p.name)}</strong><br><small class="text-muted">${escAttr(p.slug)}</small></td>
        <td>${escAttr(p.owner_phone || "—")}</td>
        <td><span class="badge ${badgeCls}">${available} dispo</span><br>
          <small class="text-muted">${totalBought} achetés · ${totalUsed} utilisés</small></td>
        <td class="td-actions">
          <button type="button" class="btn-action btn-ai-recharge"
            data-printer-id="${p.id}" data-printer-name="${escAttr(p.name)}" data-printer-phone="${escAttr(phone)}">
            <i class="fa-solid fa-bolt"></i> Recharger
          </button>
          <button type="button" class="btn-action" data-action="view-history"
            data-printer-id="${p.id}" data-printer-name="${escAttr(p.name)}">
            <i class="fa-solid fa-clock-rotate-left"></i> Historique
          </button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".btn-ai-recharge").forEach((btn) => {
      btn.addEventListener("click", () =>
        openRechargeModal(btn.dataset.printerId, btn.dataset.printerName, btn.dataset.printerPhone));
    });
    tbody.querySelectorAll("[data-action='view-history']").forEach((btn) => {
      btn.addEventListener("click", () =>
        openHistoryModal(btn.dataset.printerId, btn.dataset.printerName));
    });

  } catch (err) {
    console.error("[AI Credits]", err);
    tbody.innerHTML = `<tr><td colspan="5" class="error-msg">${escAttr(err.message)}</td></tr>`;
  }
}

function openRechargeModal(printerId, printerName, printerPhone) {
  const modal = document.getElementById("modal-ai-recharge");
  if (!modal) return;
  document.getElementById("recharge-printer-name").textContent = printerName;
  document.getElementById("recharge-printer-id-hidden").value   = printerId;
  document.getElementById("recharge-printer-phone-hidden").value = printerPhone || "";
  document.getElementById("recharge-error").style.display    = "none";
  document.getElementById("recharge-success").style.display  = "none";
  document.getElementById("recharge-pack").value = "pack10";
  document.getElementById("recharge-ref").value  = "";
  updateRechargeFields("pack10");
  modal.style.display = "flex";
}

function closeRechargeModal() {
  document.getElementById("modal-ai-recharge").style.display = "none";
}

function updateRechargeFields(packId) {
  const pack = AI_PACKS.find((p) => p.id === packId);
  const customFields = document.getElementById("recharge-custom-fields");
  const summaryEl    = document.getElementById("recharge-summary");
  if (!pack) return;
  if (packId === "custom") {
    customFields.style.display = "block";
    summaryEl.textContent = "";
  } else {
    customFields.style.display = "none";
    summaryEl.textContent = `+${pack.credits} crédits — ${pack.amount.toLocaleString("fr-FR")} FCFA`;
  }
}

async function handleRecharge() {
  const printerId = document.getElementById("recharge-printer-id-hidden").value;
  const phone     = document.getElementById("recharge-printer-phone-hidden").value;
  const packId    = document.getElementById("recharge-pack").value;
  const method    = document.getElementById("recharge-method").value;
  const ref       = document.getElementById("recharge-ref").value.trim();
  const errorEl   = document.getElementById("recharge-error");
  const successEl = document.getElementById("recharge-success");
  const btn       = document.getElementById("recharge-submit-btn");

  errorEl.style.display = successEl.style.display = "none";

  let credits, amount;
  if (packId === "custom") {
    credits = parseInt(document.getElementById("recharge-custom-credits").value, 10);
    amount  = parseInt(document.getElementById("recharge-custom-amount").value,  10);
    if (!credits || credits <= 0) { errorEl.textContent = "Crédits invalide."; errorEl.style.display = "block"; return; }
    if (!amount  || amount  <= 0) { errorEl.textContent = "Montant invalide.";  errorEl.style.display = "block"; return; }
  } else {
    const pack = AI_PACKS.find((p) => p.id === packId);
    credits = pack.credits; amount = pack.amount;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> En cours...';

  try {
    const { error } = await sb.from("ai_recharge_history").insert({
      printer_id:    printerId,
      credits_added: credits,
      amount_xof:    amount,
      payment_ref:   ref || method,
    });
    if (error) throw error;

    // CRITICAL FIX : l'app Electron du client lit ses crédits depuis
    // subscriptions.ai_credits_purchased (pas depuis ai_recharge_history,
    // qui ne sert qu'à l'historique affiché ici). Sans cette mise à jour,
    // le client restait bloqué à 0 crédit après une recharge "réussie".
    const { data: sub, error: subFetchErr } = await sb
      .from("subscriptions")
      .select("ai_credits_purchased")
      .eq("printer_id", printerId)
      .eq("status", "active")
      .single();
    if (subFetchErr) throw subFetchErr;

    const newPurchasedTotal = (sub?.ai_credits_purchased || 0) + credits;
    const { error: subUpdateErr } = await sb
      .from("subscriptions")
      .update({ ai_credits_purchased: newPurchasedTotal })
      .eq("printer_id", printerId)
      .eq("status", "active");
    if (subUpdateErr) throw subUpdateErr;

    const printerName = document.getElementById("recharge-printer-name").textContent;
    const msg = encodeURIComponent(
      `✅ Bonjour ${printerName} !\n\nVotre recharge Derewol AI est confirmée :\n• +${credits} crédits ajoutés\n• Montant : ${amount.toLocaleString("fr-FR")} FCFA\n• Réf : ${ref || method}\n\nBonne impression ! 🖨️`
    );
    const waHref = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`;

    successEl.innerHTML = `
      ✅ <strong>+${credits} crédits</strong> ajoutés !<br>
      <a href="${waHref}" target="_blank" rel="noopener"
         class="btn-whatsapp" style="display:inline-flex;margin-top:12px;">
        <i class="fa-brands fa-whatsapp"></i> Confirmer via WhatsApp
      </a>`;
    successEl.style.display = "block";
    await loadAiCredits();

  } catch (err) {
    errorEl.textContent = err.message || String(err);
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Recharger';
  }
}

async function openHistoryModal(printerId, printerName) {
  const modal = document.getElementById("modal-ai-history");
  if (!modal) return;
  document.getElementById("history-printer-name").textContent = printerName;
  document.getElementById("history-list").innerHTML = '<div class="loading">Chargement...</div>';
  modal.style.display = "flex";

  try {
    const { data, error } = await sb
      .from("ai_recharge_history")
      .select("credits_added, amount_xof, payment_ref, created_at")
      .eq("printer_id", printerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    if (!data || data.length === 0) {
      document.getElementById("history-list").innerHTML = '<p class="empty-state">Aucune recharge.</p>';
      return;
    }

    document.getElementById("history-list").innerHTML = data.map((r) => `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <strong>+${r.credits_added} crédits</strong>
          <br><small class="text-muted">${escAttr(r.payment_ref || "—")}</small>
        </div>
        <div style="text-align:right">
          <span class="badge badge-active">${(r.amount_xof||0).toLocaleString("fr-FR")} FCFA</span>
          <br><small class="text-muted">${new Date(r.created_at).toLocaleDateString("fr-FR")}</small>
        </div>
      </div>`).join("");

  } catch (err) {
    document.getElementById("history-list").innerHTML = `<p class="error-msg">${escAttr(err.message)}</p>`;
  }
}

function closeHistoryModal() {
  document.getElementById("modal-ai-history").style.display = "none";
}
