/**
 * DocScan – Dokumente: Upload mit OCR/Kategorisierung, Korrektur,
 * Tracking-Liste, Status, Löschen (Soft Delete), Übersicht.
 */

var TAGE_EIGENE_UPLOADS = 7;
var TAGE_NAECHSTE_FAELLIGKEITEN = 7;
var MAX_PDF_BYTES = 15 * 1024 * 1024;
var ZAHLUNGS_KATEGORIEN = ['Rechnung', 'Mahnung'];
var STATUS_WERTE = ['offen', 'bezahlt', 'erledigt'];
var MAX_LISTE = 300;
var NOTIZ_GESCHAETZT = 'Fälligkeit geschätzt (Rechnungsdatum + 14 Tage)';
var MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

/**
 * Upload: PDF prüfen → OCR → Kategorie und Felder erkennen → Duplikat prüfen →
 * als „YYYY-MM-DD_<Absender>_<Kategorie>[_<Betrag>€].pdf“ unter
 * DocScan/<Jahr>/<Kategorie>/ ablegen → Zeile in „Dokumente“.
 */
function actionUpload_(nutzer, body) {
  var blob = pdfAusBase64_(body.pdfBase64);
  var jetzt = new Date();

  // OCR dauert einige Sekunden und läuft deshalb außerhalb der Sperre.
  var erkannt = analysiereText_(ocrText_(blob), ladeRegeln_());
  var titel = bereinigeText_(body.titelVorschlag, 100) || standardTitel_(erkannt, jetzt);

  var doc = {
    id: Utilities.getUuid(),
    erstellt_am: jetzt,
    hochgeladen_von: nutzer.name,
    kategorie: erkannt.kategorie,
    titel: titel,
    absender: erkannt.absender,
    betrag: erkannt.betrag,
    faellig_am: erkannt.faellig_am,
    iban: erkannt.iban,
    rechnungsnr: erkannt.rechnungsnr,
    status: ZAHLUNGS_KATEGORIEN.indexOf(erkannt.kategorie) >= 0 ? 'offen' : 'erledigt',
    bezahlt_am: '',
    bezahlt_von: '',
    drive_file_id: '',
    drive_url: '',
    ocr_text_kurz: erkannt.ocr_text_kurz,
    fingerprint: erkannt.fingerprint,
    geloescht: false,
    notiz: ''
  };

  return mitLock_(function () {
    var duplikat = findeDuplikat_(doc.fingerprint);
    var notizen = [];
    if (duplikat) notizen.push('Mögliches Duplikat von ' + duplikat.id);
    if (erkannt.faelligGeschaetzt) notizen.push(NOTIZ_GESCHAETZT);
    doc.notiz = notizen.join(' · ');

    blob.setName(dateiname_(doc));
    var datei = getZielordner_(jetzt.getFullYear(), doc.kategorie).createFile(blob);
    doc.drive_file_id = datei.getId();
    doc.drive_url = datei.getUrl();

    try {
      appendRow_(getSheet_('Dokumente'), doc);
    } catch (err) {
      datei.setTrashed(true); // keine verwaiste PDF ohne Sheet-Eintrag
      throw err;
    }
    log_(nutzer.name, 'upload', doc.id);

    var antwort = toClient_(doc);
    antwort.faelligGeschaetzt = erkannt.faelligGeschaetzt;
    antwort.textErkannt = !!erkannt.ocr_text_kurz;
    antwort.duplikatVon = duplikat ? toClient_({
      id: duplikat.id, titel: duplikat.titel, erstellt_am: duplikat.erstellt_am
    }) : null;
    return { dokument: antwort };
  });
}

/**
 * Korrektur durch Editoren: { id, felder: { kategorie, titel, absender, betrag,
 * faellig_am (YYYY-MM-DD), iban, rechnungsnr, notiz } }. Benennt die PDF neu und
 * verschiebt sie bei geänderter Kategorie in den passenden Ordner.
 */
