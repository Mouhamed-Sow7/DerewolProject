let currentSubFilter = "all";

// Escape HTML attributes to prevent XSS
function escAttr(s) {
  if (s == null) return "";
  return String(s)
    .split("\x26")
    .join("\x26amp;")
    .split("\x22")
    .join("\x26quot;")
    .split("\x3C")
    .join("\x26lt;")
    .split("\x3E")
    .join("\x26gt;");
}

document.addEventListener("DOMContentLoaded", async () => {
  // Attend que requireAuth soit défini (max 3 secondes)
  let waited = 0;
  while (typeof requireAuth === "undefined" && waited < 3000) {
    await new Promise((r) => setTimeout(r, 50));
    waited += 50;
  }
  if (typeof requireAuth === "undefined") {
    console.error("auth.js non chargé");
    return;
  }
  const session = await requireAuth();
  if (!session) return;

  // Setup logout button
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      adminLogout();
    });
  }

  // Setup navigation
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".nav-item")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document
        .getElementById("view-" + btn.dataset.view)
        .classList.add("active");
      loadView(btn.dataset.view);
    });
  });

  // Setup "Générer un code" button
  const btnGenCode = document.getElementById("btn-gen-code");
  if (btnGenCode) {
    btnGenCode.disabled = false; // S'assurer qu'il n'est jamais disabled
    btnGenCode.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[Admin] Ouverture modal génération code...");
      openGenModal();
    });
  } else {
    console.error("[Dashboard] Button #btn-gen-code not found");
  }

  const genCloseBtn = document.getElementById("gen-close-btn");
  if (genCloseBtn) {
    genCloseBtn.addEventListener("click", () => {
      closeGenModal();
    });
  }

  const genSubmitBtn = document.getElementById("gen-submit-btn");
  if (genSubmitBtn) {
    genSubmitBtn.addEventListener("click", () => {
      handleGenCode();
    });
  }

  const genCopy = document.getElementById("gen-copy-btn");
  if (genCopy) {
    genCopy.innerText = "📋 Copier";
    genCopy.addEventListener("click", () => {
      const code = document.getElementById("gen-code-value").textContent;
      navigator.clipboard.writeText(code);
      genCopy.innerText = "✓ Copié!";
      setTimeout(() => (genCopy.innerText = "📋 Copier"), 2000);
    });
  }

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentSubFilter = btn.dataset.filter;
      loadSubscriptions(currentSubFilter);
    });
  });

  let searchTimer;
  const printersSearch = document.getElementById("printers-search");
  if (printersSearch) {
    printersSearch.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadPrinters(e.target.value), 300);
    });
  }

  const printersTbody = document.getElementById("printers-tbody");
  if (printersTbody) {
    printersTbody.addEventListener("click", (e) => {
      const gen = e.target.closest("[data-action='gen-code']");
      if (gen) {
        openGenModalForPrinter(gen.dataset.printerId, gen.dataset.printerName);
      }
    });
  }

  const subscriptionsTbody = document.getElementById("subscriptions-tbody");
  if (subscriptionsTbody) {
    subscriptionsTbody.addEventListener("click", (e) => {
      const copyBtn = e.target.closest("[data-action='copy-code']");
      if (copyBtn) {
        navigator.clipboard.writeText(copyBtn.dataset.code || "");
        return;
      }
      const rev = e.target.closest("[data-action='revoke']");
      if (rev) {
        handleRevoke(rev.dataset.subId);
      }
    });
  }

  const modal = document.getElementById("modal-gen-code");
  if (modal) {
    const backdrop = modal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        closeGenModal();
      });
    }
  }

  // Fermeture modal par touche ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modalGen = document.getElementById("modal-gen-code");
      if (modalGen && modalGen.style.display !== "none") {
        closeGenModal();
      }
    }
  });

  loadView("overview");
});

async function loadView(view) {
  if (view === "overview") await loadOverview();
  if (view === "printers") await loadPrinters();
  if (view === "subscriptions") await loadSubscriptions(currentSubFilter);
}

