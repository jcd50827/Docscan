/**
 * DocScan – Push-Benachrichtigungen (Web Push mit VAPID) an Editoren.
 *
 * Ablauf: Die App meldet ein Gerät an (pushSubscribe) → Tab „Geraete“.
 * Nach einem Upload schickt sendePushAnEditoren_() an alle Geräte der Editoren
 * (außer dem Hochladenden) einen Push OHNE Inhalt. Der Service Worker der App
 * holt dann selbst die Zahl neuer Dokumente (stats) und zeigt Banner + Zahl am Symbol.
 * Ohne Inhalt muss nichts verschlüsselt werden; nötig ist nur die VAPID-Signatur
 * (ES256 = ECDSA auf der Kurve P-256), die hier in reinem JavaScript (BigInt) steckt,
 * weil Apps Script sie nicht mitbringt.
 */

var GERAETE_SPALTEN = ['name', 'endpoint', 'erstellt_am', 'geraet', 'aktiv'];
// Nur bekannte Push-Dienste anschreiben (kein Versand an beliebige URLs).
var PUSH_DIENSTE = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//i;

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

/** Öffentlicher VAPID-Schlüssel für pushManager.subscribe(). */
function actionPushKey_() {
  return { schluessel: vapidSchluessel_().oeffentlich };
}

/** { subscription: {endpoint, ...}, appUrl } – Gerät eines Editors anmelden. */
function actionPushSubscribe_(nutzer, body) {
  var sub = body.subscription || {};
  var endpoint = String(sub.endpoint || '');
  if (!PUSH_DIENSTE.test(endpoint)) throw fehler_('Dieses Gerät meldet einen unbekannten Push-Dienst.');
  if (body.appUrl && /^https:\/\//.test(body.appUrl)) {
    PropertiesService.getScriptProperties().setProperty('APP_URL', String(body.appUrl).substring(0, 200));
  }
  var sheet = geraeteSheet_();
  var vorhanden = readTable_(sheet).filter(function (g) { return g.endpoint === endpoint; })[0];
  if (vorhanden) {
    schreibeFelder_(sheet, vorhanden._zeile, { name: nutzer.name, aktiv: true });
  } else {
    appendRow_(sheet, {
      name: nutzer.name,
      endpoint: endpoint,
      erstellt_am: new Date(),
      geraet: bereinigeText_(String(body.geraet || ''), 80),
      aktiv: true
    });
  }
  log_(nutzer.name, 'push_angemeldet', '');
  return { angemeldet: true };
}

/** { endpoint } – Gerät abmelden. */
function actionPushUnsubscribe_(nutzer, body) {
  entferneGeraet_(String(body.endpoint || ''));
  return { abgemeldet: true };
}

/** Test-Benachrichtigung an die eigenen Geräte. */
function actionPushTest_(nutzer) {
  var ergebnis = sendePush_(geraeteVon_(function (name) { return name === nutzer.name; }));
  if (!ergebnis.geraete) throw fehler_('Für dich ist noch kein Gerät für Benachrichtigungen angemeldet.');
  if (!ergebnis.gesendet) throw fehler_('Die Test-Benachrichtigung konnte nicht gesendet werden (' + ergebnis.fehler + ').');
  return ergebnis;
}

/** Tracking-Liste geöffnet → ab jetzt ist nichts mehr „neu“. */
function actionMarkSeen_(nutzer) {
  var sheet = getSheet_('Nutzer');
  stelleSpalteSicher_(sheet, 'zuletzt_gesehen');
  var zeile = readTable_(sheet).filter(function (n) { return String(n.name).trim() === nutzer.name; })[0];
  if (zeile) schreibeFelder_(sheet, zeile._zeile, { zuletzt_gesehen: new Date() });
  return { neu: 0 };
}

// ---------------------------------------------------------------------------
// „Neu“ pro Nutzer
// ---------------------------------------------------------------------------

/** Zeitpunkt, zu dem der Nutzer die Tracking-Liste zuletzt geöffnet hat (oder null). */
function zuletztGesehen_(name) {
  var zeile = readTable_(getSheet_('Nutzer')).filter(function (n) { return String(n.name).trim() === name; })[0];
  return zeile && zeile.zuletzt_gesehen instanceof Date ? zeile.zuletzt_gesehen : null;
}

/** Ist das Dokument für diesen Nutzer neu? (von jemand anderem, seit dem letzten Öffnen) */
function istNeuFuer_(d, name, seit) {
  return !!d.erstellt_am && d.hochgeladen_von !== name && (!seit || d.erstellt_am > seit);
}

// ---------------------------------------------------------------------------
// Versand
// ---------------------------------------------------------------------------

