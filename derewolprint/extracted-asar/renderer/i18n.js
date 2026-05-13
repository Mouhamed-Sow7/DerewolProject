const translations = {
  fr: {
    navJobs: "Jobs",
    navHistory: "Historique",
    navQr: "Mon QR Code",
    navSettings: "Paramètres",
    jobsTitle: "Jobs en attente",
    historyTitle: "Historique",
    qrTitle: "Mon QR Code",
    settingsTitle: "Paramètres",
    hotspotTitle: "Hotspot local",
    hotspotDesc:
      "Permet aux clients sans internet de se connecter directement.",
    hotspotStart: "Demarrer le hotspot",
    hotspotStop: "Arreter le hotspot",
    hotspotActive: "Actif",
    hotspotInactive: "Inactif",
    hotspotHintAdmin:
      "Sur Windows, le hotspot peut exiger des droits administrateur : clic droit sur DerewolPrint > Executer en tant qu'administrateur. Verifiez aussi que le Wi-Fi est active.",
    hotspotPwaMissing:
      "Le dossier pwa-build est introuvable a cote de l'app : copiez-y le build exporte (Next.js) pour que l'URL locale fonctionne.",
    activationTitle: "Activation Derewol Print",
    activationDesc: "Démarrez votre essai gratuit ou activez votre code.",
    trialTabLabel: "Essai gratuit",
    subscriptionTabLabel: "Abonnement",
    trialButtonText: "Démarrer mon essai",
    subscriptionButtonText: "Activer",
    settingDarkmode: "Mode sombre",
    settingDarkmodeDesc: "Thème foncé pour travailler la nuit",
    settingLanguage: "Langue",
    settingLanguageDesc: "Langue de l'interface",
    settingPrinter: "Imprimante par défaut",
    settingPrinterDesc: "Pré-sélectionnée au démarrage",
    settingSound: "Son de notification",
    settingSoundDesc: "Bip à l'arrivée d'un nouveau job",
    settingPolling: "Fréquence de vérification",
    settingPollingDesc: "Intervalle entre chaque vérification des jobs",
  },
  en: {
    navJobs: "Jobs",
    navHistory: "History",
    navQr: "My QR Code",
    navSettings: "Settings",
    jobsTitle: "Pending Jobs",
    historyTitle: "History",
    qrTitle: "My QR Code",
    settingsTitle: "Settings",
    hotspotTitle: "Local hotspot",
    hotspotDesc: "Allow clients without internet to connect directly.",
    hotspotStart: "Start hotspot",
    hotspotStop: "Stop hotspot",
    hotspotActive: "Active",
    hotspotInactive: "Inactive",
    hotspotHintAdmin:
      "On Windows, the hotspot may need admin rights: right-click DerewolPrint > Run as administrator. Also ensure Wi-Fi is enabled.",
    hotspotPwaMissing:
      "The pwa-build folder next to the app is missing: copy your exported Next.js build there for the local URL to work.",
    activationTitle: "DerewolPrint Activation",
    activationDesc: "Start your free trial or activate your code.",
    trialTabLabel: "Free trial",
    subscriptionTabLabel: "Subscription",
    trialButtonText: "Start my trial",
    subscriptionButtonText: "Activate",
    settingDarkmode: "Dark mode",
    settingDarkmodeDesc: "Dark theme for working at night",
    settingLanguage: "Language",
    settingLanguageDesc: "Interface language",
    settingPrinter: "Default printer",
    settingPrinterDesc: "Pre-selected on startup",
    settingSound: "Notification sound",
    settingSoundDesc: "Beep on new job arrival",
    settingPolling: "Check frequency",
    settingPollingDesc: "Interval between each job check",
  },
  wo: {
    navJobs: "Liggey yi",
    navHistory: "Xam-xam",
    navQr: "Sa QR Code",
    navSettings: "Sett yi",
    jobsTitle: "Liggey yi",
    historyTitle: "Xam-xam",
    qrTitle: "Sa QR Code",
    settingsTitle: "Sett yi",
    hotspotTitle: "Hotspot local",
    hotspotDesc: "Dafa may nit yi amul internet yokku ci sa reseau bi.",
    hotspotStart: "Tambali hotspot",
    hotspotStop: "Teral hotspot",
    hotspotActive: "Dafa dem",
    hotspotInactive: "Taxawul",
    hotspotHintAdmin:
      "Ci Windows, hotspot bi mën na laaj droits administrateur. Verifie Wi-Fi bi.",
    hotspotPwaMissing:
      "Dossier pwa-build amul : copy sa build Next.js bi ci app bi.",
    activationTitle: "Activation Derewol Print",
    activationDesc: "Tambali sa trial ya xojalante u saguew sa code.",
    trialTabLabel: "Trial ya jubante",
    subscriptionTabLabel: "Subscription",
    trialButtonText: "Tambali sa trial",
    subscriptionButtonText: "Activate",
    settingDarkmode: "Mode yomsa",
    settingDarkmodeDesc: "Jant yomsa lool bi gub",
    settingLanguage: "Làkk",
    settingLanguageDesc: "Làkk bu interface ba",
    settingPrinter: "Imprimante bi bokk",
    settingPrinterDesc: "Soo taal nalal fucc mi",
    settingSound: "Dëggu sayiwu",
    settingSoundDesc: "Dëeg su kat liggey bu jëm",
    settingPolling: "Tempo bu kàncal",
    settingPollingDesc: "Dalal aar ba liggey yi kàncal",
  },
};

let currentLang = "fr";

export function getLang() {
  return currentLang;
}

export function t(key) {
  return translations[currentLang]?.[key] || translations.fr[key] || key;
}

export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);

    if (text) {
      // Check if element has child elements (like icons in sidebar)
      if (el.children.length > 0) {
        // Has child elements - preserve them, only update text nodes
        Array.from(el.childNodes).forEach((node) => {
          if (node.nodeType === 3) {
            // Text node - remove it
            node.remove();
          }
        });
        // Add the new translated text
        el.appendChild(document.createTextNode(text));
      } else {
        // No child elements - safe to use textContent
        el.textContent = text;
      }
    }
  });
}

export function setLang(lang) {
  currentLang = translations[lang] ? lang : "fr";
  localStorage.setItem("derewol_lang", currentLang);
  // Update document language attribute
  document.documentElement.lang = currentLang;
  // Update language select dropdown (if called programmatically)
  const langSelect = document.getElementById("setting-lang");
  if (langSelect) {
    langSelect.value = currentLang;
  }
  // Apply translations instantly (no reload needed)
  applyTranslations();
}

export function initLang() {
  const saved = localStorage.getItem("derewol_lang") || "fr";
  currentLang = translations[saved] ? saved : "fr";
  // Update document language attribute
  document.documentElement.lang = currentLang;
  // Update language select dropdown
  const langSelect = document.getElementById("setting-lang");
  if (langSelect) {
    langSelect.value = currentLang;
  }
  // Apply translations to all elements
  applyTranslations();
}