function actionUpdate_(nutzer, body) {
  var alt = findeDokument_(body.id);
  var f = body.felder || {};
  var neu = {};

  if (has_(f, 'kategorie')) {
    if (KATEGORIEN.indexOf(f.kategorie) < 0) throw fehler_('Unbekannte Kategorie.');
    neu.kategorie = f.kategorie;
  }
  ['titel', 'absender', 'rechnungsnr'].forEach(function (k) {
    if (has_(f, k)) neu[k] = bereinigeText_(String(f[k] == null ? '' : f[k]), 100);
  });
  if (has_(f, 'notiz')) neu.notiz = bereinigeText_(String(f.notiz == null ? '' : f.notiz), 500);
  if (has_(f, 'betrag')) neu.betrag = betragEingabe_(f.betrag);
  if (has_(f, 'faellig_am')) neu.faellig_am = datumEingabe_(f.faellig_am);
  if (has_(f, 'iban')) {
    neu.iban = String(f.iban || '').replace(/\s/g, '').toUpperCase();
    if (neu.iban && !ibanGueltig_(neu.iban)) throw fehler_('Die IBAN ist ungültig (Prüfziffer stimmt nicht).');
  }
  if (neu.titel === '') throw fehler_('Der Titel darf nicht leer sein.');

  // Status passend zur Kategorie: Rechnung/Mahnung → offen, sonst erledigt („bezahlt“ bleibt).
  if (neu.kategorie && neu.kategorie !== alt.kategorie && alt.status !== 'bezahlt') {
    neu.status = ZAHLUNGS_KATEGORIEN.indexOf(neu.kategorie) >= 0 ? 'offen' : 'erledigt';
  }
  // Wer die Fälligkeit selbst setzt, braucht den Hinweis „geschätzt“ nicht mehr.
  if (has_(neu, 'faellig_am') && !has_(f, 'notiz') && alt.notiz.indexOf(NOTIZ_GESCHAETZT) >= 0) {
    neu.notiz = alt.notiz.split(' · ').filter(function (n) { return n !== NOTIZ_GESCHAETZT; }).join(' · ');
  }

  schreibeFelder_(getSheet_('Dokumente'), alt._zeile, neu);
  var doc = Object.assign({}, alt, neu);

  if (doc.drive_file_id) {
    try {
      var datei = DriveApp.getFileById(doc.drive_file_id);
      datei.setName(dateiname_(doc));
      if (neu.kategorie && neu.kategorie !== alt.kategorie) {
        datei.moveTo(getZielordner_((doc.erstellt_am || new Date()).getFullYear(), doc.kategorie));
      }
    } catch (err) {
      console.error('PDF konnte nicht umbenannt/verschoben werden: ' + err);
    }
  }
  log_(nutzer.name, 'update', doc.id);
  return { dokument: toClient_(doc) };
}

/**
 * Tracking-Liste: { filter: { status: offen|bezahlt|erledigt|alle, kategorie, suche, id } }.
 * Offene zuerst nach Fälligkeit, danach die übrigen, neueste zuerst.
 */
