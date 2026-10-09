# Projekt: DocScan – Dokumente scannen, ablegen, Rechnungen tracken

## Ziel
Eine kostenlose Web-App (PWA) für iPhone (Priorität) und Android, mit der ein kleiner, geschlossener Personenkreis Dokumente scannt. Die PDFs landen im Google Drive des Besitzers, werden automatisch ausgelesen und kategorisiert. Rechnungen erscheinen in einer Tracking-Liste (offen/bezahlt).

## Harte Rahmenbedingungen
- **0 € laufende Kosten.** Keine kostenpflichtigen APIs, keine Server, keine Developer-Accounts.
- Kein App Store. Verteilung per Link, Installation über Safari → „Zum Home-Bildschirm“.
- Backend = **Google Apps Script** (läuft unter dem Konto des Besitzers), Datenbank = **Google Sheet**, Ablage = **Google Drive**.
- Frontend = statische PWA (HTML/CSS/Vanilla JS, kein Build-Schritt nötig), gehostet auf **GitHub Pages**.
- Externe JS-Bibliotheken nur per CDN (jsDelivr/cdnjs) und vom Service Worker gecacht.
- Sprache der Oberfläche: Deutsch.

## Repo-Struktur
```
/pwa
  index.html
  app.js            # UI, Routing, State
  api.js            # Kommunikation mit Apps Script
  scanner.js        # Kamera, Kantenerkennung, Entzerrung, PDF-Erstellung
  queue.js          # Offline-Warteschlange (IndexedDB)
  styles.css
  manifest.webmanifest
  sw.js             # Service Worker (App-Shell + Libraries cachen)
  config.js         # APPS_SCRIPT_URL
  /icons            # 192, 512, apple-touch-icon 180
/apps-script
  Code.gs           # doGet/doPost, Routing
  Auth.gs           # Code-Prüfung, Rollen
  Documents.gs      # Upload, Drive-Ablage, Liste, Status, Löschen
  Ocr.gs            # OCR über Drive-Konvertierung
  Classify.gs       # Regelbasierte Kategorisierung + Feldextraktion
  Reminders.gs      # Täglicher Mail-Trigger
  Setup.gs          # setup(): legt Sheet-Tabs, Drive-Ordner, Trigger an
  appsscript.json   # inkl. Advanced Service „Drive API v3“
/README.md          # Einrichtungsanleitung für Nicht-Entwickler
```

## Datenmodell (Google Sheet)

### Tab `Nutzer`
| Spalte | Beschreibung |
|---|---|
| name | Anzeigename |
| code_hash | SHA-256 (hex) des persönlichen Zugangscodes |
| rolle | `contributor` oder `editor` |
| aktiv | TRUE/FALSE |
| erstellt_am | Datum |

Klartext-Codes werden **nie** gespeichert. Für den Besitzer gibt es im Sheet ein Menü „DocScan → Nutzer anlegen“: Es fragt Name und Rolle ab, erzeugt einen zufälligen Code (12 Zeichen), speichert den Hash und zeigt den Code einmalig an.

### Tab `Dokumente`
| Spalte | Beschreibung |
|---|---|
| id | UUID |
| erstellt_am | Zeitstempel |
| hochgeladen_von | Name |
| kategorie | `Rechnung`, `Mahnung`, `Vertrag`, `Bescheid`, `Info`, `Sonstiges` |
| titel | z. B. „Stadtwerke – Strom Oktober“ |
| absender | erkannt oder leer |
| betrag | Zahl, z. B. 84.20 |
| faellig_am | Datum oder leer |
| iban | erkannt oder leer |
| rechnungsnr | erkannt oder leer |
| status | `offen`, `bezahlt`, `erledigt` (für Nicht-Rechnungen) |
| bezahlt_am | Datum |
| bezahlt_von | Name |
| drive_file_id | ID der PDF |
| drive_url | Link zur PDF |
| ocr_text_kurz | erste 500 Zeichen (für Suche/Duplikate) |
| fingerprint | für Duplikaterkennung |
| geloescht | TRUE/FALSE (Soft Delete) |
| notiz | Freitext |

### Tab `Log`
Zeitstempel, Name, Aktion, Dokument-ID. Jede schreibende Aktion wird geloggt.

### Tab `Regeln`
Kategorisierungs-Schlüsselwörter (Spalten: kategorie, schluesselwort, gewicht). Der Besitzer kann sie ohne Codeänderung erweitern.

## Rollen & Rechte
| Aktion | contributor | editor |
|---|---|---|
| Scannen & hochladen | ✅ | ✅ |
| Eigene Uploads der letzten 7 Tage sehen | ✅ | ✅ |
| Alle Dokumente & Tracking-Liste sehen | ❌ | ✅ |
| Status ändern (bezahlt/offen) | ❌ | ✅ |
| Kategorie/Felder korrigieren | ❌ | ✅ |
| Löschen | ❌ | ✅ |

