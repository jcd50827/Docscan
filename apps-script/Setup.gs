/**
 * DocScan – Einrichtung: Sheet-Tabs, Drive-Ordner, Menü, Nutzerverwaltung.
 *
 * Das Script ist an das Google Sheet gebunden (Erweiterungen → Apps Script).
 */

var SCHEMA = {
  Nutzer: ['name', 'code_hash', 'rolle', 'aktiv', 'erstellt_am', 'email'],
  Dokumente: [
    'id', 'erstellt_am', 'hochgeladen_von', 'kategorie', 'titel', 'absender',
    'betrag', 'faellig_am', 'iban', 'rechnungsnr', 'status', 'bezahlt_am',
    'bezahlt_von', 'drive_file_id', 'drive_url', 'ocr_text_kurz', 'fingerprint',
    'geloescht', 'notiz'
  ],
  Log: ['zeitstempel', 'name', 'aktion', 'dokument_id'],
  Regeln: ['kategorie', 'schluesselwort', 'gewicht']
};

var STANDARD_REGELN = {
  Rechnung: [['rechnung', 2], ['rechnungsnummer', 3], ['rechnungsbetrag', 3], ['zahlbar bis', 2],
             ['fällig', 1], ['zu zahlen', 2], ['ust', 1], ['mwst', 1], ['iban', 1]],
  Mahnung: [['mahnung', 3], ['zahlungserinnerung', 3], ['mahngebühr', 3], ['letzte erinnerung', 3]],
  Vertrag: [['vertrag', 2], ['vertragsnummer', 3], ['laufzeit', 2], ['kündigung', 2], ['unterschrift', 1]],
  Bescheid: [['bescheid', 2], ['finanzamt', 3], ['steuerbescheid', 3], ['aktenzeichen', 2], ['rechtsbehelf', 3]],
  Info: [['information', 1], ['mitteilung', 1], ['newsletter', 2], ['hinweis', 1]]
};

var ROOT_ORDNER_NAME = 'DocScan';

/** Legt Menü „DocScan“ im Sheet an. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('DocScan')
    .addItem('Nutzer anlegen', 'nutzerAnlegen')
    .addSeparator()
    .addItem('Einrichtung ausführen', 'setup')
    .addToUi();
}

/**
 * Einrichtung. Kann gefahrlos mehrfach ausgeführt werden: vorhandene Tabs,
 * Daten und Ordner bleiben erhalten, nur Fehlendes wird ergänzt.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('setup() muss aus dem an das Sheet gebundenen Script ausgeführt werden.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  Object.keys(SCHEMA).forEach(function (name) {
    ensureSheet_(ss, name, SCHEMA[name]);
  });
  formatSheets_(ss);
  removeDefaultSheet_(ss);

  var regelSheet = ss.getSheetByName('Regeln');
  if (regelSheet.getLastRow() < 2) {
    var zeilen = [];
    Object.keys(STANDARD_REGELN).forEach(function (kategorie) {
      STANDARD_REGELN[kategorie].forEach(function (r) { zeilen.push([kategorie, r[0], r[1]]); });
    });
    regelSheet.getRange(2, 1, zeilen.length, 3).setValues(zeilen);
  }

  var ordner = ensureRootFolder_();
  props.setProperty('ROOT_FOLDER_ID', ordner.getId());

  var meldung = 'DocScan ist eingerichtet.\n\nDrive-Ordner: ' + ordner.getUrl() +
    '\n\nNächste Schritte: als Web-App bereitstellen und über „DocScan → Nutzer anlegen“ Zugänge erzeugen.';
  zeigeMeldung_(meldung);
  return meldung;
}

function ensureSheet_(ss, name, spalten) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var letzteSpalte = sheet.getLastColumn();
  var vorhanden = letzteSpalte > 0
    ? sheet.getRange(1, 1, 1, letzteSpalte).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  var fehlend = spalten.filter(function (s) { return vorhanden.indexOf(s) < 0; });
  if (fehlend.length) {
    // Leere Kopfzellen am Ende ignorieren, fehlende Spalten hinten anhängen.
    while (vorhanden.length && !vorhanden[vorhanden.length - 1]) vorhanden.pop();
    sheet.getRange(1, vorhanden.length + 1, 1, fehlend.length).setValues([fehlend]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  return sheet;
}

function formatSheets_(ss) {
  var nutzer = ss.getSheetByName('Nutzer');
  spalteFormat_(nutzer, 'aktiv', function (r) { checkbox_(r); });
  spalteFormat_(nutzer, 'erstellt_am', function (r) { r.setNumberFormat('dd.MM.yyyy'); });

  var doks = ss.getSheetByName('Dokumente');
  spalteFormat_(doks, 'erstellt_am', function (r) { r.setNumberFormat('dd.MM.yyyy HH:mm'); });
  spalteFormat_(doks, 'faellig_am', function (r) { r.setNumberFormat('dd.MM.yyyy'); });
  spalteFormat_(doks, 'bezahlt_am', function (r) { r.setNumberFormat('dd.MM.yyyy'); });
  spalteFormat_(doks, 'betrag', function (r) { r.setNumberFormat('#,##0.00 €'); });
  spalteFormat_(doks, 'geloescht', function (r) { checkbox_(r); });

  spalteFormat_(ss.getSheetByName('Log'), 'zeitstempel', function (r) { r.setNumberFormat('dd.MM.yyyy HH:mm:ss'); });
}

/** Wendet fn auf die Datenzeilen (ab Zeile 2) der Spalte mit Kopf name an. */
function spalteFormat_(sheet, name, fn) {
  var kopf = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = kopf.indexOf(name);
  if (idx < 0) return;
  fn(sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1));
}

