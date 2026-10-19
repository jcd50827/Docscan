# DocScan

Dokumente mit dem Handy scannen, im eigenen Google Drive ablegen und Rechnungen im Blick behalten – ohne laufende Kosten, ohne App Store.

- **App:** eine Web-App (PWA), die über Safari auf den Home-Bildschirm gelegt wird.
- **Backend:** Google Apps Script unter deinem Google-Konto.
- **Daten:** ein Google Sheet (Nutzer, Dokumente, Log, Regeln) und ein Ordner `DocScan` in deinem Google Drive.

> **Stand: Meilenstein 4 (Tracking-Liste).** Scannen, Ablage im Google Drive, Texterkennung und Kategorisierung funktionieren. Editoren haben eine Tracking-Liste mit Filtern, Suche, Abhaken (Checkbox oder Wischen, mit „Rückgängig“), Detailansicht zum Bearbeiten und Löschen sowie die Übersicht auf der Startseite. Offline-Warteschlange, Mail-Erinnerungen, GiroCode, CSV-Export und Kantenerkennung folgen in Meilenstein 5.

---

## Einrichtung (einmalig, ca. 15 Minuten)

Du brauchst ein Google-Konto und ein GitHub-Konto (beides kostenlos). Programmierkenntnisse sind nicht nötig.

### 1. Google Sheet anlegen

