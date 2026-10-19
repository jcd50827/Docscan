/**
 * DocScan – Regelbasierte Kategorisierung und Feldextraktion (keine KI-API).
 *
 * Jede Regel steckt in einer eigenen Funktion, damit sie einzeln testbar ist.
 * testClassify() im Script-Editor ausführen, um die Beispieltexte zu prüfen.
 */

var KATEGORIEN = ['Rechnung', 'Mahnung', 'Vertrag', 'Bescheid', 'Info', 'Sonstiges'];
var MIN_PUNKTE = 3;
var TAGE_ZAHLUNGSZIEL_STANDARD = 14;

var MONATE = {
  januar: 1, jan: 1, februar: 2, feb: 2, 'märz': 3, maerz: 3, mrz: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12
};

// Datum: 23.10.2026 | 23.10.26 | 23. Oktober 2026
var DATUM_MUSTER = '(\\d{1,2})\\.\\s?(?:(\\d{1,2})\\.\\s?(\\d{4}|\\d{2})(?!\\d)|([A-Za-zÄÖÜäöü]{3,9})\\.?\\s+(\\d{4}))';
// Betrag im deutschen Format: 1.234,56 | 84,20
var BETRAG_MUSTER = '-?\\d{1,3}(?:\\.\\d{3})+,\\d{2}(?!\\d)|-?\\d+,\\d{2}(?!\\d)';

/**
 * Wertet den OCR-Text aus. Liefert alle Felder für die Zeile in „Dokumente“.
 * @param {string} text   OCR-Text
 * @param {Array} regeln  [{kategorie, schluesselwort, gewicht}]
 */
function analysiereText_(text, regeln) {
  text = String(text || '');
  var klasse = klassifiziere_(text, regeln);
  var betrag = extrahiereBetrag_(text);
  var iban = extrahiereIban_(text);
  var rechnungsnr = extrahiereRechnungsnr_(text);
  var faellig = extrahiereFaelligkeit_(text);
  var geschaetzt = false;
  if (!faellig && (klasse.kategorie === 'Rechnung' || klasse.kategorie === 'Mahnung')) {
    var rechnungsdatum = extrahiereRechnungsdatum_(text);
    if (rechnungsdatum) {
      faellig = plusTage_(rechnungsdatum, TAGE_ZAHLUNGSZIEL_STANDARD);
      geschaetzt = true;
    }
  }
  return {
    kategorie: klasse.kategorie,
    punkte: klasse.punkte,
    absender: extrahiereAbsender_(text),
    betrag: betrag === null ? '' : betrag,
    faellig_am: faellig || '',
    faelligGeschaetzt: geschaetzt,
    iban: iban,
    rechnungsnr: rechnungsnr,
    ocr_text_kurz: text.replace(/\s+/g, ' ').trim().substring(0, 500),
    fingerprint: fingerprint_(text, iban, betrag, rechnungsnr)
  };
}

// ---------------------------------------------------------------------------
// Kategorisierung
// ---------------------------------------------------------------------------

/** Regeln aus dem Tab „Regeln“, bei Problemen die Standardregeln aus Setup.gs. */
function ladeRegeln_() {
  try {
    var regeln = readTable_(getSheet_('Regeln'))
      .map(function (r) {
        return {
          kategorie: String(r.kategorie || '').trim(),
          schluesselwort: String(r.schluesselwort || '').trim().toLowerCase(),
          gewicht: Number(r.gewicht) || 1
        };
      })
      .filter(function (r) { return r.schluesselwort && KATEGORIEN.indexOf(r.kategorie) >= 0; });
    if (regeln.length) return regeln;
  } catch (err) {
    console.error('Regeln konnten nicht gelesen werden: ' + err);
  }
  return standardRegeln_();
}

function standardRegeln_() {
  var regeln = [];
  Object.keys(STANDARD_REGELN).forEach(function (kategorie) {
    STANDARD_REGELN[kategorie].forEach(function (r) {
      regeln.push({ kategorie: kategorie, schluesselwort: r[0], gewicht: r[1] });
    });
  });
  return regeln;
}

