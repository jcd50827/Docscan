/**
 * DocScan – Tägliche Mail-Erinnerung (Zeit-Trigger um 8 Uhr, von setup() angelegt).
 *
 * Empfänger: der Besitzer und alle aktiven Editoren mit E-Mail im Tab „Nutzer“.
 * Inhalt: überfällige Rechnungen/Mahnungen und solche, die in den nächsten
 * 3 Tagen fällig sind. Steht nichts an, wird keine Mail verschickt.
 */

var ERINNERUNG_STUNDE = 8;
var ERINNERUNG_TAGE = 3;
var ERINNERUNG_FUNKTION = 'taeglicheErinnerung';

/** Wird vom Trigger aufgerufen. Liefert eine kurze Statusmeldung (für testErinnerung). */
function taeglicheErinnerung() {
  var heute = startOfDay_(new Date());
  var grenze = plusTage_(heute, ERINNERUNG_TAGE + 1);
  var offen = readDocuments_().filter(function (d) {
    return d.status === 'offen' && ZAHLUNGS_KATEGORIEN.indexOf(d.kategorie) >= 0 && d.faellig_am;
  });
  var nachDatum = function (a, b) { return a.faellig_am - b.faellig_am; };
  var ueberfaellig = offen.filter(function (d) { return d.faellig_am < heute; }).sort(nachDatum);
  var bald = offen.filter(function (d) { return d.faellig_am >= heute && d.faellig_am < grenze; }).sort(nachDatum);

  if (!ueberfaellig.length && !bald.length) return 'Nichts fällig – keine Mail verschickt.';

  var empfaenger = erinnerungsEmpfaenger_();
  if (!empfaenger.length) return 'Keine Empfänger-Adresse gefunden.';

  var teile = [];
  if (ueberfaellig.length) teile.push(ueberfaellig.length + ' überfällig');
  if (bald.length) teile.push(bald.length + ' bald fällig');
  var betreff = 'DocScan: ' + teile.join(', ');

  MailApp.sendEmail({
    to: empfaenger.join(','),
    subject: betreff,
    name: 'DocScan',
    body: erinnerungText_(ueberfaellig, bald),
    htmlBody: erinnerungHtml_(ueberfaellig, bald)
  });
  log_('System', 'erinnerung_gesendet (' + empfaenger.length + ' Empfänger)', '');
  return betreff + ' → ' + empfaenger.join(', ');
}

/** Besitzer + aktive Editoren mit E-Mail, ohne Doppelte. */
function erinnerungsEmpfaenger_() {
  var adressen = [];
  var besitzer = Session.getEffectiveUser().getEmail();
  if (besitzer) adressen.push(besitzer.toLowerCase());
  readTable_(getSheet_('Nutzer')).forEach(function (n) {
    var mail = String(n.email || '').trim().toLowerCase();
    if (mail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) && String(n.rolle).trim() === 'editor' &&
        istWahr_(n.aktiv) && adressen.indexOf(mail) < 0) {
      adressen.push(mail);
    }
  });
  return adressen;
}

function erinnerungZeile_(d) {
  return {
    name: d.absender || d.titel,
    betrag: typeof d.betrag === 'number' ? d.betrag.toFixed(2).replace('.', ',') + ' €' : '–',
    datum: Utilities.formatDate(d.faellig_am, Session.getScriptTimeZone(), 'dd.MM.yyyy'),
    url: d.drive_url
  };
}

function erinnerungText_(ueberfaellig, bald) {
  var block = function (titel, liste) {
    if (!liste.length) return '';
    return titel + ':\n' + liste.map(function (d) {
      var z = erinnerungZeile_(d);
      return '- ' + z.name + ': ' + z.betrag + ', fällig ' + z.datum;
    }).join('\n') + '\n\n';
  };
  return block('Überfällig', ueberfaellig) + block('In den nächsten ' + ERINNERUNG_TAGE + ' Tagen fällig', bald) +
    'Nach dem Bezahlen in der DocScan-App abhaken.';
}

function erinnerungHtml_(ueberfaellig, bald) {
  var block = function (titel, farbe, liste) {
    if (!liste.length) return '';
    return '<h3 style="color:' + farbe + ';margin:20px 0 8px">' + html_(titel) + '</h3>' +
      '<table style="border-collapse:collapse;width:100%;max-width:560px">' +
      liste.map(function (d) {
        var z = erinnerungZeile_(d);
        var name = z.url ? '<a href="' + html_(z.url) + '">' + html_(z.name) + '</a>' : html_(z.name);
        return '<tr><td style="padding:6px 8px;border-bottom:1px solid #ddd">' + name + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap"><b>' + html_(z.betrag) + '</b></td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid #ddd;white-space:nowrap">fällig ' + html_(z.datum) + '</td></tr>';
      }).join('') + '</table>';
  };
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px">' +
    block('Überfällig', '#c62828', ueberfaellig) +
    block('In den nächsten ' + ERINNERUNG_TAGE + ' Tagen fällig', '#1f5fbf', bald) +
    '<p style="color:#666;margin-top:20px">Nach dem Bezahlen in der DocScan-App abhaken.</p></div>';
}

function html_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Legt den täglichen Trigger (neu) an; vorhandene DocScan-Erinnerungstrigger werden ersetzt. */
function richteErinnerungEin_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === ERINNERUNG_FUNKTION) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(ERINNERUNG_FUNKTION)
    .timeBased()
    .everyDays(1)
    .atHour(ERINNERUNG_STUNDE)
    .inTimezone(Session.getScriptTimeZone())
    .create();
}

/** Manueller Test im Script-Editor oder über das Menü: verschickt die Mail sofort (falls etwas ansteht). */
function testErinnerung() {
  var ergebnis = taeglicheErinnerung();
  zeigeMeldung_('Erinnerung: ' + ergebnis);
  return ergebnis;
}
