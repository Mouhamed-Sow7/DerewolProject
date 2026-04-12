const translations = {
  fr: {
    sending: "Envoyer a l'imprimeur",
    sending_progress: 'Envoi en cours...',
    drop_here: 'Glissez vos PDF ici',
    or_click: 'ou cliquez',
    files_remaining: 'fichier(s) restant(s)',
    my_files: 'Mes fichiers',
    send: '+ Envoyer',
    no_files: 'Aucun fichier en cours',
    history: 'Historique',
    new_session: 'Nouvelle session',
    waiting: "En attente de l'imprimeur",
    printing: 'Impression en cours',
    completed: 'Termine - fichiers supprimes',
    rejected: "Rejete par l'imprimeur",
    expired: 'Delai depasse - renvoyez vos fichiers',
    security_note: 'Fichiers supprimes automatiquement apres impression',
    connecting: 'Connexion...',
    not_found: 'Espace introuvable',
    not_found_desc: "Ce QR code n'est plus valide. Demandez un nouveau a l'imprimeur.",
  },
  en: {
    sending: 'Send to printer',
    sending_progress: 'Sending...',
    drop_here: 'Drop your PDFs here',
    or_click: 'or click',
    files_remaining: 'file(s) remaining',
    my_files: 'My files',
    send: '+ Send',
    no_files: 'No files in progress',
    history: 'History',
    new_session: 'New session',
    waiting: 'Waiting for the printer',
    printing: 'Printing in progress',
    completed: 'Done - files deleted',
    rejected: 'Rejected by the printer',
    expired: 'Expired - please resend your files',
    security_note: 'Files automatically deleted after printing',
    connecting: 'Connecting...',
    not_found: 'Space not found',
    not_found_desc: 'This QR code is no longer valid. Ask the printer for a new one.',
  },
  wo: {
    sending: 'Yonnee ci imprimeur bi',
    sending_progress: 'Yonnee mi dem na...',
    drop_here: 'Tebal sa PDF yi fii',
    or_click: 'walla bessel fii',
    files_remaining: 'dosye(i) des',
    my_files: 'Sama dosye yi',
    send: '+ Yonnee',
    no_files: 'Amul dosye ci yoon',
    history: 'Xam-xam',
    new_session: 'Session bu bees',
    waiting: 'Xaaral imprimeur bi',
    printing: 'Impression bi dem na',
    completed: 'Jeex na - dosye yi far na',
    rejected: 'Imprimeur bi bany na ko',
    expired: 'Mu jeex na - yonnee koat',
    security_note: 'Dosye yi dees leen di far ci auto gannaaw impression',
    connecting: 'Connexion...',
    not_found: 'Espace bi amul',
    not_found_desc: 'QR code bii dootu dox. Laaj imprimeur bi mu may la bu bees.',
  }
};

export function getLang() {
  if (typeof window === 'undefined') return 'fr';
  return localStorage.getItem('derewol_pwa_lang') || 'fr';
}

export function setLang(lang) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('derewol_pwa_lang', lang);
    window.location.reload();
  }
}

export function t(key) {
  const lang = getLang();
  return translations[lang]?.[key] || translations.fr[key] || key;
}
