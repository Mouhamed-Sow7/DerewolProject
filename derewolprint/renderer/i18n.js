const translations = {
  fr: {
    navJobs: 'Jobs',
    navHistory: 'Historique',
    navQr: 'Mon QR Code',
    navSettings: 'Parametres',
    jobsTitle: 'Jobs en attente',
    historyTitle: 'Historique',
    qrTitle: 'Mon QR Code',
    settingsTitle: 'Parametres',
    hotspotTitle: 'Hotspot local',
    hotspotDesc: 'Permet aux clients sans internet de se connecter directement.',
    hotspotStart: 'Demarrer le hotspot',
    hotspotStop: 'Arreter le hotspot',
    hotspotActive: 'Actif',
    hotspotInactive: 'Inactif',
    hotspotHintAdmin:
      'Sur Windows, le hotspot peut exiger des droits administrateur : clic droit sur DerewolPrint > Executer en tant qu\'administrateur. Verifiez aussi que le Wi-Fi est active.',
    hotspotPwaMissing:
      'Le dossier pwa-build est introuvable a cote de l\'app : copiez-y le build exporte (Next.js) pour que l\'URL locale fonctionne.',
  },
  en: {
    navJobs: 'Jobs',
    navHistory: 'History',
    navQr: 'My QR Code',
    navSettings: 'Settings',
    jobsTitle: 'Pending Jobs',
    historyTitle: 'History',
    qrTitle: 'My QR Code',
    settingsTitle: 'Settings',
    hotspotTitle: 'Local hotspot',
    hotspotDesc: 'Allow clients without internet to connect directly.',
    hotspotStart: 'Start hotspot',
    hotspotStop: 'Stop hotspot',
    hotspotActive: 'Active',
    hotspotInactive: 'Inactive',
    hotspotHintAdmin:
      'On Windows, the hotspot may need admin rights: right-click DerewolPrint > Run as administrator. Also ensure Wi-Fi is enabled.',
    hotspotPwaMissing:
      'The pwa-build folder next to the app is missing: copy your exported Next.js build there for the local URL to work.',
  },
  wo: {
    navJobs: 'Liggey yi',
    navHistory: 'Xam-xam',
    navQr: 'Sa QR Code',
    navSettings: 'Sett yi',
    jobsTitle: 'Liggey yi',
    historyTitle: 'Xam-xam',
    qrTitle: 'Sa QR Code',
    settingsTitle: 'Sett yi',
    hotspotTitle: 'Hotspot local',
    hotspotDesc: 'Dafa may nit yi amul internet yokku ci sa reseau bi.',
    hotspotStart: 'Tambali hotspot',
    hotspotStop: 'Teral hotspot',
    hotspotActive: 'Dafa dem',
    hotspotInactive: 'Taxawul',
    hotspotHintAdmin:
      'Ci Windows, hotspot bi mën na laaj droits administrateur. Verifie Wi-Fi bi.',
    hotspotPwaMissing:
      'Dossier pwa-build amul : copy sa build Next.js bi ci app bi.',
  }
};

let currentLang = 'fr';

export function getLang() {
  return currentLang;
}

export function t(key) {
  return translations[currentLang]?.[key] || translations.fr[key] || key;
}

export function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}

export function setLang(lang) {
  currentLang = translations[lang] ? lang : 'fr';
  localStorage.setItem('derewol_lang', currentLang);
  applyTranslations();
}

export function initLang() {
  const saved = localStorage.getItem('derewol_lang') || 'fr';
  currentLang = translations[saved] ? saved : 'fr';
  applyTranslations();
}