**Rechte werden ausschließlich im Apps Script geprüft**, nie nur im Frontend. Das Frontend blendet Buttons nur aus.

## API (Apps Script Web App)
- Deployment: „Ausführen als: Ich“, „Zugriff: Jeder“. Die Sicherheit kommt über den Zugangscode.
- Alle Requests: `POST` mit `Content-Type: text/plain;charset=utf-8` und JSON-Body. Das vermeidet CORS-Preflight. Antwort per `ContentService` als JSON.
- Jeder Body enthält `{ action, code, ...payload }`.
- Schreibende Aktionen laufen unter `LockService.getScriptLock()`.
- Fehlerformat: `{ ok: false, error: "Nachricht auf Deutsch" }`.

| action | Rolle | Payload | Antwort |
|---|---|---|---|
| `login` | alle | – | `{ name, rolle }` |
| `upload` | alle | `{ pdfBase64, seiten, titelVorschlag? }` | erkanntes Dokument inkl. Kategorie |
| `listMine` | alle | – | eigene Uploads (7 Tage) |
| `list` | editor | `{ filter: {status, kategorie, suche} }` | Dokumente |
| `setStatus` | editor | `{ id, status }` | aktualisiertes Dokument |
| `update` | editor | `{ id, felder }` | aktualisiertes Dokument |
| `delete` | editor | `{ id }` | ok |
| `stats` | editor | – | Summe offen, Anzahl überfällig, nächste Fälligkeiten |

Ein einfacher Brute-Force-Schutz: Fehlversuche pro Code-Präfix werden in `CacheService` gezählt. Nach 10 Fehlversuchen gibt es 15 Minuten Sperre.

## Scan-Pipeline (Frontend)
1. `<input type="file" accept="image/*" capture="environment">` öffnet die Kamera. Mehrere Seiten nacheinander aufnehmen, Vorschau als Thumbnails mit Löschen/Neu-Aufnehmen.
2. Kantenerkennung und Entzerrung mit **jscanify** (benötigt OpenCV.js). OpenCV erst beim ersten Scan nachladen (lazy) und im Service Worker cachen. Danach folgt eine manuelle Korrektur: 4 ziehbare Eckpunkte. Fallback ohne OpenCV ist nur Zuschneiden.
3. Optionaler Filter „Dokument“: Graustufen + Kontrast, damit die Datei klein bleibt und die OCR besser wird.
4. Bilder auf max. 1700 px Breite skalieren, JPEG-Qualität 0.7.
5. Mit **jsPDF** zu einem PDF (A4) zusammenfügen. Zielgröße < 3 MB.
6. Upload als Base64. Bei fehlendem Netz in die IndexedDB-Warteschlange legen und beim nächsten App-Start bzw. bei `online` automatisch senden. iOS kennt keine Background Sync, daher dieser Ansatz.

## Verarbeitung (Apps Script)
1. PDF in Drive speichern unter `DocScan/<Jahr>/<Kategorie>/`. Ordner bei Bedarf anlegen.
2. **OCR:** Das PDF mit `Drive.Files.create({ name, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'de' })` als Google Doc kopieren. Danach den Text mit `DocumentApp.openById(id).getBody().getText()` lesen und das temporäre Doc löschen (`Drive.Files.remove`).
3. **Klassifizieren** (siehe unten), Felder extrahieren.
4. Datei umbenennen: `YYYY-MM-DD_<Absender>_<Kategorie>[_<Betrag>€].pdf` und in den richtigen Kategorie-Ordner verschieben.
5. **Duplikatprüfung:** `fingerprint` = normalisiert (IBAN + Betrag + Rechnungsnr), sonst Hash der ersten 300 OCR-Zeichen. Bei einem Treffer bleibt das Dokument gespeichert, bekommt aber `notiz = "Mögliches Duplikat von <id>"`. Die App zeigt eine Warnung.
6. Zeile in `Dokumente` schreiben. Status `offen` für Rechnung/Mahnung, sonst `erledigt`.

## Kategorisierung & Extraktion (regelbasiert, keine KI-API)
- Punkte pro Kategorie über Schlüsselwörter aus Tab `Regeln`. Gestartet wird mit Defaults, die `setup()` einträgt:
  - Rechnung: rechnung, rechnungsnummer, rechnungsbetrag, zahlbar bis, fällig, zu zahlen, ust, mwst, iban
  - Mahnung: mahnung, zahlungserinnerung, mahngebühr, letzte erinnerung
  - Vertrag: vertrag, vertragsnummer, laufzeit, kündigung, unterschrift
  - Bescheid: bescheid, finanzamt, steuerbescheid, aktenzeichen, rechtsbehelf
  - Info: information, mitteilung, newsletter, hinweis
