/**
 * DocScan – Einstiegspunkt der Web-App (doGet/doPost) und Routing.
 *
 * Alle Requests kommen als POST mit Content-Type text/plain und JSON-Body:
 *   { action, code, ...payload }
 * Antwort: { ok: true, ... } oder { ok: false, error: "Nachricht" }.
 */

/**
 * Routing-Tabelle. Bewusst als Funktion und nicht als globale Variable:
 * Apps Script lädt die .gs-Dateien nacheinander, Funktionen aus späteren
 * Dateien sind beim Laden dieser Datei evtl. noch nicht definiert.
 *
 * rolle:       null = alle angemeldeten Nutzer, sonst Mindestrolle
 * schreibend:  true = läuft unter LockService und wird geloggt
 */
function getActions_() {
  return {
    login:    { rolle: null,     schreibend: false, fn: actionLogin_ },
    listMine: { rolle: null,     schreibend: false, fn: actionListMine_ },
    stats:    { rolle: 'editor', schreibend: false, fn: actionStats_ }
  };
}

function doPost(e) {
  var antwort;
  try {
    var body = parseBody_(e);
    var def = getActions_()[body.action];
    if (!def) throw fehler_('Unbekannte Aktion: ' + body.action);

    // Rechte werden ausschließlich hier geprüft.
    var nutzer = authenticate_(body.code);
    if (def.rolle && !hatRolle_(nutzer, def.rolle)) {
      throw fehler_('Für diese Aktion fehlt die Berechtigung.');
    }

    var ergebnis = def.schreibend
      ? mitLock_(function () { return def.fn(nutzer, body); })
      : def.fn(nutzer, body);

    antwort = Object.assign({ ok: true }, ergebnis || {});
  } catch (err) {
    if (!err || !err.userMessage) console.error(err && err.stack ? err.stack : err);
    antwort = {
      ok: false,
      error: err && err.userMessage ? err.userMessage : 'Interner Fehler. Bitte später erneut versuchen.'
    };
    // Kennzeichnet ungültige/deaktivierte Codes, damit die App abmelden kann.
    if (err && err.auth) antwort.auth = true;
  }
  return json_(antwort);
}

/** GET liefert nur einen Lebenszeichen-Check (z. B. zum Testen der URL im Browser). */
function doGet() {
  return json_({ ok: true, app: 'DocScan', hinweis: 'Die API erwartet POST-Requests.' });
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

function actionLogin_(nutzer) {
  return { name: nutzer.name, rolle: nutzer.rolle };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Fehler, deren Nachricht an den Client gehen darf. */
function fehler_(nachricht) {
  var err = new Error(nachricht);
  err.userMessage = nachricht;
  return err;
}

/** Fehler, bei dem der Zugangscode selbst nicht (mehr) gültig ist. */
function fehlerAuth_(nachricht) {
  var err = fehler_(nachricht);
  err.auth = true;
  return err;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) throw fehler_('Leere Anfrage.');
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    throw fehler_('Ungültiges Anfrageformat.');
  }
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
    throw fehler_('Ungültiges Anfrageformat.');
  }
  return body;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function mitLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw fehler_('Server ist gerade beschäftigt. Bitte erneut versuchen.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw fehler_('DocScan ist noch nicht eingerichtet (setup() ausführen).');
  return ss;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw fehler_('Tabellenblatt „' + name + '“ fehlt. Bitte setup() ausführen.');
  return sheet;
}

/**
 * Liest ein Tabellenblatt als Liste von Objekten (Schlüssel = Kopfzeile).
 * Jedes Objekt bekommt zusätzlich _zeile (1-basierte Zeilennummer im Sheet).
 */
function readTable_(sheet) {
  var werte = sheet.getDataRange().getValues();
  if (werte.length < 2) return [];
  var kopf = werte[0].map(function (h) { return String(h).trim(); });
  var zeilen = [];
  for (var i = 1; i < werte.length; i++) {
    var obj = { _zeile: i + 1 };
    for (var j = 0; j < kopf.length; j++) {
      if (kopf[j]) obj[kopf[j]] = werte[i][j];
    }
    zeilen.push(obj);
  }
  return zeilen;
}

/** Hängt eine Zeile an; obj wird anhand der Kopfzeile auf die Spalten verteilt. */
function appendRow_(sheet, obj) {
  var kopf = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var zeile = kopf.map(function (h) {
    var key = String(h).trim();
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : '';
  });
  sheet.appendRow(zeile);
}

/** Schreibt einen Eintrag in den Tab „Log“. */
function log_(name, aktion, dokumentId) {
  appendRow_(getSheet_('Log'), {
    zeitstempel: new Date(),
    name: name || '',
    aktion: aktion,
    dokument_id: dokumentId || ''
  });
}

function istWahr_(wert) {
  return wert === true || String(wert).trim().toUpperCase() === 'TRUE';
}