/** Nach einem Upload: alle Editoren außer dem Hochladenden benachrichtigen. Fehler werden nur protokolliert. */
function sendePushAnEditoren_(hochgeladenVon) {
  try {
    var editoren = readTable_(getSheet_('Nutzer'))
      .filter(function (n) { return String(n.rolle).trim() === 'editor' && istWahr_(n.aktiv); })
      .map(function (n) { return String(n.name).trim(); });
    var geraete = geraeteVon_(function (name) { return name !== hochgeladenVon && editoren.indexOf(name) >= 0; });
    if (geraete.length) sendePush_(geraete);
  } catch (err) {
    console.error('Push-Versand fehlgeschlagen: ' + (err && err.stack ? err.stack : err));
  }
}

function geraeteVon_(passt) {
  var sheet = getSpreadsheet_().getSheetByName('Geraete');
  if (!sheet) return [];
  return readTable_(sheet).filter(function (g) {
    return g.endpoint && istWahr_(g.aktiv) && passt(String(g.name).trim());
  });
}

/** Schickt einen inhaltslosen Push an die Geräte. Abgelaufene Geräte (404/410) werden entfernt. */
function sendePush_(geraete) {
  var ergebnis = { geraete: geraete.length, gesendet: 0, fehler: '' };
  if (!geraete.length) return ergebnis;
  var anfragen = geraete.map(function (g) {
    return {
      url: g.endpoint,
      method: 'post',
      headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader_(g.endpoint) },
      payload: '',
      muteHttpExceptions: true
    };
  });
  var antworten = UrlFetchApp.fetchAll(anfragen);
  antworten.forEach(function (a, i) {
    var code = a.getResponseCode();
    if (code >= 200 && code < 300) {
      ergebnis.gesendet++;
    } else {
      ergebnis.fehler = 'HTTP ' + code + ' ' + a.getContentText().substring(0, 120);
      console.error('Push an ' + geraete[i].name + ' fehlgeschlagen: ' + ergebnis.fehler);
      if (code === 404 || code === 410) entferneGeraet_(geraete[i].endpoint);
    }
  });
  return ergebnis;
}

function entferneGeraet_(endpoint) {
  if (!endpoint) return;
  var sheet = getSpreadsheet_().getSheetByName('Geraete');
  if (!sheet) return;
  readTable_(sheet).filter(function (g) { return g.endpoint === endpoint; })
    .reverse()
    .forEach(function (g) { sheet.deleteRow(g._zeile); });
}

function geraeteSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('Geraete');
  if (!sheet) {
    sheet = ss.insertSheet('Geraete');
    sheet.getRange(1, 1, 1, GERAETE_SPALTEN.length).setValues([GERAETE_SPALTEN]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292): JWT mit ES256, gecacht pro Push-Dienst
// ---------------------------------------------------------------------------

function vapidHeader_(endpoint) {
  var aud = endpoint.match(/^https:\/\/[^/]+/)[0];
  var cache = CacheService.getScriptCache();
  var key = 'vapid_' + aud;
  var jwt = cache.get(key);
  if (!jwt) {
    var props = PropertiesService.getScriptProperties();
    var kopf = b64url_(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    var inhalt = b64url_(JSON.stringify({
      aud: aud,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: props.getProperty('APP_URL') || 'https://github.com/jcd50827/Docscan'
    }));
    var eingabe = kopf + '.' + inhalt;
    jwt = eingabe + '.' + b64urlBytes_(es256Signatur_(eingabe, BigInt('0x' + vapidSchluessel_().privat)));
    cache.put(key, jwt, 6 * 3600);
  }
  return 'vapid t=' + jwt + ', k=' + vapidSchluessel_().oeffentlich;
}

/** VAPID-Schlüsselpaar aus den Script-Eigenschaften; beim ersten Mal erzeugen. */
function vapidSchluessel_() {
  var props = PropertiesService.getScriptProperties();
  var privat = props.getProperty('VAPID_PRIVAT');
  var oeffentlich = props.getProperty('VAPID_OEFFENTLICH');
  if (!privat || !oeffentlich) {
    var d = zufallsSkalar_();
    var q = p256Mal_(d, p256_().G);
    privat = d.toString(16);
    oeffentlich = b64urlBytes_([4].concat(zahlZuBytes_(q.x), zahlZuBytes_(q.y)));
    props.setProperties({ VAPID_PRIVAT: privat, VAPID_OEFFENTLICH: oeffentlich });
  }
  return { privat: privat, oeffentlich: oeffentlich };
}

// ---------------------------------------------------------------------------
// ECDSA P-256 (ES256) in reinem JavaScript
// ---------------------------------------------------------------------------

// Erst bei Bedarf anlegen: Würde BigInt fehlen, fiele nur Push aus, nicht das ganze Script.
var P256_ = null;
function p256_() {
  if (!P256_) {
    P256_ = {
      p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
      n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
      G: {
        x: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
        y: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')
      }
    };
  }
  return P256_;
}

/** Signiert die Nachricht (SHA-256) und liefert r‖s als 64 Bytes. */
function es256Signatur_(nachricht, d) {
  var n = p256_().n;
  var z = bytesZuZahl_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, nachricht, Utilities.Charset.UTF_8));
  for (;;) {
    var k = zufallsSkalar_();
    var r = mod_(p256Mal_(k, p256_().G).x, n);
    if (r === BigInt(0)) continue;
    var s = mod_(invers_(k, n) * (z + r * d), n);
    if (s === BigInt(0)) continue;
    return zahlZuBytes_(r).concat(zahlZuBytes_(s));
  }
}

