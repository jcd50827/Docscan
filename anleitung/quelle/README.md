# Quelle der Anleitung

- `anleitung.html` – Inhalt und Layout der PDF-Anleitung (A4)
- `link-qr.svg` – QR-Code zu https://jcd50827.github.io/Docscan/
- `pdf.js` – erzeugt `../DocScan-Anleitung.pdf`

PDF neu erzeugen (aus dem Repo-Ordner, braucht Playwright mit Chromium und die Schrift Inter):

```sh
node anleitung/quelle/pdf.js
```

Ohne Playwright: `anleitung.html` in Chrome öffnen → Drucken → „Als PDF speichern“, Hintergrundgrafiken an.