- Höchste Punktzahl gewinnt. Unter einer Mindestpunktzahl wird `Sonstiges` vergeben.
- Extraktion per Regex:
  - IBAN: `DE\d{2}(?:\s?\d{4}){4}\s?\d{2}` (plus generisches IBAN-Muster), mit Prüfziffer-Validierung (mod 97)
  - Betrag: Zahlen im deutschen Format nahe bei „Gesamtbetrag|Rechnungsbetrag|zu zahlen|Summe|Endbetrag“. Sonst den größten Betrag mit „€/EUR“ nehmen.
  - Fälligkeit: Datum nach „zahlbar bis|fällig am|bis zum“. Sonst Rechnungsdatum + 14 Tage, markiert als geschätzt.
  - Rechnungsnummer: Text nach „Rechnungs-?nr\.?|Rechnungsnummer|Invoice“
  - Absender: erste nicht-leere Zeile mit Firmenmerkmal (GmbH, AG, e.V., KG, Stadtwerke …), sonst die erste Zeile.
- Alle Regeln in eigenen, testbaren Funktionen. In `Classify.gs` gibt es eine `testClassify()` mit Beispieltexten.

## Oberfläche (PWA)
- **Login:** Code eingeben, wird in `localStorage` gespeichert (try/catch). „Abmelden“ im Menü.
- **Startseite:** großer Button „Scannen“. Darunter für Contributor die eigenen letzten Uploads, für Editoren eine Übersicht: Summe offen, überfällig (rot), nächste 7 Tage.
- **Tracking-Liste (Editor):** Filter-Chips (Offen / Bezahlt / Alle / Kategorie), Suche. Jede Karte zeigt Absender, Betrag, Fälligkeit und Status. Abhaken per Checkbox oder Swipe, mit „Rückgängig“-Toast. Antippen öffnet die Detailansicht.
- **Detail:** Felder bearbeiten, PDF in Drive öffnen, löschen (mit Bestätigung), GiroCode anzeigen (siehe Meilenstein 5).
- Nach dem Upload kommt eine Ergebnis-Karte „Erkannt als: Rechnung – Stadtwerke – 84,20 € – fällig 23.10.“. Editoren können dort direkt korrigieren.
- Mobile first: Safe Areas (`env(safe-area-inset-*)`), große Touch-Ziele, Dark Mode über `prefers-color-scheme`.
- `manifest.webmanifest` mit `display: standalone`, Apple-Meta-Tags (`apple-mobile-web-app-capable`, `apple-touch-icon`).

## Erinnerungen
`Reminders.gs`: Ein täglicher Zeit-Trigger um 8 Uhr schickt per `MailApp` eine Mail an den Besitzer und optional an alle Editoren mit E-Mail im Tab `Nutzer`. Inhalt: überfällige Rechnungen und solche, die in den nächsten 3 Tagen fällig sind. Wenn nichts ansteht, geht keine Mail raus.

## Meilensteine
1. **Fundament:** `setup()`, Nutzerverwaltung, `login`, PWA-Grundgerüst mit Login und Rollenansicht, Deployment auf GitHub Pages.
2. **Scannen & Upload:** Kamera, mehrere Seiten, PDF, Upload nach Drive, Eintrag im Sheet.
3. **OCR & Kategorisierung:** OCR, Regeln, Extraktion, Umbenennen/Einsortieren, Duplikatprüfung.
4. **Tracking-Liste:** Liste, Filter, Abhaken, Bearbeiten, Löschen, Übersicht.
5. **Extras:** Offline-Warteschlange, Mail-Erinnerungen, GiroCode (EPC-QR, erzeugt im Browser mit einer QR-Bibliothek aus Empfänger, IBAN, Betrag, Verwendungszweck), CSV-Export pro Jahr, Kantenerkennung mit Eckpunkt-Korrektur.

Jeder Meilenstein muss für sich lauffähig und auf einem echten iPhone getestet sein, bevor der nächste beginnt.

## Arbeitsweise für Claude Code
- Erst den Meilenstein planen, dann umsetzen. Kleine, nachvollziehbare Commits.
- Kein Framework, kein Bundler, kein npm für die PWA. Die Dateien müssen direkt von GitHub Pages laufen.
- Apps-Script-Code ist reines JavaScript (V8-Runtime). Keine Node-APIs.
- Optional `clasp` für den Upload des Apps Scripts. Die README beschreibt aber auch den manuellen Weg (Copy & Paste).
- Nach jedem Meilenstein die README aktualisieren: was der Besitzer klicken muss (Sheet anlegen, Script einfügen, Drive-API-Dienst aktivieren, als Web-App bereitstellen, URL in `config.js` eintragen, Nutzer anlegen).
- Geheimnisse (Web-App-URL ist nicht geheim, Codes schon) nie ins Repo committen.

## Bekannte Grenzen (bewusst akzeptiert)
- Scan-Qualität unter der des nativen iOS-Scanners.
- Regelbasierte Erkennung ist nicht perfekt, deshalb gibt es die Korrekturmöglichkeit.
- Erinnerungen per E-Mail statt Push.
- Apps-Script-Quoten (kostenloses Google-Konto) reichen für einige Dutzend Dokumente pro Tag problemlos.
