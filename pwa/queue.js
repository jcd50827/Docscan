// DocScan – Offline-Warteschlange (IndexedDB).
// iOS kennt keine Background Sync: Uploads ohne Netz landen hier und werden beim
// nächsten App-Start, beim Zurückkehren in die App und beim Ereignis „online“ gesendet.
(function () {
  'use strict';

  const DB_NAME = 'docscan';
  const STORE = 'uploads';
  let dbPromise = null;

  function oeffneDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try {
          req = indexedDB.open(DB_NAME, 1);
        } catch (err) {
          reject(err);
          return;
        }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function transaktion(modus, fn) {
    const db = await oeffneDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modus);
      const ergebnis = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(ergebnis && 'result' in ergebnis ? ergebnis.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Abgebrochen'));
    });
  }

  const Queue = {
    /** { pdfBase64, seiten, titelVorschlag } → id */
    add: (eintrag) => transaktion('readwrite', (s) => s.add({ ...eintrag, erstellt: Date.now(), versuche: 0, fehler: '' })),
    alle: () => transaktion('readonly', (s) => s.getAll()),
    anzahl: () => transaktion('readonly', (s) => s.count()).catch(() => 0),
    entfernen: (id) => transaktion('readwrite', (s) => s.delete(id)),
    aktualisieren: (eintrag) => transaktion('readwrite', (s) => s.put(eintrag))
  };

  let laeuft = null;

  /**
   * Sendet alle wartenden Uploads der Reihe nach.
   * Ohne Netz bricht sie ab; andere Fehler werden am Eintrag vermerkt und später erneut versucht.
   * @returns {Promise<{gesendet: Array, offen: number}>}
   */
  Queue.sendeAlle = function (code) {
    if (laeuft) return laeuft;
    laeuft = (async () => {
      const gesendet = [];
      let eintraege = [];
      try {
        eintraege = await Queue.alle();
      } catch (err) {
        return { gesendet, offen: 0 };
      }
      for (const e of eintraege) {
        try {
          const res = await Api.upload(code, { pdfBase64: e.pdfBase64, seiten: e.seiten, titelVorschlag: e.titelVorschlag });
          await Queue.entfernen(e.id);
          gesendet.push({ ...res.dokument, seiten: e.seiten });
        } catch (err) {
          if (err.offline || err.auth) {
            if (err.auth) throw err;
            break;
          }
          e.versuche += 1;
          e.fehler = err.message;
          await Queue.aktualisieren(e).catch(() => {});
        }
      }
      return { gesendet, offen: await Queue.anzahl() };
    })().finally(() => { laeuft = null; });
    return laeuft;
  };

  window.Queue = Queue;
})();
