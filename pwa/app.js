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
  /** Kurzer Hinweis unten; optional mit Aktion, z. B. { label: 'Rückgängig', fn }. */
  function toast(text, aktion) {
    const el = $('#toast');
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (aktion) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = aktion.label;
      btn.addEventListener('click', () => { el.hidden = true; aktion.fn(); });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, aktion ? 6000 : 3500);
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
    '#/scan': renderScan,
    '#/liste': renderListe,
    '#/dok': renderDetail
  };

  function route() {
    closeMenu();
    let hash = location.hash || '#/';
    if (!state.code || !state.nutzer) hash = '#/login';
    else if (hash === '#/login') hash = '#/';
    // #/dok/<id> → Route „#/dok“ mit Parameter
    const m = /^#\/dok\/([\w-]+)$/.exec(hash);
    let key = m ? '#/dok' : hash;
    if ((key === '#/liste' || key === '#/dok') && !isEditor()) key = hash = '#/';
    if (!routes[key]) key = hash = '#/';
    if (location.hash !== hash) history.replaceState(null, '', hash);

    state.renderToken++;
    updateChrome();
    routes[key](state.renderToken, m ? m[1] : null);
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
      <label class="btn-scan" for="home-cam">
        ${SCAN_ICON}
        <span>Scannen</span>
      </label>
      <input type="file" id="home-cam" accept="image/*" capture="environment" hidden>
      <section id="home-content" class="home-content">
        <p class="muted">Wird geladen …</p>
      </section>`;

    $('#home-cam').addEventListener('change', (ev) => {
      seitenHinzufuegen(ev.target.files);
      location.hash = '#/scan';
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
          <a class="stat stat-wide" href="#/liste">
            <span class="stat-label">Summe offen</span>
            <span class="stat-value">${esc(fmtEuro(s.summeOffen))}</span>
            <span class="stat-sub">${s.anzahlOffen} ${s.anzahlOffen === 1 ? 'Rechnung' : 'Rechnungen'}</span>
          </a>
          <a class="stat ${s.anzahlUeberfaellig > 0 ? 'stat-danger' : ''}" href="#/liste">
            <span class="stat-label">Überfällig</span>
            <span class="stat-value">${s.anzahlUeberfaellig}</span>
          </a>
          <a class="stat" href="#/liste">
            <span class="stat-label">Nächste 7 Tage</span>
            <span class="stat-value">${naechste.length}</span>
          </a>
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
      <li>
        <a class="card card-link" href="#/dok/${esc(d.id)}">
          <div class="card-main">
            <strong class="card-title">${esc(d.absender || d.titel || d.kategorie)}</strong>
            <span class="muted">fällig ${esc(fmtDatum(d.faellig_am))}</span>
          </div>
          <div class="card-side"><strong>${esc(fmtEuro(d.betrag))}</strong></div>
        </a>
      </li>`;
  }

  // -------------------------------------------------------------------------
  // Ansicht: Scannen
  // -------------------------------------------------------------------------
  const SCAN_ICON = '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // Bleibt im Speicher, solange die App offen ist (Offline-Warteschlange folgt in Meilenstein 5).
  const scan = {
    seiten: [],       // { id, file, thumb }
    filter: true,
    titel: '',
    laeuft: false,
    ergebnis: null,   // Antwort des Uploads
    ersetzeIndex: -1
  };
  let seitenId = 0;

  function seitenHinzufuegen(dateien, ersetzeIndex = -1) {
    const neu = Array.from(dateien || []).filter((f) => f.type.startsWith('image/') || !f.type);
    if (!neu.length) return;
    scan.ergebnis = null;
    neu.forEach((file, i) => {
      const seite = { id: ++seitenId, file, thumb: null };
      if (ersetzeIndex >= 0 && i === 0) scan.seiten[ersetzeIndex] = seite;
      else scan.seiten.push(seite);
      erzeugeThumb(seite);
    });
  }

  async function erzeugeThumb(seite) {
    try {
      const t = await Scanner.verarbeiteSeite(seite.file, { filter: scan.filter, skala: 0.2, qualitaet: 0.6 });
      seite.thumb = t.dataUrl;
    } catch (err) {
      seite.thumb = '';
      seite.fehler = err.message;
    }
    const img = document.querySelector(`[data-seite="${seite.id}"] img`);
    if (img) img.src = seite.thumb;
    else if (location.hash === '#/scan') renderSeiten();
  }

  function renderScan() {
    if (scan.ergebnis) return renderErgebnis();
    $('#app').innerHTML = `
      <h1>Scannen</h1>
      <p class="muted">Seiten nacheinander aufnehmen. Eine Seite antippen, um sie neu aufzunehmen.</p>
      <ol class="pages" id="pages"></ol>
      <div class="scan-actions">
        <label class="btn btn-secondary" for="cam-input">+ Seite aufnehmen</label>
        <label class="btn btn-ghost" for="lib-input">Aus Fotos wählen</label>
      </div>
      <input type="file" id="cam-input" accept="image/*" capture="environment" hidden>
      <input type="file" id="lib-input" accept="image/*" multiple hidden>
      <input type="file" id="replace-input" accept="image/*" capture="environment" hidden>

      <label class="toggle">
        <input type="checkbox" id="filter-toggle" ${scan.filter ? 'checked' : ''}>
        <span><strong>Filter „Dokument“</strong><br><span class="muted">Graustufen und mehr Kontrast – kleinere Datei, bessere Texterkennung</span></span>
      </label>

      <label for="titel-input" class="field-label">Titel (optional)</label>
      <input id="titel-input" class="input" type="text" maxlength="100"
             placeholder="z. B. Stadtwerke – Strom Oktober" value="${esc(scan.titel)}">

      <button type="button" class="btn btn-primary btn-block" id="upload-btn"></button>
      <p class="scan-status" id="scan-status" role="status"></p>
      <button type="button" class="btn btn-ghost btn-block" id="cancel-btn">Abbrechen</button>`;

    $('#cam-input').addEventListener('change', (ev) => { seitenHinzufuegen(ev.target.files); ev.target.value = ''; renderSeiten(); });
    $('#lib-input').addEventListener('change', (ev) => { seitenHinzufuegen(ev.target.files); ev.target.value = ''; renderSeiten(); });
    $('#replace-input').addEventListener('change', (ev) => {
      seitenHinzufuegen(ev.target.files, scan.ersetzeIndex);
      ev.target.value = '';
      renderSeiten();
    });
    $('#filter-toggle').addEventListener('change', (ev) => {
      scan.filter = ev.target.checked;
      scan.seiten.forEach((s) => { s.thumb = null; erzeugeThumb(s); });
      renderSeiten();
    });
    $('#titel-input').addEventListener('input', (ev) => { scan.titel = ev.target.value; });
    $('#pages').addEventListener('click', (ev) => {
      if (scan.laeuft) return;
      const del = ev.target.closest('[data-del]');
      const rep = ev.target.closest('[data-replace]');
      if (del) {
        scan.seiten.splice(Number(del.dataset.del), 1);
        renderSeiten();
      } else if (rep) {
        scan.ersetzeIndex = Number(rep.dataset.replace);
        $('#replace-input').click();
      }
    });
    $('#upload-btn').addEventListener('click', hochladen);
    $('#cancel-btn').addEventListener('click', () => {
      if (scan.laeuft) return;
      if (scan.seiten.length && !confirm('Aufgenommene Seiten verwerfen?')) return;
      scan.seiten = [];
      scan.titel = '';
      location.hash = '#/';
    });
    renderSeiten();
  }

  function renderSeiten() {
    const liste = $('#pages');
    if (!liste) return;
    liste.innerHTML = scan.seiten.length
      ? scan.seiten.map((s, i) => `
          <li class="page" data-seite="${s.id}">
            <button type="button" class="page-thumb" data-replace="${i}" aria-label="Seite ${i + 1} neu aufnehmen">
              ${s.thumb ? `<img src="${s.thumb}" alt="">` : s.thumb === '' ? '<span class="page-error">Fehler</span>' : '<span class="spinner" aria-hidden="true"></span>'}
            </button>
            <span class="page-nr">${i + 1}</span>
            <button type="button" class="page-del" data-del="${i}" aria-label="Seite ${i + 1} löschen">×</button>
          </li>`).join('')
      : '<li class="empty">Noch keine Seite aufgenommen.</li>';
    const btn = $('#upload-btn');
    const n = scan.seiten.length;
    btn.disabled = scan.laeuft || n === 0;
    btn.textContent = scan.laeuft ? 'Bitte warten …' : n ? `Hochladen (${n} ${n === 1 ? 'Seite' : 'Seiten'})` : 'Hochladen';
  }

  function setScanStatus(text, fehler = false) {
    const el = $('#scan-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('scan-status-error', fehler);
  }

  async function hochladen() {
    if (scan.laeuft || !scan.seiten.length) return;
    scan.laeuft = true;
    renderSeiten();
    setScanStatus('');
    try {
      const pdf = await Scanner.erstelleDokument(scan.seiten.map((s) => s.file), {
        filter: scan.filter,
        onFortschritt: (t) => setScanStatus(t)
      });
      setScanStatus(`Wird hochgeladen und ausgelesen (${(pdf.bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB) – das dauert einige Sekunden …`);
      const res = await Api.upload(state.code, {
        pdfBase64: pdf.base64,
        seiten: scan.seiten.length,
        titelVorschlag: scan.titel.trim() || undefined
      });
      scan.ergebnis = { ...res.dokument, seiten: scan.seiten.length };
      scan.seiten = [];
      scan.titel = '';
      scan.laeuft = false;
      if (location.hash === '#/scan') renderScan();
    } catch (err) {
      scan.laeuft = false;
      if (err.auth) return logout(err.message);
      renderSeiten();
      setScanStatus(err.offline
        ? 'Keine Verbindung. Die Seiten bleiben erhalten – bitte später erneut auf „Hochladen“ tippen.'
        : err.message, true);
    }
  }

  function renderErgebnis() {
    const d = scan.ergebnis;
    const kurz = [d.kategorie, d.absender, typeof d.betrag === 'number' ? fmtEuro(d.betrag) : '',
      d.faellig_am ? `fällig ${fmtDatumKurz(d.faellig_am)}` : ''].filter(Boolean).join(' – ');
    $('#app').innerHTML = `
      <section class="result">
        <div class="result-icon" aria-hidden="true">✓</div>
        <h1>Hochgeladen</h1>
        <p class="result-summary">Erkannt als: <strong>${esc(kurz)}</strong></p>
        ${d.duplikatVon ? `<p class="notice notice-warn">Mögliches Duplikat von „${esc(d.duplikatVon.titel)}“ vom ${esc(fmtDatum(d.duplikatVon.erstellt_am))}. Das Dokument wurde trotzdem gespeichert.</p>` : ''}
        ${d.textErkannt === false ? '<p class="notice notice-warn">Auf dem Scan konnte kein Text erkannt werden. Bitte die Angaben prüfen.</p>' : ''}
        <div class="card result-card">
          <div class="card-main">
            <strong class="card-title">${esc(d.titel)}</strong>
            <span class="muted">${d.seiten ? `${d.seiten} ${d.seiten === 1 ? 'Seite' : 'Seiten'} · ` : ''}${esc(fmtDatum(d.erstellt_am))}</span>
          </div>
          <div class="card-side"><span class="badge">${esc(d.kategorie)}</span></div>
        </div>
        ${dokumentFakten(d)}
        ${isEditor() ? `
          <button type="button" class="btn btn-secondary btn-block" id="edit-btn">Angaben korrigieren</button>
          ${dokumentFormular(d)}` : ''}
        ${isEditor() && d.drive_url ? `<a href="${esc(d.drive_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-block">PDF in Drive öffnen</a>` : ''}
        <label class="btn btn-primary btn-block" for="cam-again">Weiteres Dokument scannen</label>
        <input type="file" id="cam-again" accept="image/*" capture="environment" hidden>
        <a href="#/" class="btn btn-ghost btn-block">Zur Startseite</a>
      </section>`;
    $('#cam-again').addEventListener('change', (ev) => {
      seitenHinzufuegen(ev.target.files);
      renderScan();
    });
    if (isEditor()) {
      bindeFormular(d, (aktualisiert) => {
        scan.ergebnis = { ...scan.ergebnis, ...aktualisiert, duplikatVon: d.duplikatVon, textErkannt: d.textErkannt,
          faelligGeschaetzt: d.faelligGeschaetzt && !('faellig_am' in aktualisiert._geaendert) };
        renderErgebnis();
        toast('Gespeichert.');
      });
    }
  }

  // -------------------------------------------------------------------------
  // Dokument-Angaben anzeigen und bearbeiten (auch für die Detailansicht in M4)
  // -------------------------------------------------------------------------
  const KATEGORIEN = ['Rechnung', 'Mahnung', 'Vertrag', 'Bescheid', 'Info', 'Sonstiges'];

  const fmtDatumKurz = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  };
  const fmtIban = (iban) => String(iban || '').replace(/(.{4})/g, '$1 ').trim();
  const alsDatumsfeld = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const alsBetragsfeld = (n) => (typeof n === 'number' ? n.toFixed(2).replace('.', ',') : '');

  function dokumentFakten(d) {
    const geschaetzt = d.faelligGeschaetzt || String(d.notiz || '').includes('Fälligkeit geschätzt');
    const zeilen = [
      ['Absender', esc(d.absender)],
      ['Betrag', typeof d.betrag === 'number' ? esc(fmtEuro(d.betrag)) : ''],
      ['Fällig am', d.faellig_am ? esc(fmtDatum(d.faellig_am)) + (geschaetzt ? ' <span class="muted">(geschätzt)</span>' : '') : ''],
      ['Rechnungsnr.', esc(d.rechnungsnr)],
      ['IBAN', esc(fmtIban(d.iban))],
      ['Status', esc(d.status)],
      ['Bezahlt', d.bezahlt_am ? esc(fmtDatum(d.bezahlt_am)) + (d.bezahlt_von ? ` von ${esc(d.bezahlt_von)}` : '') : ''],
      ['Notiz', esc(d.notiz)]
    ].filter(([, wert]) => wert);
    return zeilen.length
      ? `<dl class="facts">${zeilen.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
      : '';
  }

  function dokumentFormular(d) {
    return `
      <form class="edit-form" id="edit-form" hidden novalidate>
        <label class="field-label" for="f-kategorie">Kategorie</label>
        <select class="input" id="f-kategorie" name="kategorie">
          ${KATEGORIEN.map((k) => `<option ${k === d.kategorie ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <label class="field-label" for="f-titel">Titel</label>
        <input class="input" id="f-titel" name="titel" maxlength="100" value="${esc(d.titel)}">
        <label class="field-label" for="f-absender">Absender</label>
        <input class="input" id="f-absender" name="absender" maxlength="100" value="${esc(d.absender)}">
        <label class="field-label" for="f-betrag">Betrag (€)</label>
        <input class="input" id="f-betrag" name="betrag" inputmode="decimal" placeholder="z. B. 84,20" value="${esc(alsBetragsfeld(d.betrag))}">
        <label class="field-label" for="f-faellig">Fällig am</label>
        <input class="input" id="f-faellig" name="faellig_am" type="date" value="${esc(alsDatumsfeld(d.faellig_am))}">
        <label class="field-label" for="f-rnr">Rechnungsnummer</label>
        <input class="input" id="f-rnr" name="rechnungsnr" maxlength="100" value="${esc(d.rechnungsnr)}">
        <label class="field-label" for="f-iban">IBAN</label>
        <input class="input" id="f-iban" name="iban" autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc(fmtIban(d.iban))}">
        <p class="form-error" id="edit-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block" id="edit-save">Speichern</button>
        <button type="button" class="btn btn-ghost btn-block" id="edit-cancel">Abbrechen</button>
      </form>`;
  }

  /** Verdrahtet „Angaben korrigieren“; schickt nur geänderte Felder an die API. */
  function bindeFormular(d, onGespeichert) {
    const form = $('#edit-form');
    const btn = $('#edit-btn');
    const ausgangswerte = () => ({
      kategorie: d.kategorie || '',
      titel: d.titel || '',
      absender: d.absender || '',
      betrag: alsBetragsfeld(d.betrag),
      faellig_am: alsDatumsfeld(d.faellig_am),
      rechnungsnr: d.rechnungsnr || '',
      iban: fmtIban(d.iban)
    });
    btn.addEventListener('click', () => { form.hidden = false; btn.hidden = true; $('#f-kategorie').focus(); });
    $('#edit-cancel').addEventListener('click', () => { form.hidden = true; btn.hidden = false; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const vorher = ausgangswerte();
      const felder = {};
      Object.keys(vorher).forEach((k) => {
        const wert = form.elements[k].value.trim();
        if (wert !== vorher[k]) felder[k] = wert;
      });
      const fehler = $('#edit-error');
      fehler.hidden = true;
      if (!Object.keys(felder).length) { form.hidden = true; btn.hidden = false; return; }
      const speichern = $('#edit-save');
      speichern.disabled = true;
      speichern.textContent = 'Wird gespeichert …';
      try {
        const res = await Api.update(state.code, { id: d.id, felder });
        onGespeichert({ ...res.dokument, _geaendert: felder });
      } catch (err) {
        if (err.auth) return logout(err.message);
        fehler.textContent = err.offline ? 'Keine Verbindung. Bitte später erneut speichern.' : err.message;
        fehler.hidden = false;
        speichern.disabled = false;
        speichern.textContent = 'Speichern';
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ansicht: Tracking-Liste (Editor)
  // -------------------------------------------------------------------------
  const liste = {
    filter: { status: 'offen', kategorie: '', suche: '' },
    dokumente: [],
    gesamt: 0,
    cache: new Map(),   // id → Dokument (auch für die Detailansicht)
    entfernt: new Map() // id → frühere Position nach dem Abhaken
  };
  const ZAHLUNG = ['Rechnung', 'Mahnung'];
  const STATUS_FILTER = [['offen', 'Offen'], ['bezahlt', 'Bezahlt'], ['alle', 'Alle']];

  function heute0() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const istUeberfaellig = (d) => d.status === 'offen' && d.faellig_am && new Date(d.faellig_am) < heute0();

  function merkeDokumente(doks) {
    doks.forEach((d) => liste.cache.set(d.id, d));
  }

  function renderListe(token) {
    const f = liste.filter;
    $('#app').innerHTML = `
      <h1>Tracking-Liste</h1>
      <div class="chips" role="group" aria-label="Status">
        ${STATUS_FILTER.map(([wert, label]) => `
          <button type="button" class="chip ${f.status === wert ? 'chip-active' : ''}" data-status="${wert}" aria-pressed="${f.status === wert}">${label}</button>`).join('')}
        <select class="chip chip-select ${f.kategorie ? 'chip-active' : ''}" id="kat-filter" aria-label="Kategorie">
          <option value="">Kategorie</option>
          ${KATEGORIEN.map((k) => `<option ${k === f.kategorie ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
      </div>
      <input type="search" class="input search" id="suche" placeholder="Suchen: Absender, Titel, Rechnungsnr. …"
             value="${esc(f.suche)}" autocomplete="off" enterkeyhint="search">
      <p class="list-summary muted" id="list-summary"></p>
      <ul class="cards" id="doc-list"><li class="muted">Wird geladen …</li></ul>`;

    document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
      liste.filter.status = b.dataset.status;
      renderListe(state.renderToken);
    }));
    $('#kat-filter').addEventListener('change', (ev) => {
      liste.filter.kategorie = ev.target.value;
      renderListe(state.renderToken);
    });
    let suchTimer = null;
    $('#suche').addEventListener('input', (ev) => {
      clearTimeout(suchTimer);
      suchTimer = setTimeout(() => {
        liste.filter.suche = ev.target.value.trim();
        ladeListe(state.renderToken);
      }, 350);
    });

    const ul = $('#doc-list');
    ul.addEventListener('change', (ev) => {
      const box = ev.target.closest('[data-pay]');
      if (box) bezahltUmschalten(box.dataset.pay);
    });
    ul.addEventListener('click', (ev) => {
      if (ev.target.closest('.pay-check')) return;
      const karte = ev.target.closest('[data-open]');
      if (karte && !karte.dataset.swiped) location.hash = `#/dok/${karte.dataset.open}`;
    });
    wischenAktivieren(ul);
    ladeListe(token);
  }

  async function ladeListe(token) {
    try {
      const res = await Api.list(state.code, { ...liste.filter });
      if (veraltet(token)) return;
      liste.dokumente = res.dokumente || [];
      liste.gesamt = res.gesamt || liste.dokumente.length;
      liste.entfernt.clear();
      merkeDokumente(liste.dokumente);
      renderEintraege();
    } catch (err) {
      if (!veraltet(token)) handleApiError(err, $('#doc-list'));
    }
  }

  function renderEintraege() {
    const ul = $('#doc-list');
    if (!ul) return;
    const doks = liste.dokumente;
    const offen = doks.filter((d) => d.status === 'offen' && typeof d.betrag === 'number');
    const summe = offen.reduce((a, d) => a + d.betrag, 0);
    $('#list-summary').textContent = doks.length
      ? `${liste.gesamt} ${liste.gesamt === 1 ? 'Dokument' : 'Dokumente'}` +
        (offen.length ? ` · offen: ${fmtEuro(summe)}` : '') +
        (liste.gesamt > doks.length ? ` · die ersten ${doks.length} werden angezeigt` : '')
      : '';
    ul.innerHTML = doks.length
      ? doks.map(dokumentKarte).join('')
      : `<li class="empty">${liste.filter.suche || liste.filter.kategorie ? 'Keine Treffer.' : liste.filter.status === 'offen' ? 'Keine offenen Rechnungen. 🎉' : 'Keine Dokumente.'}</li>`;
  }

  function dokumentKarte(d) {
    const zahlung = ZAHLUNG.includes(d.kategorie);
    const ueber = istUeberfaellig(d);
    const unterzeile = [
      d.kategorie,
      d.faellig_am && d.status === 'offen' ? (ueber ? `überfällig seit ${fmtDatum(d.faellig_am)}` : `fällig ${fmtDatum(d.faellig_am)}`) : '',
      d.status === 'bezahlt' && d.bezahlt_am ? `bezahlt ${fmtDatum(d.bezahlt_am)}` : '',
      !zahlung ? fmtDatum(d.erstellt_am) : ''
    ].filter(Boolean).join(' · ');
    return `
      <li class="swipe" data-id="${esc(d.id)}">
        ${zahlung ? `<div class="swipe-bg" aria-hidden="true"><span>${d.status === 'bezahlt' ? '↺ Offen' : '✓ Bezahlt'}</span><span>${d.status === 'bezahlt' ? '↺ Offen' : '✓ Bezahlt'}</span></div>` : ''}
        <div class="card doc-card ${ueber ? 'card-overdue' : ''} ${d.status === 'bezahlt' ? 'card-done' : ''}" data-open="${esc(d.id)}" role="link" tabindex="0">
          ${zahlung ? `
            <label class="pay-check" aria-label="Als bezahlt markieren">
              <input type="checkbox" data-pay="${esc(d.id)}" ${d.status === 'bezahlt' ? 'checked' : ''}>
            </label>` : ''}
          <div class="card-main">
            <strong class="card-title">${esc(d.absender || d.titel)}</strong>
            <span class="muted card-sub">${esc(unterzeile)}</span>
          </div>
          <div class="card-side">
            ${typeof d.betrag === 'number' ? `<strong>${esc(fmtEuro(d.betrag))}</strong>` : ''}
            <span class="status status-${esc(d.status)}">${esc(d.status)}</span>
          </div>
        </div>
      </li>`;
  }

  /** Bezahlt ⇄ offen, sofort sichtbar; mit „Rückgängig“-Toast. */
  async function bezahltUmschalten(id, zielStatus) {
    const d = liste.cache.get(id);
    if (!d) return;
    const vorher = d.status;
    const neu = zielStatus || (vorher === 'bezahlt' ? 'offen' : 'bezahlt');
    if (neu === vorher) return;
    const anwenden = (status, felder = {}) => {
      Object.assign(d, { status, ...felder });
      const passt = liste.filter.status === 'alle' || liste.filter.status === status;
      const i = liste.dokumente.findIndex((x) => x.id === id);
      if (!passt && i >= 0) {
        liste.dokumente.splice(i, 1);
        liste.gesamt--;
        liste.entfernt.set(id, i);      // Position merken für „Rückgängig“
      }
      if (passt && i < 0 && liste.entfernt.has(id)) {
        liste.dokumente.splice(Math.min(liste.entfernt.get(id), liste.dokumente.length), 0, d);
        liste.gesamt++;
        liste.entfernt.delete(id);
      }
      renderEintraege();
    };

    anwenden(neu, neu === 'bezahlt' ? { bezahlt_am: new Date().toISOString(), bezahlt_von: state.nutzer.name } : { bezahlt_am: null, bezahlt_von: '' });
    try {
      const res = await Api.setStatus(state.code, { id, status: neu });
      Object.assign(d, res.dokument);
      if (location.hash === '#/liste') renderEintraege();
      toast(neu === 'bezahlt' ? 'Als bezahlt markiert.' : 'Wieder als offen markiert.', {
        label: 'Rückgängig',
        fn: () => bezahltUmschalten(id, vorher)
      });
    } catch (err) {
      anwenden(vorher);
      if (err.auth) return logout(err.message);
      toast(err.offline ? 'Keine Verbindung – Status nicht geändert.' : err.message);
    }
  }

  /** Karte nach links oder rechts wischen → bezahlt/offen umschalten. */
  function wischenAktivieren(ul) {
    let start = null;
    ul.addEventListener('touchstart', (ev) => {
      const karte = ev.target.closest('.doc-card');
      if (!karte || !karte.parentElement.querySelector('.swipe-bg') || ev.touches.length !== 1) return;
      start = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, karte, dx: 0, aktiv: false };
      delete karte.dataset.swiped;
    }, { passive: true });
    ul.addEventListener('touchmove', (ev) => {
      if (!start) return;
      const dx = ev.touches[0].clientX - start.x;
      const dy = ev.touches[0].clientY - start.y;
      if (!start.aktiv) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // Scrollen
        if (Math.abs(dx) < 10) return;
        start.aktiv = true;
        start.karte.classList.add('swiping');
      }
      start.dx = dx;
      start.karte.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    const ende = () => {
      if (!start) return;
      const { karte, dx, aktiv } = start;
      start = null;
      karte.classList.remove('swiping');
      karte.style.transform = '';
      if (!aktiv) return;
      karte.dataset.swiped = '1';                       // folgenden Klick nicht als „öffnen“ werten
      setTimeout(() => { delete karte.dataset.swiped; }, 400);
      if (Math.abs(dx) > 90) bezahltUmschalten(karte.dataset.open);
    };
    ul.addEventListener('touchend', ende);
    ul.addEventListener('touchcancel', ende);
  }

  // -------------------------------------------------------------------------
  // Ansicht: Detail (Editor)
  // -------------------------------------------------------------------------
  async function renderDetail(token, id) {
    let d = liste.cache.get(id);
    if (!d) {
      $('#app').innerHTML = '<p class="muted">Wird geladen …</p>';
      try {
        const res = await Api.list(state.code, { id });
        if (veraltet(token)) return;
        d = (res.dokumente || [])[0];
        if (!d) {
          $('#app').innerHTML = '<p class="notice notice-error">Dokument nicht gefunden (evtl. gelöscht).</p><a href="#/liste" class="btn btn-secondary btn-block">Zur Tracking-Liste</a>';
          return;
        }
        merkeDokumente([d]);
      } catch (err) {
        if (!veraltet(token)) handleApiError(err, $('#app'));
        return;
      }
    }
    zeigeDetail(d);
  }

  function zeigeDetail(d) {
    const zahlung = ZAHLUNG.includes(d.kategorie);
    const duplikat = /Mögliches Duplikat von ([\w-]+)/.exec(d.notiz || '');
    $('#app').innerHTML = `
      <a href="#/liste" class="back-link">‹ Tracking-Liste</a>
      <h1 class="detail-title">${esc(d.titel)}</h1>
      <p class="muted detail-meta"><span class="badge">${esc(d.kategorie)}</span>
        hochgeladen ${esc(fmtDatum(d.erstellt_am))}${d.hochgeladen_von ? ` von ${esc(d.hochgeladen_von)}` : ''}</p>
      ${istUeberfaellig(d) ? `<p class="notice notice-error">Überfällig seit ${esc(fmtDatum(d.faellig_am))}.</p>` : ''}
      ${duplikat ? `<p class="notice notice-warn">Mögliches Duplikat – <a href="#/dok/${esc(duplikat[1])}">anderes Dokument ansehen</a>.</p>` : ''}
      ${dokumentFakten(d)}
      ${zahlung ? `<button type="button" class="btn ${d.status === 'bezahlt' ? 'btn-secondary' : 'btn-primary'} btn-block" id="status-btn">
          ${d.status === 'bezahlt' ? 'Wieder als offen markieren' : '✓ Als bezahlt markieren'}</button>` : ''}
      <button type="button" class="btn btn-secondary btn-block" id="edit-btn">Angaben korrigieren</button>
      ${dokumentFormular(d)}
      ${d.drive_url ? `<a href="${esc(d.drive_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-block">PDF in Drive öffnen</a>` : ''}
      <button type="button" class="btn btn-danger btn-block" id="delete-btn">Löschen</button>`;

    if (zahlung) {
      $('#status-btn').addEventListener('click', async () => {
        await bezahltUmschalten(d.id);
        if (location.hash === `#/dok/${d.id}`) zeigeDetail(liste.cache.get(d.id));
      });
    }
    bindeFormular(d, (aktualisiert) => {
      const neu = { ...d, ...aktualisiert };
      delete neu._geaendert;
      liste.cache.set(d.id, neu);
      const i = liste.dokumente.findIndex((x) => x.id === d.id);
      if (i >= 0) liste.dokumente[i] = neu;
      zeigeDetail(neu);
      toast('Gespeichert.');
    });
    $('#delete-btn').addEventListener('click', async () => {
      if (!confirm(`„${d.titel}“ wirklich löschen?\n\nDie PDF bleibt im Google Drive erhalten.`)) return;
      const btn = $('#delete-btn');
      btn.disabled = true;
      try {
        await Api.delete(state.code, { id: d.id });
        liste.cache.delete(d.id);
        if (liste.dokumente.some((x) => x.id === d.id)) liste.gesamt--;
        liste.dokumente = liste.dokumente.filter((x) => x.id !== d.id);
        location.hash = '#/liste';
        toast('Gelöscht.');
      } catch (err) {
        btn.disabled = false;
        if (err.auth) return logout(err.message);
        toast(err.offline ? 'Keine Verbindung – nicht gelöscht.' : err.message);
      }
    });
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
