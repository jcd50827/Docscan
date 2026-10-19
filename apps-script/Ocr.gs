/**
 * DocScan – Texterkennung (OCR) über die kostenlose Drive-Konvertierung.
 *
 * Das PDF wird als temporäres Google Doc mit OCR (Deutsch) angelegt, der Text
 * ausgelesen und das Doc sofort wieder gelöscht.
 * Benötigt den erweiterten Dienst „Drive API v3“ (siehe appsscript.json).
 */

/**
 * Liefert den erkannten Text oder '' (z. B. wenn die OCR fehlschlägt).
 * Ein OCR-Fehler darf den Upload nicht verhindern – das Dokument wird dann
 * als „Sonstiges“ abgelegt und kann von Hand korrigiert werden.
 */
function ocrText_(blob) {
  var docId = null;
  try {
    var doc = Drive.Files.create(
      { name: 'DocScan-OCR-' + Utilities.getUuid(), mimeType: MimeType.GOOGLE_DOCS },
      blob,
      { ocrLanguage: 'de', fields: 'id' }
    );
    docId = doc.id;
    return DocumentApp.openById(docId).getBody().getText();
  } catch (err) {
    console.error('OCR fehlgeschlagen: ' + (err && err.message ? err.message : err));
    return '';
  } finally {
    if (docId) {
      try {
        Drive.Files.remove(docId);
      } catch (err) {
        console.error('Temporäres OCR-Dokument konnte nicht gelöscht werden: ' + docId);
      }
    }
  }
}

/**
 * Manueller Test im Script-Editor: liest die neueste PDF aus dem Ordner
 * „DocScan“ (inkl. Unterordner) per OCR und schreibt Text und Erkennung ins Protokoll.
 */
function testOcr() {
  var root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'));
  var neueste = null;
  (function suche(ordner) {
    var dateien = ordner.getFilesByType(MimeType.PDF);
    while (dateien.hasNext()) {
      var d = dateien.next();
      if (!neueste || d.getDateCreated() > neueste.getDateCreated()) neueste = d;
    }
    var unter = ordner.getFolders();
    while (unter.hasNext()) suche(unter.next());
  })(root);
  if (!neueste) {
    Logger.log('Keine PDF im Ordner DocScan gefunden.');
    return;
  }
  var text = ocrText_(neueste.getBlob());
  Logger.log('Datei: ' + neueste.getName() + ' (' + text.length + ' Zeichen erkannt)');
  // Kompletter Text in Stücken, weil das Protokoll lange Einträge abschneidet.
  for (var i = 0; i < text.length; i += 1500) {
    Logger.log('Erkannter Text (' + (i / 1500 + 1) + '):\n' + text.substring(i, i + 1500));
  }
  var zeilen = text.split(/\r?\n/);
  var betragsZeilen = zeilen
    .map(function (z, n) { return 'Zeile ' + (n + 1) + ': ' + z; })
    .filter(function (z) { return new RegExp(BETRAG_MUSTER).test(z); });
  Logger.log('Zeilen mit Beträgen:\n' + betragsZeilen.join('\n'));
  Logger.log('Auswertung: ' + JSON.stringify(analysiereText_(text, ladeRegeln_())));
}