/**
 * Punkte pro Kategorie: Jedes gefundene Schlüsselwort zählt einmal mit seinem Gewicht.
 * Gesucht wird am Wortanfang („kündigung“ trifft auch „Kündigungsfrist“,
 * „ust“ aber nicht „August“).
 */
function klassifiziere_(text, regeln) {
  var klein = String(text || '').toLowerCase();
  var punkte = {};
  KATEGORIEN.forEach(function (k) { punkte[k] = 0; });
  regeln.forEach(function (r) {
    var muster = new RegExp('(^|[^a-z0-9äöüß])' + regexEscape_(r.schluesselwort), 'i');
    if (muster.test(klein)) punkte[r.kategorie] += r.gewicht;
  });

  var beste = 'Sonstiges';
  KATEGORIEN.forEach(function (k) {
    if (k !== 'Sonstiges' && punkte[k] > (punkte[beste] || 0)) beste = k;
  });
  // Eine Mahnung enthält fast immer auch alle Rechnungs-Wörter. Sobald sie
  // als Mahnung erkennbar ist, gewinnt sie.
  if (beste === 'Rechnung' && punkte.Mahnung >= MIN_PUNKTE) beste = 'Mahnung';
  if (punkte[beste] < MIN_PUNKTE) beste = 'Sonstiges';
  return { kategorie: beste, punkte: punkte };
}

// ---------------------------------------------------------------------------
// Extraktion
// ---------------------------------------------------------------------------

/** Erste gültige IBAN (Prüfziffer mod 97), deutsche bevorzugt. Ohne Leerzeichen. */
function extrahiereIban_(text) {
  text = String(text || '');
  var kandidaten = [];
  var de = /DE\d{2}(?:\s?\d{4}){4}\s?\d{2}/g;
  var m;
  while ((m = de.exec(text))) kandidaten.push(m[0]);
  var generisch = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}/g;
  while ((m = generisch.exec(text))) kandidaten.push(m[0]);

  for (var i = 0; i < kandidaten.length; i++) {
    var roh = kandidaten[i].replace(/\s/g, '').toUpperCase();
    var laenge = IBAN_LAENGEN[roh.substring(0, 2)];
    if (!laenge || roh.length < laenge) continue;
    var iban = roh.substring(0, laenge);
    if (ibanGueltig_(iban)) return iban;
  }
  return '';
}

var IBAN_LAENGEN = {
  DE: 22, AT: 20, CH: 21, LI: 21, NL: 18, BE: 16, LU: 20, FR: 27, IT: 27, ES: 24,
  PL: 28, CZ: 24, DK: 18, SE: 24, NO: 15, FI: 18, IE: 22, GB: 22, PT: 25
};

function ibanGueltig_(iban) {
  iban = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (IBAN_LAENGEN[iban.substring(0, 2)] && IBAN_LAENGEN[iban.substring(0, 2)] !== iban.length) return false;
  var umgestellt = iban.substring(4) + iban.substring(0, 4);
  var rest = 0;
  for (var i = 0; i < umgestellt.length; i++) {
    var c = umgestellt.charAt(i);
    var ziffern = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (var j = 0; j < ziffern.length; j++) rest = (rest * 10 + Number(ziffern.charAt(j))) % 97;
  }
  return rest === 1;
}

/**
 * Betrag nahe „Gesamtbetrag|Rechnungsbetrag|zu zahlen|Summe|Endbetrag“
 * (gleiche oder nächste Zeile). Sonst der größte Betrag mit €/EUR. Sonst null.
 */
