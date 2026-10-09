# DocScan

Dokumente mit dem Handy scannen, im eigenen Google Drive ablegen und Rechnungen im Blick behalten – ohne laufende Kosten, ohne App Store.

- **App:** eine Web-App (PWA), die über Safari auf den Home-Bildschirm gelegt wird.
- **Backend:** Google Apps Script unter deinem Google-Konto.
- **Daten:** ein Google Sheet (Nutzer, Dokumente, Log, Regeln) und ein Ordner `DocScan` in deinem Google Drive.

> **Stand: Meilenstein 1 (Fundament).** Einrichtung, Nutzerverwaltung, Anmeldung und die Startseite je nach Rolle funktionieren. Scannen, Texterkennung und die Tracking-Liste folgen in den nächsten Meilensteinen.

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

   Aktuell sind das: `Code.gs`, `Auth.gs`, `Documents.gs`, `Setup.gs`.
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
  sw.js (Service Worker), manifest.webmanifest, config.js, icons/
apps-script/         Google Apps Script (V8)
  Code.gs            doGet/doPost, Routing, Sheet-Hilfsfunktionen
  Auth.gs            Zugangscodes (SHA-256), Rollen, Brute-Force-Schutz
  Documents.gs       Dokumente lesen (listMine, stats)
  Setup.gs           setup(), Menü, „Nutzer anlegen“
  appsscript.json    Manifest inkl. Drive API v3
.github/workflows/pages.yml   Deployment von pwa/ auf GitHub Pages
```

Die vollständige Spezifikation steht in [`CLAUDE.md`](CLAUDE.md).

### API (Stand Meilenstein 1)

Alle Requests: `POST` an die Web-App-URL, `Content-Type: text/plain;charset=utf-8`, Body `{ action, code, ...payload }`.

| action | Rolle | Antwort |
|---|---|---|
| `login` | alle | `{ ok, name, rolle }` |
| `listMine` | alle | `{ ok, dokumente: [...] }` (eigene Uploads, 7 Tage) |
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
