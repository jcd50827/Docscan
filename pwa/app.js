// DocScan – UI, Routing, State.
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Speicher (localStorage kann in privaten Tabs o. Ä. werfen → Fallback im Speicher)
  // -------------------------------------------------------------------------
  const memoryStore = {};
  const Store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return memoryStore[key] ?? null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { memoryStore[key] = value; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignorieren */ }
      delete memoryStore[key];
    }
  };

  const KEY_CODE = 'docscan.code';
  const KEY_NUTZER = 'docscan.nutzer';

  const state = {
    code: Store.get(KEY_CODE),
    nutzer: parseJson(Store.get(KEY_NUTZER)),
    renderToken: 0
  };

  function parseJson(text) {
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
  }

  function setSession(code, nutzer) {
    state.code = code;
    state.nutzer = nutzer;
    Store.set(KEY_CODE, code);
    Store.set(KEY_NUTZER, JSON.stringify(nutzer));
  }

  function logout(meldung) {
    state.code = null;
    state.nutzer = null;
    Store.remove(KEY_CODE);
    Store.remove(KEY_NUTZER);
    closeMenu();
    if (location.hash !== '#/login') location.hash = '#/login';
    else route();
    if (meldung) toast(meldung);
  }

  const isEditor = () => !!state.nutzer && state.nutzer.rolle === 'editor';

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const fmtEuro = (n) => (typeof n === 'number' ? euro.format(n) : '–');
  const fmtDatum = (iso) => {
    if (!iso) return '–';
    const d = new Date(iso);
    return isNaN(d) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // -------------------------------------------------------------------------
  // Menü
  // -------------------------------------------------------------------------
  function openMenu() {
    $('#menu').hidden = false;
    $('#menu-btn').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    $('#menu').hidden = true;
    $('#menu-btn').setAttribute('aria-expanded', 'false');
  }

  function updateChrome() {
    const angemeldet = !!state.code && !!state.nutzer;
    $('#topbar').hidden = !angemeldet;
    if (!angemeldet) return;
    $('#menu-user').innerHTML =
      `<strong>${esc(state.nutzer.name)}</strong><span>${state.nutzer.rolle === 'editor' ? 'Editor' : 'Contributor'}</span>`;
    document.querySelectorAll('[data-rolle="editor"]').forEach((el) => { el.hidden = !isEditor(); });
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------
  const routes = {
    '#/login': renderLogin,
    '#/': renderHome,
    '#/liste': renderListe
  };

  function route() {
    closeMenu();
    let hash = location.hash || '#/';
    if (!state.code || !state.nutzer) hash = '#/login';
    else if (hash === '#/login') hash = '#/';
    if (hash === '#/liste' && !isEditor()) hash = '#/';
    if (!routes[hash]) hash = '#/';
    if (location.hash !== hash) history.replaceState(null, '', hash);

    state.renderToken++;
    updateChrome();
    routes[hash](state.renderToken);
    window.scrollTo(0, 0);
  }

  /** true, wenn inzwischen eine andere Ansicht gerendert wurde. */
  const veraltet = (token) => token !== state.renderToken;

  function handleApiError(err, container) {
    if (err.auth) {
      logout(err.message);
      return;
    }
    const text = err.offline ? 'Offline – Daten können gerade nicht geladen werden.' : err.message;
    if (container) container.innerHTML = `<p class="notice notice-error">${esc(text)}</p>`;
    else toast(text);
  }

  // -------------------------------------------------------------------------
  // Ansicht: Login
  // -------------------------------------------------------------------------
  function renderLogin() {
    const konfiguriert = Api.isConfigured();
    $('#app').innerHTML = `
      <section class="login">
        <img src="icons/icon-192.png" alt="" class="login-logo" width="96" height="96">
        <h1>DocScan</h1>
        <p class="muted">Bitte den persönlichen Zugangscode eingeben.</p>
        ${konfiguriert ? '' : '<p class="notice notice-error">Die App ist noch nicht eingerichtet: In <code>config.js</code> fehlt die Apps-Script-URL.</p>'}
        <form id="login-form" novalidate>
          <label for="code-input" class="visually-hidden">Zugangscode</label>
          <input id="code-input" name="code" type="text" class="input input-code"
                 placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"
                 autocorrect="off" spellcheck="false" required>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit">Anmelden</button>
          <p class="form-error" id="login-error" role="alert" hidden></p>
        </form>
      </section>`;

    const form = $('#login-form');
    const input = $('#code-input');
    const submit = $('#login-submit');
    const fehler = $('#login-error');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const code = input.value.trim();
      fehler.hidden = true;
      if (!code) {
        fehler.textContent = 'Bitte einen Zugangscode eingeben.';
        fehler.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Wird geprüft …';
      try {
        const res = await Api.login(code);
        setSession(code, { name: res.name, rolle: res.rolle });
        location.hash = '#/';
      } catch (err) {
        fehler.textContent = err.message;
        fehler.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Anmelden';
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ansicht: Startseite
  // -------------------------------------------------------------------------
  function renderHome(token) {
    const n = state.nutzer;
    $('#app').innerHTML = `
      <section class="greeting">
        <p class="muted">Hallo ${esc(n.name)}</p>
      </section>
      <button type="button" class="btn-scan" id="scan-btn">
        <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>Scannen</span>
      </button>
      <section id="home-content" class="home-content">
        <p class="muted">Wird geladen …</p>
      </section>`;

    $('#scan-btn').addEventListener('click', () => {
      toast('Die Scan-Funktion folgt im nächsten Update.');
    });

    if (isEditor()) loadEditorOverview(token);
    else loadMyUploads(token);
  }

  async function loadMyUploads(token) {
    const box = $('#home-content');
    try {
      const res = await Api.listMine(state.code);
      if (veraltet(token)) return;
      const doks = res.dokumente || [];
      box.innerHTML = `
        <h2>Meine Uploads (letzte 7 Tage)</h2>
        ${doks.length
          ? `<ul class="cards">${doks.map(uploadCard).join('')}</ul>`
          : '<p class="empty">Noch keine Uploads in den letzten 7 Tagen.</p>'}`;
    } catch (err) {
      if (!veraltet(token)) handleApiError(err, box);
    }
  }

  function uploadCard(d) {
    const titel = d.titel || d.absender || d.kategorie || 'Dokument';
    return `
      <li class="card">
        <div class="card-main">
          <strong class="card-title">${esc(titel)}</strong>
          <span class="muted">${esc(fmtDatum(d.erstellt_am))}</span>
        </div>
        <div class="card-side">
          ${d.kategorie ? `<span class="badge">${esc(d.kategorie)}</span>` : ''}
          ${typeof d.betrag === 'number' ? `<span>${esc(fmtEuro(d.betrag))}</span>` : ''}
        </div>
      </li>`;
  }

  async function loadEditorOverview(token) {
    const box = $('#home-content');
    try {
      const s = await Api.stats(state.code);
      if (veraltet(token)) return;
      const naechste = s.naechsteFaelligkeiten || [];
      box.innerHTML = `
        <h2>Übersicht</h2>
        <div class="stats">
          <div class="stat stat-wide">
            <span class="stat-label">Summe offen</span>
            <span class="stat-value">${esc(fmtEuro(s.summeOffen))}</span>
            <span class="stat-sub">${s.anzahlOffen} ${s.anzahlOffen === 1 ? 'Rechnung' : 'Rechnungen'}</span>
          </div>
          <div class="stat ${s.anzahlUeberfaellig > 0 ? 'stat-danger' : ''}">
            <span class="stat-label">Überfällig</span>
            <span class="stat-value">${s.anzahlUeberfaellig}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Nächste 7 Tage</span>
            <span class="stat-value">${naechste.length}</span>
          </div>
        </div>
        ${naechste.length ? `
          <h2>Bald fällig</h2>
          <ul class="cards">${naechste.map(faelligCard).join('')}</ul>` : ''}
        <a href="#/liste" class="btn btn-secondary btn-block">Zur Tracking-Liste</a>`;
    } catch (err) {
      if (!veraltet(token)) handleApiError(err, box);
    }
  }

  function faelligCard(d) {
    return `
      <li class="card">
        <div class="card-main">
          <strong class="card-title">${esc(d.absender || d.titel || d.kategorie)}</strong>
          <span class="muted">fällig ${esc(fmtDatum(d.faellig_am))}</span>
        </div>
        <div class="card-side"><strong>${esc(fmtEuro(d.betrag))}</strong></div>
      </li>`;
  }

  // -------------------------------------------------------------------------
  // Ansicht: Tracking-Liste (Editor) – folgt in Meilenstein 4
  // -------------------------------------------------------------------------
  function renderListe() {
    $('#app').innerHTML = `
      <h1>Tracking-Liste</h1>
      <p class="empty">Die Tracking-Liste mit Filtern und Abhaken folgt in einem späteren Update.</p>
      <a href="#/" class="btn btn-secondary btn-block">Zurück zur Startseite</a>`;
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  /** Prüft beim Start im Hintergrund, ob der gespeicherte Code noch gilt und die Rolle stimmt. */
  async function refreshSession() {
    if (!state.code) return;
    try {
      const res = await Api.login(state.code);
      const rolleGeaendert = !state.nutzer || state.nutzer.rolle !== res.rolle || state.nutzer.name !== res.name;
      setSession(state.code, { name: res.name, rolle: res.rolle });
      if (rolleGeaendert) route();
    } catch (err) {
      if (err.auth) logout(err.message);
      // Offline oder Serverfehler: mit zwischengespeicherter Rolle weiterarbeiten.
    }
  }

  function init() {
    $('#menu-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if ($('#menu').hidden) openMenu(); else closeMenu();
    });
    document.addEventListener('click', (ev) => {
      if (!$('#menu').hidden && !ev.target.closest('#menu')) closeMenu();
    });
    $('#logout-btn').addEventListener('click', () => logout('Abgemeldet.'));
    window.addEventListener('hashchange', route);

    route();
    refreshSession();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker:', err));
    }
  }

  init();
})();
