/**
 * DocScan – Dokumente: Upload und Drive-Ablage, Lesen für die Startseite.
 * Status ändern, Bearbeiten und Löschen folgen in Meilenstein 4.
 */

var TAGE_EIGENE_UPLOADS = 7;
var TAGE_NAECHSTE_FAELLIGKEITEN = 7;
var MAX_PDF_BYTES = 15 * 1024 * 1024;
var ZAHLUNGS_KATEGORIEN = ['Rechnung', 'Mahnung'];

/**
 * Nimmt ein PDF (Base64) entgegen, legt es unter DocScan/<Jahr>/<Kategorie>/ ab
 * und schreibt eine Zeile in „Dokumente“.
 */
function actionUpload_(nutzer, body) {
  var blob = pdfAusBase64_(body.pdfBase64);
  var jetzt = new Date();
  var titel = bereinigeText_(body.titelVorschlag, 100) ||
    'Scan ' + Utilities.formatDate(jetzt, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');

  var erkannt = erkenneDokument_(blob);

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
  return { dokument: toClient_(doc) };
}

/**
 * Erkennung von Kategorie und Feldern. Meilenstein 3 ersetzt das durch
 * OCR (Ocr.gs) und regelbasierte Klassifizierung (Classify.gs).
 */
function erkenneDokument_(blob) {
  return {
    kategorie: 'Sonstiges',
    absender: '',
    betrag: '',
    faellig_am: '',
    iban: '',
    rechnungsnr: '',
    ocr_text_kurz: '',
    fingerprint: ''
  };
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
  var datum = Utilities.formatDate(doc.erstellt_am, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var teile = [datum, bereinigeText_(doc.absender || doc.titel, 60).replace(/[\\/:*?"<>|]/g, '-') || 'Scan', doc.kategorie];
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

/** Alle nicht gelöschten Dokumente mit normalisierten Typen. */
function readDocuments_() {
  return readTable_(getSheet_('Dokumente'))
    .filter(function (d) { return d.id && !istWahr_(d.geloescht); })
    .map(function (d) {
      return {
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
        drive_url: String(d.drive_url || ''),
        notiz: String(d.notiz || '')
      };
    });
}

/** Datumswerte als ISO-String, damit JSON eindeutig ist. */
function toClient_(d) {
  var out = {};
  Object.keys(d).forEach(function (k) {
    out[k] = d[k] instanceof Date ? d[k].toISOString() : d[k];
  });
  return out;
}

function startOfDay_(datum) {
  return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate());
}
