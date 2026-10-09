/**
 * DocScan – Zugangscodes, Rollen, Brute-Force-Schutz.
 *
 * Klartext-Codes werden nie gespeichert, nur ihr SHA-256-Hash (hex).
 */

var ROLLEN = ['contributor', 'editor'];

var CODE_LAENGE = 12;
// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L).
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

var MAX_FEHLVERSUCHE = 10;
var SPERRE_SEKUNDEN = 15 * 60;
var PRAEFIX_LAENGE = 3;

/**
 * Prüft den Zugangscode und liefert den Nutzer { name, rolle, email }.
 * Wirft einen Fehler mit deutscher Nachricht, wenn der Code ungültig ist.
 */
function authenticate_(code) {
  var normalisiert = normalizeCode_(code);
  if (!normalisiert) throw fehlerAuth_('Bitte einen Zugangscode eingeben.');

  var cache = CacheService.getScriptCache();
  var key = 'fehlversuche_' + normalisiert.substring(0, PRAEFIX_LAENGE);
  var anzahl = Number(cache.get(key)) || 0;
  if (anzahl >= MAX_FEHLVERSUCHE) {
    throw fehler_('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
  }

  var nutzer = findUserByHash_(sha256Hex_(normalisiert));
  if (!nutzer) {
    cache.put(key, String(anzahl + 1), SPERRE_SEKUNDEN);
    throw fehlerAuth_('Zugangscode ungültig.');
  }
  if (!nutzer.aktiv) throw fehlerAuth_('Dieser Zugang ist deaktiviert.');
  return nutzer;
}

function hatRolle_(nutzer, benoetigt) {
  return ROLLEN.indexOf(nutzer.rolle) >= ROLLEN.indexOf(benoetigt);
}

function findUserByHash_(hash) {
  var nutzer = readTable_(getSheet_('Nutzer'));
  for (var i = 0; i < nutzer.length; i++) {
    var n = nutzer[i];
    if (String(n.code_hash).trim().toLowerCase() === hash) {
      return {
        name: String(n.name).trim(),
        rolle: ROLLEN.indexOf(String(n.rolle).trim()) >= 0 ? String(n.rolle).trim() : 'contributor',
        aktiv: istWahr_(n.aktiv),
        email: String(n.email || '').trim()
      };
    }
  }
  return null;
}

/** Großbuchstaben, ohne Leerzeichen und Bindestriche (Anzeige erfolgt als XXXX-XXXX-XXXX). */
function normalizeCode_(code) {
  if (typeof code !== 'string') return '';
  return code.toUpperCase().replace(/[\s-]/g, '');
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

/**
 * Erzeugt einen zufälligen Code. Math.random() ist nicht kryptografisch sicher,
 * daher dienen zufällige UUIDs (SecureRandom) als Quelle.
 */
function generateCode_() {
  var code = '';
  while (code.length < CODE_LAENGE) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid(),
      Utilities.Charset.UTF_8
    );
    for (var i = 0; i < bytes.length && code.length < CODE_LAENGE; i++) {
      var v = (bytes[i] + 256) % 256;
      // Rejection Sampling, damit alle Zeichen gleich wahrscheinlich sind.
      var grenze = 256 - (256 % CODE_ALPHABET.length);
      if (v < grenze) code += CODE_ALPHABET.charAt(v % CODE_ALPHABET.length);
    }
  }
  return code;
}

function formatCode_(code) {
  return code.match(/.{1,4}/g).join('-');
}
