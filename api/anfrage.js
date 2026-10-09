/**
 * Anfrage-Versand für die App "Charging Trends 2027" (Vercel-Funktion, ersetzt anfrage.php)
 * Empfängt die Formulardaten (JSON) und schickt sie per Resend an den Anzeigenverkauf.
 *
 * Umgebungsvariablen in Vercel:
 *   RESEND_API_KEY  – API-Schlüssel aus resend.com (Pflicht)
 *   ANFRAGE_FROM    – Absender auf einer in Resend bestätigten Domain,
 *                     z. B. "electrified Anfrage <noreply@electrifiedmagazin.de>"
 *   ANFRAGE_TO      – Empfänger (Standard: mathias.herbig@electrifiedmagazin.de)
 */

const EMPFAENGER = process.env.ANFRAGE_TO || 'mathias.herbig@electrifiedmagazin.de';
const ABSENDER = process.env.ANFRAGE_FROM || 'electrified Anfrage <noreply@electrifiedmagazin.de>';
const BETREFF = 'Anfrage Charging Trends 2027';

// Nur Anfragen von den eigenen Seiten annehmen
const ERLAUBT = [
  /^https:\/\/chargingtrends\.electrified-labs\.com(\/|$)/i,
  /^https:\/\/charging-trends(-[a-z0-9-]+)?\.vercel\.app(\/|$)/i,
  /^https?:\/\/(www\.)?electrifiedmagazin\.de(\/|$)/i,
  /^http:\/\/localhost(:\d+)?(\/|$)/i,
];

// Einfache Bremse: höchstens eine Anfrage pro 30 Sekunden je IP (pro Funktionsinstanz)
const zuletzt = new Map();

function antwort(res, code, daten) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(code).send(JSON.stringify(daten));
}

function feld(d, key, max = 500) {
  const wert = d[key] == null ? '' : String(d[key]).trim();
  return [...wert].slice(0, max).join('');
}
const einzeilig = (s) => s.replace(/[\r\n\t]+/g, ' ').trim();
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return antwort(res, 405, { ok: false, error: 'Nur POST erlaubt.' });
  }

  const herkunft = req.headers.origin || req.headers.referer || '';
  if (herkunft !== '' && !ERLAUBT.some((re) => re.test(herkunft))) {
    return antwort(res, 403, { ok: false, error: 'Anfrage nicht erlaubt.' });
  }

  let d = req.body;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { d = null; }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return antwort(res, 400, { ok: false, error: 'Ungültige Daten.' });
  }

  // Spam-Falle: Dieses Feld ist für Menschen unsichtbar
  if (d.website) {
    return antwort(res, 200, { ok: true });
  }

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const jetzt = Date.now();
  if (zuletzt.has(ip) && jetzt - zuletzt.get(ip) < 30000) {
    return antwort(res, 429, { ok: false, error: 'Bitte warten Sie einen Moment und senden Sie dann erneut.' });
  }

  const firma = einzeilig(feld(d, 'firma', 200));
  const name = einzeilig(feld(d, 'name', 200));
  const email = einzeilig(feld(d, 'email', 200));
  const telefon = einzeilig(feld(d, 'telefon', 60));
  const nachricht = feld(d, 'nachricht', 3000);
  const auswahl = feld(d, 'auswahl', 4000);
  const dsgvo = !!d.datenschutz;

  if (firma === '' || name === '' || !emailOk(email)) {
    return antwort(res, 422, { ok: false, error: 'Bitte Firma, Ansprechpartner und eine gültige E-Mail-Adresse angeben.' });
  }
  if (!dsgvo) {
    return antwort(res, 422, { ok: false, error: 'Bitte der Verarbeitung Ihrer Angaben zustimmen.' });
  }

  const gesendetAm = new Date().toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');

  let text = 'Neue Anfrage über die App „Charging Trends 2027“\n';
  text += '==============================================\n\n';
  text += `Firma:           ${firma}\n`;
  text += `Ansprechpartner: ${name}\n`;
  text += `E-Mail:          ${email}\n`;
  text += `Telefon:         ${telefon !== '' ? telefon : '–'}\n\n`;
  text += `Auswahl / Kalkulation\n---------------------\n${auswahl}\n\n`;
  text += `Nachricht\n---------\n${nachricht !== '' ? nachricht : '–'}\n\n`;
  text += 'Datenschutz-Einwilligung: ja\n';
  text += `Gesendet: ${gesendetAm} Uhr\n`;

  // PDF mit Anschreiben und Kalkulation (im Browser erzeugt)
  let pdf = '';
  if (typeof d.pdf === 'string' && d.pdf !== '') {
    const bin = Buffer.from(d.pdf, 'base64');
    if (bin.length > 4 && bin.length < 3000000 && bin.subarray(0, 4).toString('latin1') === '%PDF') {
      pdf = bin.toString('base64');
    }
  }
  let pdfname = feld(d, 'pdfname', 120).replace(/[^A-Za-z0-9ÄÖÜäöüß._-]+/g, '-');
  if (pdfname === '' || !pdfname.endsWith('.pdf')) {
    pdfname = 'Anfrage_Charging-Trends-2027.pdf';
  }
  if (pdf !== '') {
    text = 'Im Anhang: Anschreiben und Kalkulation als PDF.\n\n' + text;
  }

  const fehler = { ok: false, error: `Die Anfrage konnte nicht gesendet werden. Bitte schreiben Sie an ${EMPFAENGER}.` };

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY fehlt');
    return antwort(res, 500, fehler);
  }

  const mail = {
    from: ABSENDER,
    to: [EMPFAENGER],
    reply_to: email,
    subject: `${BETREFF} – ${firma}`,
    text,
  };
  if (pdf !== '') {
    mail.attachments = [{ filename: pdfname, content: pdf }];
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mail),
    });
    if (!r.ok) {
      console.error('Resend-Fehler', r.status, await r.text().catch(() => ''));
      return antwort(res, 500, fehler);
    }
  } catch (err) {
    console.error('Resend nicht erreichbar', err);
    return antwort(res, 500, fehler);
  }

  zuletzt.set(ip, jetzt);
  return antwort(res, 200, { ok: true });
}
