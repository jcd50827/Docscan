// Kommunikation mit der Apps-Script-Web-App.
// POST mit text/plain vermeidet den CORS-Preflight, den Apps Script nicht beantwortet.
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(message, { offline = false, auth = false } = {}) {
      super(message);
      this.name = 'ApiError';
      this.offline = offline;
      this.auth = auth; // true: Zugangscode ungültig/deaktiviert → abmelden
    }
  }

  function isConfigured() {
    const cfg = window.DOCSCAN_CONFIG || {};
    return typeof cfg.APPS_SCRIPT_URL === 'string' && /^https:\/\//.test(cfg.APPS_SCRIPT_URL);
  }

  async function call(action, code, payload = {}) {
    if (!isConfigured()) {
      throw new ApiError('Die App ist noch nicht eingerichtet: In config.js fehlt die APPS_SCRIPT_URL.');
    }
    let res;
    try {
      res = await fetch(window.DOCSCAN_CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, action, code }),
        redirect: 'follow',
        cache: 'no-store'
      });
    } catch (err) {
      throw new ApiError('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.', { offline: true });
    }
    if (!res.ok) throw new ApiError(`Serverfehler (${res.status}). Bitte später erneut versuchen.`);

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new ApiError('Unerwartete Antwort vom Server. Ist die Web-App für „Jeder“ freigegeben?');
    }
    if (!data || data.ok !== true) {
      throw new ApiError((data && data.error) || 'Unbekannter Fehler.', { auth: !!(data && data.auth) });
    }
    return data;
  }

  window.Api = {
    ApiError,
    isConfigured,
    login: (code) => call('login', code),
    listMine: (code) => call('listMine', code),
    stats: (code) => call('stats', code)
  };
})();