/** Zufallszahl 1 … n-1 aus SecureRandom (über Utilities.getUuid). */
function zufallsSkalar_() {
  for (;;) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now(), Utilities.Charset.UTF_8);
    var k = bytesZuZahl_(bytes);
    if (k > BigInt(0) && k < p256_().n) return k;
  }
}

/** k·P mit Jacobi-Koordinaten (schnell, nur eine Inversion am Ende). */
function p256Mal_(k, P) {
  var p = p256_().p;
  var R = null; // Punkt im Unendlichen
  var Q = { X: P.x, Y: P.y, Z: BigInt(1) };
  var bits = k.toString(2);
  for (var i = 0; i < bits.length; i++) {
    R = R ? jVerdoppeln_(R, p) : null;
    if (bits.charAt(i) === '1') R = R ? jAddieren_(R, Q, p) : { X: Q.X, Y: Q.Y, Z: Q.Z };
  }
  var zInv = invers_(R.Z, p);
  var zInv2 = mod_(zInv * zInv, p);
  return { x: mod_(R.X * zInv2, p), y: mod_(R.Y * zInv2 * zInv, p) };
}

function jVerdoppeln_(P, p) {
  if (P.Y === BigInt(0)) return null;
  var Y2 = mod_(P.Y * P.Y, p);
  var S = mod_(BigInt(4) * P.X * Y2, p);
  var Z2 = mod_(P.Z * P.Z, p);
  var M = mod_(BigInt(3) * (P.X - Z2) * (P.X + Z2), p); // a = -3
  var X = mod_(M * M - BigInt(2) * S, p);
  var Y = mod_(M * (S - X) - BigInt(8) * Y2 * Y2, p);
  var Z = mod_(BigInt(2) * P.Y * P.Z, p);
  return { X: X, Y: Y, Z: Z };
}

function jAddieren_(P, Q, p) {
  var Z1Z1 = mod_(P.Z * P.Z, p);
  var Z2Z2 = mod_(Q.Z * Q.Z, p);
  var U1 = mod_(P.X * Z2Z2, p);
  var U2 = mod_(Q.X * Z1Z1, p);
  var S1 = mod_(P.Y * Q.Z * Z2Z2, p);
  var S2 = mod_(Q.Y * P.Z * Z1Z1, p);
  if (U1 === U2) return S1 === S2 ? jVerdoppeln_(P, p) : null;
  var H = mod_(U2 - U1, p);
  var R = mod_(S2 - S1, p);
  var H2 = mod_(H * H, p);
  var H3 = mod_(H2 * H, p);
  var U1H2 = mod_(U1 * H2, p);
  var X = mod_(R * R - H3 - BigInt(2) * U1H2, p);
  var Y = mod_(R * (U1H2 - X) - S1 * H3, p);
  var Z = mod_(H * P.Z * Q.Z, p);
  return { X: X, Y: Y, Z: Z };
}

function mod_(a, m) {
  var r = a % m;
  return r < BigInt(0) ? r + m : r;
}

/** Modulares Inverses (erweiterter euklidischer Algorithmus). */
function invers_(a, m) {
  var alt = mod_(a, m), neu = m, x = BigInt(1), y = BigInt(0);
  while (neu !== BigInt(0)) {
    var q = alt / neu;
    var t = alt - q * neu; alt = neu; neu = t;
    t = x - q * y; x = y; y = t;
  }
  return mod_(x, m);
}

function bytesZuZahl_(bytes) {
  var hex = bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  return BigInt('0x' + hex);
}

/** Zahl → 32 Bytes (big-endian), als vorzeichenbehaftete Bytes wie in Apps Script üblich. */
function zahlZuBytes_(zahl) {
  var hex = zahl.toString(16);
  while (hex.length < 64) hex = '0' + hex;
  var bytes = [];
  for (var i = 0; i < 64; i += 2) {
    var v = parseInt(hex.substr(i, 2), 16);
    bytes.push(v > 127 ? v - 256 : v);
  }
  return bytes;
}

function b64url_(text) {
  return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function b64urlBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Test im Script-Editor
// ---------------------------------------------------------------------------

/** Erteilt beim ersten Ausführen die Berechtigung für externe Anfragen und schickt allen Editoren-Geräten einen Test. */
function testPush() {
  var geraete = geraeteVon_(function () { return true; });
  if (!geraete.length) {
    Logger.log('Noch kein Gerät angemeldet. In der App (Editor) „Benachrichtigungen aktivieren“ tippen.');
    return;
  }
  var ergebnis = sendePush_(geraete);
  Logger.log('Geräte: ' + ergebnis.geraete + ', gesendet: ' + ergebnis.gesendet + (ergebnis.fehler ? ', Fehler: ' + ergebnis.fehler : ''));
}
