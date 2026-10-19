// DocScan – Bildverarbeitung und PDF-Erstellung.
// Kantenerkennung/Entzerrung (jscanify + OpenCV) folgt in Meilenstein 5.
(function () {
  'use strict';

  const MAX_BREITE = 1700;
  const MAX_HOEHE = 2400;
  const JPEG_QUALITAET = 0.7;
  const ZIEL_PDF_BYTES = 3 * 1024 * 1024;

  const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';

  /** Lädt ein Foto. <img> statt createImageBitmap, weil Safari so die EXIF-Ausrichtung anwendet. */
  function ladeBild(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Das Bild konnte nicht gelesen werden.')); };
      img.src = url;
    });
  }

  /** Graustufen + Kontrast: kleinere Datei, bessere Texterkennung. */
  function dokumentFilter(ctx, w, h) {
    const bild = ctx.getImageData(0, 0, w, h);
    const d = bild.data;
    const kontrast = 1.5;
    const aufhellen = 18;
    for (let i = 0; i < d.length; i += 4) {
      const grau = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = (grau - 128) * kontrast + 128 + aufhellen;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(bild, 0, 0);
  }

  /**
   * Skaliert ein Foto auf max. 1700 px Breite, wendet optional den Filter an
   * und liefert ein JPEG als Data-URL.
   */
  async function verarbeiteSeite(file, { filter = true, qualitaet = JPEG_QUALITAET, skala = 1 } = {}) {
    const img = await ladeBild(file);
    const faktor = Math.min(1, MAX_BREITE / img.naturalWidth, MAX_HOEHE / img.naturalHeight) * skala;
    const w = Math.max(1, Math.round(img.naturalWidth * faktor));
    const h = Math.max(1, Math.round(img.naturalHeight * faktor));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: filter });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    if (filter) dokumentFilter(ctx, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', qualitaet);
    // Canvas-Speicher sofort freigeben (iOS hat ein enges Limit).
    canvas.width = canvas.height = 0;
    return { dataUrl, breite: w, hoehe: h };
  }

  let jsPdfPromise = null;
  function ladeJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!jsPdfPromise) {
      jsPdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSPDF_URL;
        s.integrity = JSPDF_SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve(window.jspdf.jsPDF);
        s.onerror = () => {
          jsPdfPromise = null;
          s.remove();
          reject(new Error('Die PDF-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.'));
        };
        document.head.appendChild(s);
      });
    }
    return jsPdfPromise;
  }

  /** Setzt die Seiten auf A4 (Hoch- oder Querformat je Bild) und liefert das PDF als Base64. */
  async function erstellePdf(seiten) {
    const JsPDF = await ladeJsPdf();
    let pdf = null;
    seiten.forEach((s) => {
      const quer = s.breite > s.hoehe;
      const pw = quer ? 297 : 210;
      const ph = quer ? 210 : 297;
      if (!pdf) pdf = new JsPDF({ orientation: quer ? 'l' : 'p', unit: 'mm', format: 'a4', compress: true });
      else pdf.addPage('a4', quer ? 'l' : 'p');
      const m = Math.min(pw / s.breite, ph / s.hoehe);
      const w = s.breite * m;
      const h = s.hoehe * m;
      pdf.addImage(s.dataUrl, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'NONE');
    });
    const dataUri = pdf.output('datauristring');
    const base64 = dataUri.substring(dataUri.indexOf(',') + 1);
    return { base64, bytes: Math.floor(base64.length * 3 / 4) };
  }

  /**
   * Komplette Pipeline: Fotos → Seiten → PDF. Liegt das PDF über 3 MB,
   * werden die Seiten einmal kleiner und stärker komprimiert neu erzeugt.
   */
  async function erstelleDokument(dateien, { filter = true, onFortschritt = () => {} } = {}) {
    const stufen = [
      { qualitaet: JPEG_QUALITAET, skala: 1 },
      { qualitaet: 0.55, skala: 0.8 }
    ];
    let pdf = null;
    for (const stufe of stufen) {
      const seiten = [];
      for (let i = 0; i < dateien.length; i++) {
        onFortschritt(`Seite ${i + 1} von ${dateien.length} wird vorbereitet …`);
        seiten.push(await verarbeiteSeite(dateien[i], { filter, ...stufe }));
      }
      onFortschritt('PDF wird erstellt …');
      pdf = await erstellePdf(seiten);
      if (pdf.bytes <= ZIEL_PDF_BYTES) break;
    }
    return pdf;
  }

  window.Scanner = { verarbeiteSeite, erstelleDokument, ladeJsPdf };
})();