/**
 * Checkbox per Datenvalidierung statt insertCheckboxes(): Letzteres schreibt
 * FALSE in alle Zellen, wodurch appendRow() erst nach Zeile 1000 anhängen würde.
 */
function checkbox_(range) {
  range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
}

/** Entfernt das leere Standardblatt („Tabelle1“/„Sheet1“) eines neuen Sheets. */
function removeDefaultSheet_(ss) {
  ['Tabelle1', 'Sheet1'].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}

function ensureRootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  if (id) {
    try {
      var ordner = DriveApp.getFolderById(id);
      if (!ordner.isTrashed()) return ordner;
    } catch (err) {
      // Ordner gelöscht oder kein Zugriff → neu anlegen.
    }
  }
  var treffer = DriveApp.getRootFolder().getFoldersByName(ROOT_ORDNER_NAME);
  return treffer.hasNext() ? treffer.next() : DriveApp.getRootFolder().createFolder(ROOT_ORDNER_NAME);
}

function zeigeMeldung_(text) {
  try {
    SpreadsheetApp.getUi().alert(text);
  } catch (err) {
    // Aus dem Script-Editor gestartet: keine UI verfügbar.
    Logger.log(text);
  }
}

// ---------------------------------------------------------------------------
// Nutzerverwaltung (Menü „DocScan → Nutzer anlegen“)
// ---------------------------------------------------------------------------

function nutzerAnlegen() {
  var ui = SpreadsheetApp.getUi();

  var name = frage_(ui, 'Nutzer anlegen (1/3)', 'Anzeigename des neuen Nutzers:');
  if (name === null) return;
  name = name.trim();
  if (!name) { ui.alert('Der Name darf nicht leer sein.'); return; }

  var vorhanden = readTable_(getSheet_('Nutzer')).some(function (n) {
    return String(n.name).trim().toLowerCase() === name.toLowerCase();
  });
  if (vorhanden) { ui.alert('Es gibt bereits einen Nutzer mit dem Namen „' + name + '“.'); return; }

  var rolleEingabe = frage_(ui, 'Nutzer anlegen (2/3)',
    'Rolle eingeben:\n\n' +
    '  contributor – darf scannen und eigene Uploads sehen\n' +
    '  editor – darf zusätzlich alle Dokumente sehen und bearbeiten');
  if (rolleEingabe === null) return;
  var rolle = parseRolle_(rolleEingabe);
  if (!rolle) { ui.alert('Unbekannte Rolle „' + rolleEingabe + '“. Bitte „contributor“ oder „editor“ eingeben.'); return; }

  var email = frage_(ui, 'Nutzer anlegen (3/3)',
    'E-Mail-Adresse für Erinnerungen (optional, nur für Editoren genutzt). Leer lassen zum Überspringen:');
  if (email === null) return;
  email = email.trim();

  var code = generateCode_();
  mitLock_(function () {
    appendRow_(getSheet_('Nutzer'), {
      name: name,
      code_hash: sha256Hex_(code),
      rolle: rolle,
      aktiv: true,
      erstellt_am: new Date(),
      email: email
    });
    log_(Session.getEffectiveUser().getEmail() || 'Besitzer', 'nutzer_angelegt: ' + name + ' (' + rolle + ')', '');
  });

  ui.alert('Nutzer angelegt',
    'Zugangscode für ' + name + ' (' + rolle + '):\n\n' +
    '    ' + formatCode_(code) + '\n\n' +
    'Der Code wird nur jetzt angezeigt und nirgends gespeichert. ' +
    'Bitte notieren und sicher weitergeben.\n\n' +
    'Zum Sperren: in Tab „Nutzer“ das Häkchen bei „aktiv“ entfernen.',
    ui.ButtonSet.OK);
}

/** Liefert die Eingabe oder null bei Abbruch. */
function frage_(ui, titel, text) {
  var antwort = ui.prompt(titel, text, ui.ButtonSet.OK_CANCEL);
  return antwort.getSelectedButton() === ui.Button.OK ? antwort.getResponseText() : null;
}

function parseRolle_(eingabe) {
  var e = String(eingabe).trim().toLowerCase();
  if (e === 'editor' || e === 'e') return 'editor';
  if (e === 'contributor' || e === 'c') return 'contributor';
  return null;
}