function extrahiereBetrag_(text) {
  var zeilen = String(text || '').split(/\r?\n/);
  var stark = /(gesamtbetrag|rechnungsbetrag|zu zahlen|zahlbetrag|endbetrag|gesamtsumme|offener betrag|forderungsbetrag)/i;
  var schwach = /summe/i;
  var treffer = { 2: null, 1: null };

  zeilen.forEach(function (zeile, i) {
    var stufe = stark.test(zeile) ? 2 : (schwach.test(zeile) && !/zwischensumme/i.test(zeile) ? 1 : 0);
    if (!stufe) return;
    var schluessel = (stufe === 2 ? stark : schwach).exec(zeile);
    var rest = zeile.substring(schluessel.index + schluessel[0].length);
    var betrag = ersterBetrag_(rest);
    if (betrag === null && i + 1 < zeilen.length) betrag = ersterBetrag_(zeilen[i + 1]);
    if (betrag !== null) treffer[stufe] = betrag; // letzter Treffer gewinnt
  });
  if (treffer[2] !== null) return treffer[2];
  if (treffer[1] !== null) return treffer[1];

  // Fallback: größter Betrag mit Währungsangabe
  var mitWaehrung = new RegExp('(?:(?:€|EUR)\\s*(' + BETRAG_MUSTER + '))|(?:(' + BETRAG_MUSTER + ')\\s*(?:€|EUR))', 'g');
  var max = null;
  var m;
  while ((m = mitWaehrung.exec(text))) {
    var wert = parseBetrag_(m[1] || m[2]);
    if (wert !== null && (max === null || wert > max)) max = wert;
  }
  return max;
}

function ersterBetrag_(s) {
  var m = new RegExp(BETRAG_MUSTER).exec(String(s || ''));
  return m ? parseBetrag_(m[0]) : null;
}

/** „1.234,56“ → 1234.56 */
function parseBetrag_(s) {
  var zahl = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.'));
  if (isNaN(zahl) || Math.abs(zahl) >= 1e7) return null;
  return Math.round(zahl * 100) / 100;
}

/** Datum nach „zahlbar bis|fällig am|bis zum …“ oder „innerhalb von N Tagen“. */
function extrahiereFaelligkeit_(text) {
  text = String(text || '');
  var stichwort = /(zahlbar\s+(?:bis|am)(?:\s+zum)?|f[äa]llig(?:keit(?:sdatum)?)?(?:\s+(?:am|zum|bis))?|bis\s+(?:zum|sp[äa]testens)|sp[äa]testens\s+(?:am|bis)(?:\s+zum)?|zahlungsziel)\s*:?/gi;
  var m;
  while ((m = stichwort.exec(text))) {
    var datum = erstesDatum_(text.substr(m.index + m[0].length, 40));
    if (datum) return datum;
  }
  var tage = /innerhalb\s+(?:von\s+)?(\d{1,3})\s+tagen/i.exec(text);
  if (tage) {
    var basis = extrahiereRechnungsdatum_(text);
    if (basis) return plusTage_(basis, Number(tage[1]));
  }
  return null;
}

/** Datum nach „Rechnungsdatum|Datum|vom“, sonst das erste Datum im Text. */
function extrahiereRechnungsdatum_(text) {
  text = String(text || '');
  var stichwort = /(rechnungsdatum|belegdatum|datum|rechnung\s+vom|vom)\s*:?/gi;
  var m;
  while ((m = stichwort.exec(text))) {
    var datum = erstesDatum_(text.substr(m.index + m[0].length, 30));
    if (datum) return datum;
  }
  return erstesDatum_(text);
}

/** Erstes plausibles Datum (Jahr 2000–2099) als Date um 0 Uhr, sonst null. */
function erstesDatum_(s) {
  var re = new RegExp(DATUM_MUSTER, 'g');
  var m;
  while ((m = re.exec(String(s || '')))) {
    var tag = Number(m[1]);
    var monat = m[2] ? Number(m[2]) : MONATE[String(m[4] || '').toLowerCase()];
    var jahr = Number(m[3] || m[5]);
    if (jahr < 100) jahr += 2000;
    if (!monat || monat > 12 || tag < 1 || tag > 31 || jahr < 2000 || jahr > 2099) continue;
    var datum = new Date(jahr, monat - 1, tag);
    if (datum.getMonth() === monat - 1) return datum; // 31.02. aussortieren
  }
  return null;
}