function actionList_(nutzer, body) {
  var f = body.filter || {};
  var doks = readDocuments_();
  if (f.id) {
    doks = doks.filter(function (d) { return d.id === String(f.id); });
  } else {
    var status = f.status || 'alle';
    if (status !== 'alle') doks = doks.filter(function (d) { return d.status === status; });
    if (f.kategorie) doks = doks.filter(function (d) { return d.kategorie === f.kategorie; });
    var woerter = String(f.suche || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (woerter.length) {
      doks = doks.filter(function (d) {
        var heuhaufen = [d.titel, d.absender, d.kategorie, d.rechnungsnr, d.iban, d.notiz,
          d.hochgeladen_von, d.ocr_text_kurz, typeof d.betrag === 'number' ? d.betrag.toFixed(2).replace('.', ',') : '']
          .join(' ').toLowerCase();
        return woerter.every(function (w) { return heuhaufen.indexOf(w) >= 0; });
      });
    }
  }
  doks.sort(listenSortierung_);
  return { dokumente: doks.slice(0, MAX_LISTE).map(toClient_), gesamt: doks.length };
}

function listenSortierung_(a, b) {
  var ao = a.status === 'offen' ? 0 : 1;
  var bo = b.status === 'offen' ? 0 : 1;
  if (ao !== bo) return ao - bo;
  if (ao === 0) {
    var af = a.faellig_am ? a.faellig_am.getTime() : Infinity;
    var bf = b.faellig_am ? b.faellig_am.getTime() : Infinity;
    if (af !== bf) return af - bf;
  }
  return (b.erstellt_am ? b.erstellt_am.getTime() : 0) - (a.erstellt_am ? a.erstellt_am.getTime() : 0);
}

/** { id, status }: bezahlt setzt bezahlt_am/bezahlt_von, alles andere leert sie. */
function actionSetStatus_(nutzer, body) {
  if (STATUS_WERTE.indexOf(body.status) < 0) throw fehler_('Unbekannter Status.');
  var alt = findeDokument_(body.id);
  var neu = {
    status: body.status,
    bezahlt_am: body.status === 'bezahlt' ? new Date() : '',
    bezahlt_von: body.status === 'bezahlt' ? nutzer.name : ''
  };
  schreibeFelder_(getSheet_('Dokumente'), alt._zeile, neu);
  log_(nutzer.name, 'status_' + body.status, alt.id);
  return { dokument: toClient_(Object.assign({}, alt, neu)) };
}

/** Soft Delete: Die Zeile bleibt mit geloescht = TRUE, die PDF bleibt im Drive. */
function actionDelete_(nutzer, body) {
  var alt = findeDokument_(body.id);
  schreibeFelder_(getSheet_('Dokumente'), alt._zeile, { geloescht: true });
  log_(nutzer.name, 'delete', alt.id);
  return { id: alt.id };
}

/** Neuester nicht gelöschter Eintrag mit gleichem Fingerprint, sonst null. */
function findeDuplikat_(fingerprint) {
  if (!fingerprint) return null;
  var treffer = readDocuments_().filter(function (d) { return d.fingerprint === fingerprint; });
  return treffer.length ? treffer[treffer.length - 1] : null;
}

function findeDokument_(id) {
  if (!id) throw fehler_('Es wurde kein Dokument angegeben.');
  var treffer = readDocuments_().filter(function (d) { return d.id === String(id); });
  if (!treffer.length) throw fehler_('Das Dokument wurde nicht gefunden.');
  return treffer[0];
}

/** Schreibt einzelne Felder in eine Zeile (Spalten über die Kopfzeile). */
function schreibeFelder_(sheet, zeile, felder) {
  var kopf = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  Object.keys(felder).forEach(function (k) {
    var spalte = kopf.indexOf(k);
    if (spalte >= 0) sheet.getRange(zeile, spalte + 1).setValue(alsZellwert_(felder[k] === null ? '' : felder[k]));
  });
}

/** „Absender – Kategorie Monat Jahr“, ohne Absender „Scan TT.MM.JJJJ HH:mm“. */
function standardTitel_(erkannt, datum) {
  if (erkannt.absender && erkannt.kategorie !== 'Sonstiges') {
    return bereinigeText_(erkannt.absender + ' – ' + erkannt.kategorie + ' ' +
      MONATSNAMEN[datum.getMonth()] + ' ' + datum.getFullYear(), 100);
  }
  return 'Scan ' + Utilities.formatDate(datum, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}

/** „84,20“ / „1.234,56“ / „84.20“ / 84.2 → Zahl; leer → ''. */
function betragEingabe_(wert) {
  if (wert === null || wert === undefined || String(wert).trim() === '') return '';
  if (typeof wert === 'number' && isFinite(wert)) return Math.round(wert * 100) / 100;
  var s = String(wert).replace(/[€\s]/g, '');
  var zahl = s.indexOf(',') >= 0 ? parseBetrag_(s) : parseFloat(s);
  if (zahl === null || isNaN(zahl)) throw fehler_('Der Betrag ist ungültig.');
  return Math.round(zahl * 100) / 100;
}

/** „YYYY-MM-DD“ → Date um 0 Uhr; leer → ''. */
function datumEingabe_(wert) {
  if (wert === null || wert === undefined || String(wert).trim() === '') return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(wert));
  if (!m) throw fehler_('Das Datum ist ungültig.');
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) throw fehler_('Das Datum ist ungültig.');
  return d;
}

