// DocScan – Bildverarbeitung, Kantenerkennung, Entzerrung und PDF-Erstellung.
// Kantenerkennung und Entzerrung mit jscanify + OpenCV.js (lazy beim ersten Scan,
// danach vom Service Worker gecacht). Ohne OpenCV wird nur auf die Ecken zugeschnitten.
(function () {
  'use strict';

  const MAX_BREITE = 1700;
  const MAX_HOEHE = 2400;
  const JPEG_QUALITAET = 0.7;
  const ZIEL_PDF_BYTES = 3 * 1024 * 1024;

  const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  const JSPDF_SRI = 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk';
  const OPENCV_URL = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/opencv.js';
  const OPENCV_SRI = 'sha384-gIQOiZ94Y7O29uYShJN17TQmC+8BFBNvRQ9dw9Uj9jTXckygNQz59FfqlrMzh3KT';
  const JSCANIFY_URL = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.js';
  const JSCANIFY_SRI = 'sha384-1lFiUI8fK3enJqIHszlQ9u3upmgE3Z0Jj0Pr9vubGa2amHhsn06NurXsHxJLX6Dz';
  const ERKENNUNG_MAX = 900;     // Kantenerkennung auf verkleinertem Bild (schnell)
  const ENTZERRUNG_MAX = 2400;   // Quelle für die Entzerrung (Speicher auf iOS schonen)

  function ladeSkript(src, integrity) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.integrity = integrity;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('Laden fehlgeschlagen: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------------------------
  // OpenCV + jscanify
  // ---------------------------------------------------------------------------
  let cvPromise = null;
  let scannerInstanz = null;
  const cvBereit = () => !!(window.cv && typeof window.cv.Mat === 'function' && typeof window.cv.imread === 'function' && window.jscanify);

  /** Lädt OpenCV (~9 MB, nur einmal) und jscanify. Liefert true/false. */
  function ladeOpenCv() {
    if (cvBereit()) return Promise.resolve(true);
    if (!cvPromise) {
      cvPromise = (async () => {
        await Promise.all([
          window.cv ? Promise.resolve() : ladeSkript(OPENCV_URL, OPENCV_SRI),
          window.jscanify ? Promise.resolve() : ladeSkript(JSCANIFY_URL, JSCANIFY_SRI)
        ]);
        // OpenCV initialisiert sein WebAssembly asynchron → warten, bis cv.Mat da ist.
        const start = Date.now();
        while (!cvBereit()) {
          if (Date.now() - start > 60000) throw new Error('OpenCV startet nicht.');
          await new Promise((r) => setTimeout(r, 100));
        }
        scannerInstanz = new window.jscanify(); // eslint-disable-line new-cap
        return true;
      })().catch((err) => {
        console.warn('Kantenerkennung nicht verfügbar:', err);
        cvPromise = null;
        return false;
      });
    }
    return cvPromise;
  }

  const ganzesBild = (w, h) => ({
    topLeftCorner: { x: 0, y: 0 },
    topRightCorner: { x: w, y: 0 },
    bottomRightCorner: { x: w, y: h },
    bottomLeftCorner: { x: 0, y: h }
  });
  const ECKEN = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'];

  function skaliereEcken(ecken, f) {
    const out = {};
    ECKEN.forEach((k) => { out[k] = { x: ecken[k].x * f, y: ecken[k].y * f }; });
    return out;
  }

  function flaeche(ecken) {
    const p = ECKEN.map((k) => ecken[k]);
    let a = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      a += p[i].x * p[j].y - p[j].x * p[i].y;
    }
    return Math.abs(a) / 2;
  }

  function aufCanvas(img, maxSeite) {
    const f = Math.min(1, maxSeite / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * f));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * f));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { canvas: c, faktor: f };
  }

  /**
   * Erkennt die Blattkanten. Liefert Ecken in Originalpixeln oder null
   * (keine OpenCV, nichts gefunden oder Fläche zu klein).
   */
  async function erkenneEcken(file) {
    if (!(await ladeOpenCv())) return null;
    const img = await ladeBild(file);
    const { canvas, faktor } = aufCanvas(img, ERKENNUNG_MAX);
    const cv = window.cv;
    let mat = null;
    try {
      mat = cv.imread(canvas);
      const kontur = scannerInstanz.findPaperContour(mat);
      if (!kontur) return null;
      const ecken = scannerInstanz.getCornerPoints(kontur);
      if (ECKEN.some((k) => !ecken[k])) return null;
      if (flaeche(ecken) < 0.2 * canvas.width * canvas.height) return null;
      return skaliereEcken(ecken, 1 / faktor);
    } catch (err) {
      console.warn('Kantenerkennung fehlgeschlagen:', err);
      return null;
    } finally {
      if (mat) mat.delete();
      canvas.width = canvas.height = 0;
    }
  }

  const abstand = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /**
   * Entzerrt das Foto auf die vier Ecken (Perspektive). Ohne OpenCV wird auf
   * das umschließende Rechteck zugeschnitten. Liefert ein Canvas.
   */
  function entzerre(img, ecken) {
    const { canvas: quelle, faktor } = aufCanvas(img, ENTZERRUNG_MAX);
    const e = skaliereEcken(ecken, faktor);
    try {
      if (cvBereit()) {
        const w = Math.round(Math.max(abstand(e.topLeftCorner, e.topRightCorner), abstand(e.bottomLeftCorner, e.bottomRightCorner)));
        const h = Math.round(Math.max(abstand(e.topLeftCorner, e.bottomLeftCorner), abstand(e.topRightCorner, e.bottomRightCorner)));
        const ziel = scannerInstanz.extractPaper(quelle, Math.max(1, w), Math.max(1, h), e);
        if (ziel) return ziel;
      }
      // Fallback: nur zuschneiden
      const xs = ECKEN.map((k) => e[k].x);
      const ys = ECKEN.map((k) => e[k].y);
      const x0 = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(quelle.width, Math.max(...xs));
      const y1 = Math.min(quelle.height, Math.max(...ys));
      const ziel = document.createElement('canvas');
      ziel.width = Math.max(1, Math.round(x1 - x0));
      ziel.height = Math.max(1, Math.round(y1 - y0));
      ziel.getContext('2d').drawImage(quelle, x0, y0, x1 - x0, y1 - y0, 0, 0, ziel.width, ziel.height);
      return ziel;
    } finally {
      quelle.width = quelle.height = 0;
    }
  }

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
  async function verarbeiteSeite(file, { filter = true, qualitaet = JPEG_QUALITAET, skala = 1, ecken = null } = {}) {
    const img = await ladeBild(file);
    const quelle = ecken ? entzerre(img, ecken) : img;
    const qw = quelle.naturalWidth || quelle.width;
    const qh = quelle.naturalHeight || quelle.height;
    const faktor = Math.min(1, MAX_BREITE / qw, MAX_HOEHE / qh) * skala;
    const w = Math.max(1, Math.round(qw * faktor));
    const h = Math.max(1, Math.round(qh * faktor));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: filter });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(quelle, 0, 0, w, h);
    if (filter) dokumentFilter(ctx, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', qualitaet);
    // Canvas-Speicher sofort freigeben (iOS hat ein enges Limit).
    canvas.width = canvas.height = 0;
    if (quelle !== img) quelle.width = quelle.height = 0;
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
  async function erstelleDokument(seiten, { filter = true, onFortschritt = () => {} } = {}) {
    // Für die Perspektiv-Entzerrung OpenCV laden, falls Ecken gesetzt sind (sonst nur Zuschnitt).
    if (seiten.some((s) => s.ecken)) await ladeOpenCv();
    const stufen = [
      { qualitaet: JPEG_QUALITAET, skala: 1 },
      { qualitaet: 0.55, skala: 0.8 }
    ];
    let pdf = null;
    for (const stufe of stufen) {
      const bilder = [];
      for (let i = 0; i < seiten.length; i++) {
        onFortschritt(`Seite ${i + 1} von ${seiten.length} wird vorbereitet …`);
        bilder.push(await verarbeiteSeite(seiten[i].file, { filter, ecken: seiten[i].ecken, ...stufe }));
      }
      onFortschritt('PDF wird erstellt …');
      pdf = await erstellePdf(bilder);
      if (pdf.bytes <= ZIEL_PDF_BYTES) break;
    }
    return pdf;
  }

  window.Scanner = {
    verarbeiteSeite, erstelleDokument, ladeJsPdf,
    ladeOpenCv, erkenneEcken, cvBereit, ganzesBild, ladeBild, ladeSkript
  };
})();