/** Text nach „Rechnungs-Nr.|Rechnungsnummer|Invoice“; muss eine Ziffer enthalten. */
function extrahiereRechnungsnr_(text) {
  var re = /(?:rechnungs?\s?-?\s?(?:nr|nummer|no)\.?|rechnung\s+nr\.?|invoice\s*(?:no\.?|number|nr\.?|#)?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,30})/gi;
  var m;
  while ((m = re.exec(String(text || '')))) {
    var nr = m[1].replace(/[.\-\/]+$/, '');
    if (/\d/.test(nr) && nr.length >= 3) return nr;
  }
  return '';
}

var FIRMEN_MERKMAL = /\b(gmbh|ag|kg|ohg|ug|mbh|gbr|se|kgaa|stadtwerke|versicherung|versicherungen|sparkasse|bank|volksbank|finanzamt|krankenkasse|aok|barmer|telekom|vodafone|stadt|gemeinde|landkreis|landratsamt|bürgeramt|rundfunk|beitragsservice)\b|e\.\s?v\./i;

/**
 * Erste Zeile mit Firmenmerkmal (GmbH, AG, e.V., Stadtwerke …) in den ersten
 * 25 Zeilen, sonst die erste nicht-leere Zeile. Absenderzeilen über dem
 * Adressfeld („Firma GmbH · Straße 1 · 12345 Ort“) werden auf den Firmenteil gekürzt.
 */
function extrahiereAbsender_(text) {
  var zeilen = String(text || '').split(/\r?\n/)
    .map(function (z) { return z.replace(/\s+/g, ' ').trim(); })
    .filter(function (z) { return z.length >= 2; });
  for (var i = 0; i < Math.min(zeilen.length, 25); i++) {
    if (!FIRMEN_MERKMAL.test(zeilen[i])) continue;
    var teile = zeilen[i].split(/\s+[·•|–-]\s+|,\s*/);
    for (var j = 0; j < teile.length; j++) {
      if (FIRMEN_MERKMAL.test(teile[j])) return absenderKuerzen_(teile[j]);
    }
  }
  return zeilen.length ? absenderKuerzen_(zeilen[0]) : '';
}

function absenderKuerzen_(s) {
  return s.trim().replace(/[,;:·•|–-]+$/, '').trim().substring(0, 60);
}

/**
 * Für die Duplikaterkennung: IBAN + Betrag + Rechnungsnummer, wenn eine
 * Rechnungsnummer und IBAN oder Betrag vorhanden sind; sonst Hash der
 * ersten 300 Zeichen des OCR-Texts.
 */
function fingerprint_(text, iban, betrag, rechnungsnr) {
  if (rechnungsnr && (iban || betrag !== null && betrag !== '')) {
    return 'r:' + [iban || '', betrag === null ? '' : Number(betrag).toFixed(2), rechnungsnr.toUpperCase()].join('|');
  }
  var normal = String(text || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  if (normal.length < 30) return '';
  return 't:' + sha256Hex_(normal.substring(0, 300)).substring(0, 32);
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function plusTage_(datum, tage) {
  return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate() + tage);
}

function regexEscape_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Test (im Script-Editor auswählen und „Ausführen“)
// ---------------------------------------------------------------------------

function testClassify() {
  var faelle = [
    {
      name: 'Rechnung Stadtwerke',
      text: 'Stadtwerke Musterstadt GmbH · Hauptstr. 1 · 12345 Musterstadt\nHerrn Max Muster\nRechnung\n' +
        'Rechnungsnummer: RE-2026-0815\nRechnungsdatum: 09.10.2026\nStrom Oktober\nNettobetrag 70,76 €\n' +
        'MwSt 19 % 13,44 €\nGesamtbetrag 84,20 €\nZahlbar bis 23.10.2026 auf IBAN DE89 3704 0044 0532 0130 00',
      erwartet: { kategorie: 'Rechnung', absender: 'Stadtwerke Musterstadt GmbH', betrag: 84.2, faellig: '23.10.2026', iban: 'DE89370400440532013000', rechnungsnr: 'RE-2026-0815' }
    },
    {
      name: 'Rechnung ohne Fälligkeit',
      text: 'Elektro Schmidt e.K.\nMalerbetrieb Klein GmbH & Co. KG\nRechnung Nr. 4711\nDatum: 01.10.2026\n' +
        'Zwischensumme 100,00 EUR\nSumme 119,00 EUR\nUSt-IdNr DE123456789',
      erwartet: { kategorie: 'Rechnung', absender: 'Malerbetrieb Klein GmbH & Co. KG', betrag: 119, faellig: '15.10.2026', geschaetzt: true, rechnungsnr: '4711' }
    },
    {
      name: 'Mahnung',
      text: 'Telekom Deutschland GmbH\n2. Mahnung\nZahlungserinnerung zu Rechnung Nr. 99887766\n' +
        'Rechnungsbetrag 39,95 €\nMahngebühr 5,00 €\nOffener Betrag 44,95 €\nBitte zahlen Sie bis zum 30. Oktober 2026.',
      erwartet: { kategorie: 'Mahnung', betrag: 44.95, faellig: '30.10.2026', rechnungsnr: '99887766' }
    },
    {
      name: 'Steuerbescheid',
      text: 'Finanzamt Musterstadt\nBescheid für 2025 über Einkommensteuer\nSteuernummer 12/345/67890\n' +
        'Aktenzeichen 123\nRechtsbehelfsbelehrung: Einspruch innerhalb eines Monats.',
      erwartet: { kategorie: 'Bescheid', absender: 'Finanzamt Musterstadt' }
    },
    {
      name: 'Vertrag',
      text: 'Fitnessstudio Muskel GmbH\nMitgliedsvertrag\nVertragsnummer 5566\nLaufzeit 12 Monate, Kündigung mit einer Frist von 3 Monaten.\nUnterschrift',
      erwartet: { kategorie: 'Vertrag' }
    },
    {
      name: 'Info',
      text: 'Gemeinde Beispielhausen\nMitteilung an alle Haushalte\nHinweis zur Müllabfuhr im August\nInformation: neue Abholtermine.',
      erwartet: { kategorie: 'Info' }
    },
    {
      name: 'Sonstiges',
      text: 'Liebe Oma,\nvielen Dank für das schöne Wochenende!\nDeine Lena',
      erwartet: { kategorie: 'Sonstiges', absender: 'Liebe Oma' }
    }
  ];

  var fehler = 0;
  var regeln = standardRegeln_();
  var fmt = function (d) { return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy') : ''; };
  faelle.forEach(function (f) {
    var e = analysiereText_(f.text, regeln);
    var ist = {
      kategorie: e.kategorie, absender: e.absender, betrag: e.betrag, faellig: fmt(e.faellig_am),
      geschaetzt: e.faelligGeschaetzt, iban: e.iban, rechnungsnr: e.rechnungsnr
    };
    var abweichungen = Object.keys(f.erwartet).filter(function (k) { return ist[k] !== f.erwartet[k]; });
    if (abweichungen.length) fehler++;
    Logger.log((abweichungen.length ? '✗ ' : '✓ ') + f.name + ': ' + JSON.stringify(ist) +
      (abweichungen.length ? '  ← erwartet ' + JSON.stringify(f.erwartet) : ''));
  });
  ['DE89370400440532013000', 'DE89370400440532013001', 'AT611904300234573201'].forEach(function (iban) {
    Logger.log('IBAN ' + iban + ' gültig: ' + ibanGueltig_(iban));
  });
  Logger.log(fehler ? fehler + ' Fall/Fälle mit Abweichungen.' : 'Alle Fälle korrekt erkannt.');
  return fehler;
}