1. Öffne [sheets.new](https://sheets.new) – es entsteht eine neue, leere Tabelle.
2. Gib ihr oben links einen Namen, z. B. **DocScan**.

### 2. Apps Script einfügen

1. Im Sheet: **Erweiterungen → Apps Script**. Es öffnet sich der Script-Editor.
2. Gib dem Projekt oben links einen Namen, z. B. **DocScan**.
3. Für jede Datei aus dem Ordner [`apps-script/`](apps-script) dieses Repos:
   - Links neben „Dateien“ auf **+ → Skript** klicken und den Namen **ohne** `.gs` eintragen (z. B. `Auth`).
   - Den Inhalt der Datei aus dem Repo komplett hineinkopieren.
   - Die vorhandene Datei `Code.gs` nicht neu anlegen, sondern ihren Inhalt ersetzen.

   Aktuell sind das: `Code.gs`, `Auth.gs`, `Documents.gs`, `Setup.gs`, `Ocr.gs`, `Classify.gs`.
4. Manifest-Datei übernehmen:
   - Links auf das Zahnrad **Projekteinstellungen** klicken und **„appsscript.json“-Manifestdatei im Editor anzeigen** anhaken.
   - Zurück im Editor die Datei `appsscript.json` öffnen und ihren Inhalt durch den aus [`apps-script/appsscript.json`](apps-script/appsscript.json) ersetzen.
5. **Speichern** (Disketten-Symbol oder Strg/Cmd + S).

### 3. Drive-API-Dienst aktivieren

Das Manifest aus Schritt 2.4 aktiviert den Dienst bereits. Zur Kontrolle: Links unter **Dienste** sollte **Drive** stehen. Falls nicht: **Dienste → +**, „Drive API“ auswählen, Version **v3**, Kennung `Drive`, **Hinzufügen**.

### 4. Einrichtung ausführen

1. Im Script-Editor oben im Auswahlfeld die Funktion **`setup`** wählen und **Ausführen** klicken.
2. Google fragt nach Berechtigungen: **Berechtigungen prüfen** → dein Konto wählen.
   Erscheint „Google hat diese App nicht überprüft“: **Erweitert → Zu DocScan wechseln (unsicher)**. Das ist normal, weil das Script dir selbst gehört.
3. Danach hat das Sheet die Tabs **Nutzer**, **Dokumente**, **Log** und **Regeln**, und in deinem Drive gibt es den Ordner **DocScan**.

`setup` darf jederzeit erneut ausgeführt werden; vorhandene Daten bleiben erhalten.

### 5. Als Web-App bereitstellen

1. Im Script-Editor oben rechts: **Bereitstellen → Neue Bereitstellung**.
2. Beim Zahnrad „Typ auswählen“ **Web-App** wählen.
3. Einstellen:
   - **Beschreibung:** z. B. `DocScan`
   - **Ausführen als:** **Ich** (deine E-Mail-Adresse)
   - **Zugriff:** **Jeder**
4. **Bereitstellen** klicken und die **Web-App-URL** kopieren (endet auf `/exec`).

> Die Sicherheit kommt über die persönlichen Zugangscodes, nicht über die URL. Ohne gültigen Code liefert die Web-App keine Daten.

**Wichtig bei späteren Änderungen am Script:** **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version: Neue Version → Bereitstellen.** So bleibt die URL gleich. Eine „Neue Bereitstellung“ würde eine neue URL erzeugen.

### 6. App auf GitHub Pages veröffentlichen

1. Dieses Repository auf GitHub forken oder als eigenes Repository anlegen.
2. Im Repository die Datei [`pwa/config.js`](pwa/config.js) öffnen, auf den Stift klicken und die URL aus Schritt 5 eintragen:
   ```js
   window.DOCSCAN_CONFIG = {
     APPS_SCRIPT_URL: 'https://script.google.com/macros/s/…/exec'
   };
   ```
   Mit **Commit changes** speichern.
3. **Settings → Pages → Build and deployment → Source: „GitHub Actions“** wählen.
4. Unter **Actions** läuft nun „PWA auf GitHub Pages“. Nach ca. 1 Minute ist die App erreichbar unter
   `https://<dein-github-name>.github.io/<repo-name>/`
   (falls der Lauf vor Schritt 3 gestartet ist: **Actions → PWA auf GitHub Pages → Run workflow**).

Jede Änderung im Ordner `pwa/` auf dem Branch `main` wird automatisch neu veröffentlicht.

### 7. Nutzer anlegen

1. Das Sheet neu laden. Oben erscheint das Menü **DocScan**.
2. **DocScan → Nutzer anlegen** und den Fragen folgen:
   - **Name** (wird in der App und im Log angezeigt, muss eindeutig sein)
   - **Rolle:** `contributor` (scannen, eigene Uploads sehen) oder `editor` (zusätzlich alle Dokumente, Tracking-Liste, bearbeiten, löschen)
   - **E-Mail** (optional, für spätere Erinnerungs-Mails an Editoren)
3. Der **Zugangscode** (Format `XXXX-XXXX-XXXX`) wird **nur ein einziges Mal** angezeigt. Notieren und der Person sicher weitergeben (z. B. persönlich oder per Signal). Im Sheet steht nur ein Hash, der Code selbst ist nirgends gespeichert.

Lege dir selbst auch einen Nutzer mit Rolle `editor` an.

**Zugang sperren:** Im Tab **Nutzer** beim betreffenden Nutzer das Häkchen in der Spalte **aktiv** entfernen. Die App meldet die Person beim nächsten Start ab.
**Code verloren:** Zeile löschen (oder deaktivieren) und den Nutzer mit neuem Code neu anlegen.

### 8. App auf dem iPhone installieren

1. Die GitHub-Pages-Adresse in **Safari** öffnen.
2. Unten auf **Teilen** (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → **Hinzufügen**.
3. DocScan vom Home-Bildschirm starten und den Zugangscode eingeben.

Android (Chrome): Menü **⋮ → App installieren** bzw. **Zum Startbildschirm hinzufügen**.

---

## Update einspielen (nach jedem neuen Meilenstein)

Die App selbst (GitHub Pages) aktualisiert sich automatisch. Das Apps Script muss von Hand aktualisiert werden – am Computer:

1. Sheet öffnen → **Erweiterungen → Apps Script**.
2. Für jede geänderte Datei den Inhalt komplett durch die aktuelle Version ersetzen (Links unten). Neue Dateien wie in Schritt 2 der Einrichtung anlegen.
3. **Speichern**.
4. **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version: „Neue Version“ → Bereitstellen.**
   Wichtig: *nicht* „Neue Bereitstellung“, sonst ändert sich die URL.

**Meilenstein 4 ändert:** [`Code.gs`](https://raw.githubusercontent.com/jcd50827/Docscan/main/apps-script/Code.gs) und [`Documents.gs`](https://raw.githubusercontent.com/jcd50827/Docscan/main/apps-script/Documents.gs).

(Meilenstein 3 hatte `Code.gs` und `Documents.gs` geändert und `Classify.gs` sowie `Ocr.gs` neu hinzugefügt – danach einmal **`testOcr`** im Script-Editor ausführen und die neue Berechtigung für Google Docs erlauben, sonst landet jeder Scan als „Sonstiges“.)

(Meilenstein 2 hatte `Code.gs`, `Documents.gs` und `Setup.gs` geändert – danach einmal **DocScan → Einrichtung ausführen**.)

Auf dem iPhone die App danach einmal schließen und neu öffnen, damit die neue Version geladen wird.

---

## Test-Checkliste Meilenstein 4 (Editor, auf dem iPhone)

- [ ] Menü **⋮ → Tracking-Liste** zeigt zunächst die **offenen** Dokumente, überfällige zuerst und rot markiert, darunter die nächsten Fälligkeiten.
- [ ] Jede Karte zeigt Absender, Betrag, Fälligkeit und Status; oben steht die Anzahl und die offene Summe.
- [ ] Filter-Chips **Offen / Bezahlt / Alle** und **Kategorie** schränken die Liste ein; die **Suche** findet Absender, Titel, Rechnungsnummer, Betrag (z. B. „84,20“) und Wörter aus dem Dokumenttext.
- [ ] **Checkbox** antippen → Karte verschwindet aus „Offen“, unten erscheint „Als bezahlt markiert · **Rückgängig**“; Rückgängig holt sie zurück.
- [ ] Karte **nach links oder rechts wischen** → ebenfalls als bezahlt markiert.
- [ ] Im Sheet stehen bei bezahlten Rechnungen `bezahlt_am` und `bezahlt_von`; im **Log** „status_bezahlt“ bzw. „status_offen“.
- [ ] Karte antippen → **Detailansicht** mit allen Angaben, „Als bezahlt markieren“, „Angaben korrigieren“, „PDF in Drive öffnen“ und **Löschen** (mit Rückfrage).
- [ ] Nach dem Löschen ist das Dokument aus Liste und Übersicht verschwunden; im Sheet steht `geloescht` = TRUE, die PDF liegt weiter im Drive.
- [ ] Startseite: Kacheln **Summe offen / Überfällig / Nächste 7 Tage** führen zur Liste, die „Bald fällig“-Karten direkt zum Dokument.
- [ ] Contributor sehen weder die Tracking-Liste noch Detailansichten.

## Test-Checkliste Meilenstein 3

Am besten mit 3–4 echten Dokumenten: eine Rechnung, eine Mahnung oder Zahlungserinnerung, ein Vertrag/Bescheid und ein beliebiger Brief.

- [ ] Nach dem Hochladen (dauert jetzt einige Sekunden länger) zeigt die Ergebnis-Karte „Erkannt als: Rechnung – <Absender> – <Betrag> – fällig <Datum>“.
- [ ] Darunter stehen die erkannten Angaben (Absender, Betrag, Fällig am, Rechnungsnr., IBAN, Status). Ohne Fälligkeitsdatum auf der Rechnung steht „(geschätzt)“ hinter dem Datum (Rechnungsdatum + 14 Tage).
- [ ] Im Drive liegt die PDF unter `DocScan/<Jahr>/<Kategorie>/` mit Namen `JJJJ-MM-TT_<Absender>_<Kategorie>_<Betrag>€.pdf`.
- [ ] Im Sheet (Tab **Dokumente**) sind Kategorie, Absender, Betrag, Fälligkeit, IBAN, Rechnungsnr. und `ocr_text_kurz` gefüllt; Rechnung/Mahnung hat Status `offen`, alles andere `erledigt`.
- [ ] Editor: **Angaben korrigieren** → z. B. Kategorie oder Betrag ändern → **Speichern** → Karte zeigt die neuen Werte; die PDF in Drive ist umbenannt und bei neuer Kategorie in den passenden Ordner verschoben.
- [ ] Editor: falsche IBAN eingeben → Fehlermeldung „Die IBAN ist ungültig …“.
- [ ] Contributor: sieht die Erkennung, aber keinen Button zum Korrigieren.
- [ ] Dasselbe Dokument zweimal scannen → gelbe Warnung „Mögliches Duplikat von …“; im Sheet steht in `notiz` „Mögliches Duplikat von <id>“.
- [ ] Startseite (Editor): „Summe offen“ und „Nächste 7 Tage“ zählen die erkannten Rechnungen.
- [ ] Eigene Schlüsselwörter im Tab **Regeln** ergänzen (z. B. `Rechnung | abschlag | 2`) → beim nächsten Scan berücksichtigt.

## Test-Checkliste Meilenstein 2 (auf dem iPhone)

- [ ] Startseite → **Scannen** öffnet direkt die Kamera.
- [ ] Nach dem Foto: Seitenübersicht mit Vorschaubild und Seitennummer.
- [ ] **+ Seite aufnehmen** fügt weitere Seiten hinzu; **Aus Fotos wählen** übernimmt Bilder aus der Mediathek (auch mehrere).
- [ ] Vorschaubild antippen → Seite neu aufnehmen (ersetzt sie); **×** löscht eine Seite.
- [ ] Filter „Dokument“ an/aus → Vorschaubilder wechseln zwischen Graustufen und Farbe.
- [ ] **Hochladen** → Fortschritt („Seite 1 von 2 …“, „Wird hochgeladen …“) → „Hochgeladen“ mit Titel und Seitenzahl.
- [ ] Im Drive liegt die PDF unter `DocScan/<Jahr>/Sonstiges/` mit Namen `JJJJ-MM-TT_<Titel>_Sonstiges.pdf`, alle Seiten in der richtigen Reihenfolge, gut lesbar.
- [ ] Im Sheet steht eine neue Zeile im Tab **Dokumente** und ein Eintrag „upload“ im Tab **Log**.
- [ ] Contributor: der Upload erscheint auf der Startseite unter „Meine Uploads“.
- [ ] Editor: Button **PDF in Drive öffnen** auf der Ergebnis-Karte funktioniert.
- [ ] Flugmodus an → Hochladen → Hinweis „Keine Verbindung …“, Seiten bleiben erhalten; Flugmodus aus → erneut **Hochladen** klappt.

## Test-Checkliste Meilenstein 1 (auf dem iPhone)

- [ ] App lässt sich zum Home-Bildschirm hinzufügen, startet ohne Safari-Leiste, Icon ist sichtbar.
- [ ] Falscher Code → „Zugangscode ungültig.“
- [ ] Code eines Contributors → Startseite mit „Scannen“ und „Meine Uploads (letzte 7 Tage)“, kein Menüpunkt „Tracking-Liste“.
- [ ] Code eines Editors → Startseite mit Übersicht (Summe offen, Überfällig, Nächste 7 Tage) und Menüpunkt „Tracking-Liste“.
- [ ] App schließen und neu öffnen → bleibt angemeldet.
- [ ] Menü → Abmelden → zurück zum Login.
- [ ] Nutzer im Sheet deaktivieren → App meldet beim nächsten Start ab.
- [ ] Dark Mode (iPhone-Einstellungen) → App wechselt mit.
- [ ] Im Tab **Log** steht der Eintrag „nutzer_angelegt“.

---

## Für Entwickler

### Aufbau

```
pwa/                 statische PWA (kein Build-Schritt), wird auf GitHub Pages veröffentlicht
  index.html, app.js (UI/Routing), api.js (Apps-Script-Aufrufe), styles.css,
  scanner.js (Bildverarbeitung, PDF mit jsPDF), sw.js (Service Worker),
  manifest.webmanifest, config.js, icons/
apps-script/         Google Apps Script (V8)
  Code.gs            doGet/doPost, Routing, Sheet-Hilfsfunktionen
  Auth.gs            Zugangscodes (SHA-256), Rollen, Brute-Force-Schutz
  Documents.gs       Upload & Drive-Ablage, Korrektur, Tracking-Liste, Status, Löschen, Übersicht
  Ocr.gs             Texterkennung über Drive-Konvertierung (+ testOcr)
  Classify.gs        Kategorisierung & Feldextraktion, regelbasiert (+ testClassify)
  Setup.gs           setup(), Menü, „Nutzer anlegen“
  appsscript.json    Manifest inkl. Drive API v3
.github/workflows/pages.yml   Deployment von pwa/ auf GitHub Pages
```

Die vollständige Spezifikation steht in [`CLAUDE.md`](CLAUDE.md).

### API (Stand Meilenstein 4)

Alle Requests: `POST` an die Web-App-URL, `Content-Type: text/plain;charset=utf-8`, Body `{ action, code, ...payload }`.

| action | Rolle | Antwort |
|---|---|---|
| `login` | alle | `{ ok, name, rolle }` |
| `upload` | alle | Payload `{ pdfBase64, seiten, titelVorschlag? }` → `{ ok, dokument }` inkl. erkannter Felder, `faelligGeschaetzt`, `textErkannt`, `duplikatVon` |
| `update` | editor | Payload `{ id, felder: { kategorie, titel, absender, betrag, faellig_am (JJJJ-MM-TT), iban, rechnungsnr, notiz } }` → `{ ok, dokument }`; PDF wird umbenannt/verschoben |
| `listMine` | alle | `{ ok, dokumente: [...] }` (eigene Uploads, 7 Tage) |
| `list` | editor | Payload `{ filter: { status: offen\|bezahlt\|erledigt\|alle, kategorie, suche, id } }` → `{ ok, dokumente, gesamt }` (offene nach Fälligkeit, max. 300) |
| `setStatus` | editor | Payload `{ id, status }` → `{ ok, dokument }`; „bezahlt“ setzt `bezahlt_am`/`bezahlt_von` |
| `delete` | editor | Payload `{ id }` → `{ ok, id }`; Soft Delete (`geloescht` = TRUE), PDF bleibt im Drive |
| `stats` | editor | `{ ok, summeOffen, anzahlOffen, anzahlUeberfaellig, naechsteFaelligkeiten }` |

Fehler: `{ ok: false, error: "…" }`; bei ungültigem oder deaktiviertem Code zusätzlich `auth: true`, damit die App abmeldet. Nach 10 Fehlversuchen pro Code-Präfix ist dieser Präfix 15 Minuten gesperrt.

### Lokal testen

```sh
cd pwa && python3 -m http.server 8000
```
und `http://localhost:8000` öffnen (Service Worker funktionieren auf `localhost` auch ohne HTTPS).

### Optional: clasp

Statt Copy & Paste kann das Script mit [clasp](https://github.com/google/clasp) hochgeladen werden:

```sh
npm i -g @google/clasp
clasp login
cd apps-script
# Script-ID aus den Projekteinstellungen; .clasp.json ist in .gitignore
echo '{"scriptId":"<SCRIPT_ID>","rootDir":"."}' > .clasp.json
clasp push
```