function has_(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function pdfAusBase64_(base64) {
  if (typeof base64 !== 'string' || !base64) throw fehler_('Es wurde keine PDF-Datei übertragen.');
  base64 = base64.replace(/^data:[^,]*,/, '');
  if (base64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4) {
    throw fehler_('Die Datei ist zu groß (max. 15 MB). Bitte weniger Seiten auf einmal scannen.');
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    throw fehler_('Die PDF-Datei ist beschädigt.');
  }
  // Jede PDF beginnt mit „%PDF“.
  if (bytes.length < 4 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) {
    throw fehler_('Die übertragene Datei ist kein PDF.');
  }
  return Utilities.newBlob(bytes, MimeType.PDF, 'scan.pdf');
}

/** YYYY-MM-DD_<Absender>_<Kategorie>[_<Betrag>€].pdf – ohne Absender wird der Titel genommen. */
function dateiname_(doc) {
  var datum = Utilities.formatDate(doc.erstellt_am || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var name = bereinigeText_(doc.absender || doc.titel, 60).replace(/[\\/:*?"<>|]/g, '-') || 'Scan';
  var teile = [datum, name, doc.kategorie];
  if (typeof doc.betrag === 'number') teile.push(doc.betrag.toFixed(2).replace('.', ',') + '€');
  return teile.join('_') + '.pdf';
}

/** DocScan/<Jahr>/<Kategorie>/, fehlende Ordner werden angelegt. */
function getZielordner_(jahr, kategorie) {
  var id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  var root;
  try {
    root = id ? DriveApp.getFolderById(id) : null;
  } catch (err) {
    root = null;
  }
  if (!root || root.isTrashed()) throw fehler_('Der Drive-Ordner „DocScan“ fehlt. Bitte setup() erneut ausführen.');
  return unterordner_(unterordner_(root, String(jahr)), kategorie);
}

function unterordner_(eltern, name) {
  var treffer = eltern.getFoldersByName(name);
  return treffer.hasNext() ? treffer.next() : eltern.createFolder(name);
}

/** Einzeilig, ohne Steuerzeichen, gekürzt. */
function bereinigeText_(text, maxLaenge) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, maxLaenge);
}

/** Eigene Uploads der letzten 7 Tage, neueste zuerst. */
function actionListMine_(nutzer) {
  var grenze = new Date(Date.now() - TAGE_EIGENE_UPLOADS * 24 * 3600 * 1000);
  var doks = readDocuments_().filter(function (d) {
    return d.hochgeladen_von === nutzer.name && d.erstellt_am && d.erstellt_am >= grenze;
  });
  doks.sort(function (a, b) { return b.erstellt_am - a.erstellt_am; });
  return { dokumente: doks.map(toClient_) };
}

/** Übersicht für Editoren: Summe offen, Anzahl überfällig, nächste Fälligkeiten. */
function actionStats_() {
  var heute = startOfDay_(new Date());
  var bis = new Date(heute.getTime() + (TAGE_NAECHSTE_FAELLIGKEITEN + 1) * 24 * 3600 * 1000);

  var offen = readDocuments_().filter(function (d) {
    return d.status === 'offen' && (d.kategorie === 'Rechnung' || d.kategorie === 'Mahnung');
  });

  var summeOffen = 0;
  var ueberfaellig = 0;
  var naechste = [];
  offen.forEach(function (d) {
    summeOffen += d.betrag || 0;
    if (d.faellig_am && d.faellig_am < heute) ueberfaellig++;
    else if (d.faellig_am && d.faellig_am < bis) naechste.push(d);
  });
  naechste.sort(function (a, b) { return a.faellig_am - b.faellig_am; });

  return {
    summeOffen: Math.round(summeOffen * 100) / 100,
    anzahlOffen: offen.length,
    anzahlUeberfaellig: ueberfaellig,
    naechsteFaelligkeiten: naechste.map(toClient_)
  };
}

/** Alle nicht gelöschten Dokumente mit normalisierten Typen (_zeile = Zeilennummer im Sheet). */
function readDocuments_() {
  return readTable_(getSheet_('Dokumente'))
    .filter(function (d) { return d.id && !istWahr_(d.geloescht); })
    .map(function (d) {
      return {
        _zeile: d._zeile,
        id: String(d.id),
        erstellt_am: d.erstellt_am instanceof Date ? d.erstellt_am : null,
        hochgeladen_von: String(d.hochgeladen_von || ''),
        kategorie: String(d.kategorie || ''),
        titel: String(d.titel || ''),
        absender: String(d.absender || ''),
        betrag: typeof d.betrag === 'number' ? d.betrag : (parseFloat(d.betrag) || null),
        faellig_am: d.faellig_am instanceof Date ? d.faellig_am : null,
        iban: String(d.iban || ''),
        rechnungsnr: String(d.rechnungsnr || ''),
        status: String(d.status || ''),
        bezahlt_am: d.bezahlt_am instanceof Date ? d.bezahlt_am : null,
        bezahlt_von: String(d.bezahlt_von || ''),
        drive_file_id: String(d.drive_file_id || ''),
        drive_url: String(d.drive_url || ''),
        fingerprint: String(d.fingerprint || ''),
        ocr_text_kurz: String(d.ocr_text_kurz || ''),
        notiz: String(d.notiz || '')
      };
    });
}

/** Für die App: Datumswerte als ISO-String, interne Felder weglassen. */
function toClient_(d) {
  var out = {};
  Object.keys(d).forEach(function (k) {
    if (k.charAt(0) === '_' || k === 'fingerprint' || k === 'ocr_text_kurz' || k === 'geloescht') return;
    out[k] = d[k] instanceof Date ? d[k].toISOString() : d[k];
  });
  return out;
}

function startOfDay_(datum) {
  return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate());
}
