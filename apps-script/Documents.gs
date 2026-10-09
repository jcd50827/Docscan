/**
 * DocScan – Dokumente lesen (Meilenstein 1: nur lesende Aktionen für die Startseite).
 * Upload, Status, Bearbeiten und Löschen folgen in Meilenstein 2 bzw. 4.
 */

var TAGE_EIGENE_UPLOADS = 7;
var TAGE_NAECHSTE_FAELLIGKEITEN = 7;

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
