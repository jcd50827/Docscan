// Erzeugt anleitung/DocScan-Anleitung.pdf aus anleitung.html (A4, mit Seitenzahlen).
// Aufruf aus dem Repo-Ordner: node anleitung/quelle/pdf.js
// Braucht Playwright mit Chromium (z. B. npx playwright install chromium) und die Schrift „Inter“.
// Ohne Playwright: anleitung.html in Chrome öffnen → Drucken → „Als PDF speichern“,
// Ränder „Standard“, „Hintergrundgrafiken“ an.
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  ({ chromium } = require(process.env.PLAYWRIGHT_PFAD || '/opt/node-tools/node_modules/playwright'));
}

(async () => {
  const quelle = path.join(__dirname, 'anleitung.html');
  const ziel = path.join(__dirname, '..', 'DocScan-Anleitung.pdf');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + quelle);
  await page.waitForLoadState('networkidle');
  await page.pdf({
    path: ziel,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:Inter,Arial;font-size:8pt;color:#8a93a0;padding:0 16mm;display:flex;justify-content:space-between"><span>DocScan · Anleitung</span><span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>',
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' }
  });
  await browser.close();
  console.log('PDF erstellt: ' + ziel);
})();