async function loadOverview() {
  try {
    const [stats, subsActive] = await Promise.all([
      fetchSubStats(),
      fetchSubscriptions("active"),
    ]);

    document.getElementById("stat-total-printers").textContent =
      stats.totalPrinters;
    document.getElementById("stat-active-subs").textContent = stats.active;
    document.getElementById("stat-expiring-soon").textContent = stats.expiring;
    document.getElementById("stat-revenue").textContent =
      stats.revenue.toLocaleString("fr-FR");

    const expiring = (subsActive || []).filter((s) => {
      if (!s.expires_at) return false;
      const days = Math.ceil((new Date(s.expires_at) - new Date()) / 86400000);
      return days <= 7 && days > 0;
    });

    const list = document.getElementById("expiring-list");
    if (expiring.length === 0) {
      list.innerHTML =
        '<p class="empty-state">Aucun abonnement n\'expire dans les 7 prochains jours</p>';
    } else {
      list.innerHTML = expiring
        .map((s) => {
          const days = Math.ceil(
            (new Date(s.expires_at) - new Date()) / 86400000,
          );
          const phone = (s.printers?.owner_phone || "").replace(/\D/g, "");
          const name = escAttr(s.printers?.name || "—");
          const slug = escAttr(s.printers?.slug || "");
          const msg = encodeURIComponent(
            "Bonjour, votre abonnement Derewol expire dans " +
              days +
              " jour(s). Renouvelez pour continuer à recevoir des impressions.",
          );
          const wa = phone
            ? "https://wa.me/" + phone + "?text=" + msg
            : "https://wa.me/?text=" + msg;
          return (
            '<div class="expiring-row">' +
            "<div>" +
            "<strong>" +
            name +
            '</strong> <span class="text-muted">' +
            slug +
            "</span>" +
            "</div>" +
            '<div class="expiring-meta">' +
            '<span class="badge badge-warning">' +
            days +
            " jour" +
            (days > 1 ? "s" : "") +
            "</span>" +
            '<a href="' +
            wa +
            '" target="_blank" rel="noopener" class="btn-whatsapp-sm">' +
            '<i class="fa-brands fa-whatsapp"></i> Relancer' +
            "</a>" +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    }
  } catch (err) {
    console.error(err);
    document.getElementById("expiring-list").innerHTML =
      '<p class="error-msg">' + escAttr(err.message) + "</p>";
  }
}

async function loadPrinters(search = "") {
  const tbody = document.getElementById("printers-tbody");
  tbody.innerHTML =
    '<tr><td colspan="6" class="loading">Chargement...</td></tr>';
  try {
    const data = await fetchPrinters(search);
    document.getElementById("printers-count").textContent = data.length;
    if (data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="empty-state">Aucun imprimeur</td></tr>';
      return;
    }
    tbody.innerHTML = data
      .map((p) => {
        const sub = getPrinterSubStatus(p);
        const phone = p.owner_phone || "—";
        const phoneDigits = (p.owner_phone || "").replace(/\D/g, "");
        const waMsg = encodeURIComponent(
          "Bonjour " +
            p.name +
            " 👋\n\nVous utilisez DerewolPrint ? Renouvelez votre abonnement :\n• 1 mois : 5 000 FCFA\n• 3 mois : 12 500 FCFA\n• 6 mois : 25 500 FCFA\n\nContactez-nous pour votre code d'activation.",
        );
        const waHref = phoneDigits
          ? "https://wa.me/" + phoneDigits + "?text=" + waMsg
          : "https://wa.me/?text=" + waMsg;
        return (
          "<tr>" +
          "<td><strong>" +
          escAttr(p.name) +
          "</strong></td>" +
          "<td><code>" +
          escAttr(p.slug) +
          "</code></td>" +
          "<td>" +
          escAttr(phone) +
          "</td>" +
          "<td>" +
          new Date(p.created_at).toLocaleDateString("fr-FR") +
          "</td>" +
          '<td><span class="badge ' +
          sub.cls +
          '">' +
          sub.label +
          "</span></td>" +
          '<td class="td-actions">' +
          '<button type="button" class="btn-action" data-action="gen-code" data-printer-id="' +
          p.id +
          '" data-printer-name="' +
          escAttr(p.name) +
          '">' +
          '<i class="fa-solid fa-key"></i> Code' +
          "</button>" +
          (phoneDigits
            ? '<a href="' +
              waHref +
              '" target="_blank" rel="noopener" class="btn-action"><i class="fa-brands fa-whatsapp"></i></a>'
            : "") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (err) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="error-msg">' +
      escAttr(err.message) +
      "</td></tr>";
  }
}

async function loadSubscriptions(filter = "all") {
  const tbody = document.getElementById("subscriptions-tbody");
  tbody.innerHTML =
    '<tr><td colspan="8" class="loading">Chargement...</td></tr>';
  try {
    const data = await fetchSubscriptions(filter);
    if (data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="empty-state">Aucun abonnement</td></tr>';
      return;
    }
    const statusBadge = {
      active: '<span class="badge badge-active">Actif</span>',
      pending: '<span class="badge badge-pending">En attente</span>',
      expired: '<span class="badge badge-expired">Expiré</span>',
      used: '<span class="badge badge-used">Utilisé</span>',
    };
    const methodLabel = {
      wave: "Wave",
      orange_money: "Orange Money",
      manual: "Manuel",
    };
    const planLabel = {
      "1month": "1 mois",
      "3months": "3 mois",
      "6months": "6 mois",
    };
    tbody.innerHTML = data
      .map((s) => {
        const st =
          statusBadge[s.status] ||
          '<span class="badge">' + escAttr(s.status) + "</span>";
        const ml =
          methodLabel[s.payment_method] || escAttr(s.payment_method || "—");
        const pl = planLabel[s.plan] || escAttr(s.plan || "—");
        const revokeBtn =
          s.status === "active"
            ? '<button type="button" class="btn-action btn-danger" data-action="revoke" data-sub-id="' +
              s.id +
              '"><i class="fa-solid fa-ban"></i> Révoquer</button>'
            : "—";
        const printerCell =
          s.printer_id === null
            ? "<em>Tout imprimeur</em>"
            : "<strong>" +
              escAttr(s.printers?.name || "—") +
              "</strong><br>" +
              "<small>" +
              escAttr(s.printers?.slug || "—") +
              "</small><br>" +
              "<small>" +
              escAttr(s.printers?.owner_phone || "—") +
              "</small>";

        return (
          "<tr>" +
          "<td>" +
          '<code class="code-cell">' +
          escAttr(s.activation_code) +
          "</code>" +
          '<button type="button" class="btn-icon" data-action="copy-code" data-code="' +
          escAttr(s.activation_code) +
          '" title="Copier">' +
          '<i class="fa-regular fa-copy"></i>' +
          "</button>" +
          "</td>" +
          "<td>" +
          printerCell +
          "</td>" +
          "<td>" +
          escAttr(ml) +
          "</td>" +
          "<td>" +
          (s.amount ?? 0).toLocaleString("fr-FR") +
          " FCFA</td>" +
          "<td>" +
          st +
          "</td>" +
          "<td>" +
          (s.activated_at
            ? new Date(s.activated_at).toLocaleDateString("fr-FR")
            : "—") +
          "</td>" +
          "<td>" +
          (s.expires_at
            ? new Date(s.expires_at).toLocaleDateString("fr-FR")
            : "—") +
          "</td>" +
          "<td>" +
          revokeBtn +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (err) {
    tbody.innerHTML =
      '<tr><td colspan="8" class="error-msg">' +
      escAttr(err.message) +
      "</td></tr>";
  }
}

async function openGenModal() {
  const modal = document.getElementById("modal-gen-code");
  const resultEl = document.getElementById("gen-result");
  const errorEl = document.getElementById("gen-error");
  const submitBtn = document.getElementById("gen-submit-btn");

  // Réinitialiser état modal
  if (resultEl) resultEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML =
      '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer';
  }

  modal.style.display = "flex";

  // Charger imprimeurs dans le select
  const select = document.getElementById("gen-printer-id");
  select.innerHTML = '<option value="">Chargement...</option>';
  try {
    const printers = await fetchPrinters();
    select.innerHTML =
      '<option value="">— Tout imprimeur (code libre) —</option>' +
      printers
        .map(
          (p) =>
            '<option value="' +
            p.id +
            '">' +
            escAttr(p.name) +
            " (" +
            escAttr(p.slug) +
            ")</option>",
        )
        .join("");
  } catch (err) {
    select.innerHTML = '<option value="">Erreur chargement</option>';
    console.error("[Modal] fetchPrinters:", err);
  }
}

async function openGenModalForPrinter(id, name) {
  await openGenModal();
  const sel = document.getElementById("gen-printer-id");
  if (sel && id) sel.value = id;
}

function closeGenModal() {
  document.getElementById("modal-gen-code").style.display = "none";
}

async function handleGenCode() {
  const printerIdRaw = document.getElementById("gen-printer-id").value;
  const printerId = printerIdRaw || null;
  const paymentMethod = document.getElementById("gen-payment-method").value;
  const plan = document.getElementById("gen-plan")?.value || "1month";

  // Durée et montant selon le plan
  const PLANS = {
    "1month": { days: 30, amount: 5000 },
    "3months": { days: 90, amount: 12500 },
    "6months": { days: 180, amount: 25500 },
  };
  const planData = PLANS[plan] || PLANS["1month"];
  const durationDays = planData.days;
  const amount = planData.amount;

  const btn = document.getElementById("gen-submit-btn");
  const errorEl = document.getElementById("gen-error");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération...';
  errorEl.style.display = "none";

  try {
    const result = await createActivationCode({
      printerId,
      paymentMethod,
      durationDays,
      amount,
      plan,
    });
    document.getElementById("gen-result").style.display = "block";
    const codeValue = document.getElementById("gen-code-value");
    codeValue.textContent = result.activation_code;
    codeValue.style.display = "inline-block";
    codeValue.style.padding = "0.75rem 1rem";
    codeValue.style.border = "1px solid #d1d5db";
    codeValue.style.borderRadius = "0.75rem";
    codeValue.style.backgroundColor = "#f8fafc";
    codeValue.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    codeValue.style.letterSpacing = "0.08em";
    codeValue.style.marginBottom = "0.75rem";

    const genCopyBtn = document.getElementById("gen-copy-btn");
    if (genCopyBtn) {
      genCopyBtn.innerText = "📋 Copier";
      genCopyBtn.style.minWidth = "120px";
    }

    const planLabels = {
      "1month": "1 mois",
      "3months": "3 mois",
      "6months": "6 mois",
    };
    const planLabel = planLabels[plan] || "";
    const msg = encodeURIComponent(
      "Votre code d'activation Derewol :\n*" +
        result.activation_code +
        "*\nPlan : " +
        planLabel +
        "\nValable 30 jours",
    );
    const waBtn = document.getElementById("gen-whatsapp-btn");
    if (waBtn) {
      waBtn.href = "https://wa.me/?text=" + msg;
      waBtn.target = "_blank";
      waBtn.style.display = "inline-flex";
      waBtn.innerHTML = "<span>📲 Envoyer via WhatsApp</span>";
    }

    await loadSubscriptions(currentSubFilter);
    await loadOverview();
  } catch (err) {
    errorEl.textContent = err.message || String(err);
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Générer';
  }
}

async function handleRevoke(id) {
  if (!id || !confirm("Révoquer cet abonnement ?")) return;
  try {
    await revokeSubscription(id);
    await loadSubscriptions(currentSubFilter);
    await loadOverview();
  } catch (e) {
    alert(e.message || String(e));
  }
}
