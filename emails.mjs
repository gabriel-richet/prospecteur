// Prospection par email :
//  - analyserSite : lit un site existant pour y trouver l'adresse de contact et relever des défauts vérifiables
//    (pas adapté aux téléphones, pas sécurisé, date ancienne) qui justifient une proposition de refonte ;
//  - envoyerEmail : envoi par la boîte mail de l'utilisateur (SMTP) ;
//  - aEnvoyer : quelles étapes des séquences (1er email, relance, dernier message) sont dues maintenant.

import nodemailer from 'nodemailer';

const NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
// Adresses qui ne sont pas celles du commerce : images, outils techniques, exemples de formulaire
const A_ECARTER = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|wixpress|example|exemple|domain|domaine|email|mail|votredomaine|yourdomain|sentry-next|demolink|mysite|yoursite|yourwebsite|votresite|templatemonster|company|website)\.|^(nom|name|email|exemple|example|votre|your|prenom|john|jane)[.@]|noreply|no-reply|@[0-9.]+x?$/i;

async function telecharger(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { 'User-Agent': NAVIGATEUR, 'Accept-Language': 'fr' } });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return null;
    return { html: (await r.text()).slice(0, 500000), url: r.url };
  } catch { return null; }
}

// Cloudflare masque les adresses (data-cfemail) : le premier octet est la clé, le reste l'adresse.
function decoderCloudflare(hex) {
  const cle = parseInt(hex.slice(0, 2), 16);
  let s = '';
  for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ cle);
  return s;
}

function extraireEmails(html) {
  const trouves = [];
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) trouves.push(decoderCloudflare(m[1]));
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) { try { trouves.push(decodeURIComponent(m[1])); } catch { /* adresse mal encodée */ } }
  const texte = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/&#64;|&commat;/g, '@').replace(/&#46;/g, '.');
  trouves.push(...(texte.match(EMAIL) ?? []));
  return [...new Set(trouves.map((e) => e.trim().toLowerCase().replace(/[.,;:]+$/, '')))]
    .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !A_ECARTER.test(e) && e.length < 80);
}

function liensContact(html, base) {
  const liens = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (!/contact|nous-joindre|coordonn|mentions|a-propos|qui-sommes/i.test(`${m[1]} ${m[2]}`)) continue;
    try {
      const u = new URL(m[1], base);
      if (u.host === new URL(base).host && /^https?:$/.test(u.protocol)) liens.push(u.href);
    } catch { /* lien invalide */ }
  }
  return [...new Set(liens)].sort((a, b) => (/contact/i.test(b) ? 1 : 0) - (/contact/i.test(a) ? 1 : 0)).slice(0, 2);
}

/**
 * Lit un site d'entreprise. Ne renvoie que des constats vérifiables dans la page.
 * @returns {{ok: boolean, email?: string, emails?: string[], audit?: {https: boolean, mobile: boolean, annee: number|null, outil: string}}}
 */
export async function analyserSite(url) {
  const accueil = await telecharger(/^https?:/.test(url) ? url : `https://${url}`);
  if (!accueil) return { ok: false };
  const hote = new URL(accueil.url).host.replace(/^www\./, '');
  let emails = extraireEmails(accueil.html);
  if (!emails.length) {
    for (const lien of liensContact(accueil.html, accueil.url)) {
      const page = await telecharger(lien);
      if (page) emails.push(...extraireEmails(page.html));
      if (emails.length) break;
    }
  }
  emails = [...new Set(emails)];
  // On préfère une adresse au nom du site (contact@lesite.fr) à une adresse trouvée par hasard dans la page.
  emails.sort((a, b) => (b.endsWith(`@${hote}`) ? 1 : 0) - (a.endsWith(`@${hote}`) ? 1 : 0)
    || (/^(contact|info|bonjour|hello|accueil)@/.test(b) ? 1 : 0) - (/^(contact|info|bonjour|hello|accueil)@/.test(a) ? 1 : 0));

  const droits = [...accueil.html.matchAll(/(?:©|&copy;|&#169;|copyright)[^<]{0,60}/gi)].flatMap((m) => m[0].match(/20[0-3]\d/g) ?? []).map(Number);
  return {
    ok: true, email: emails[0] ?? '', emails: emails.slice(0, 5),
    audit: {
      https: accueil.url.startsWith('https://'),
      mobile: /<meta[^>]+name=["']viewport["']/i.test(accueil.html),
      annee: droits.length ? Math.max(...droits) : null,
      outil: accueil.html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,40})/i)?.[1] ?? '',
      date: new Date().toISOString().slice(0, 10),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Envoi

function transport(smtp) {
  if (process.env.PROSPECTEUR_SMTP_TEST) return nodemailer.createTransport({ jsonTransport: true }); // tests : rien ne part
  const port = Number(smtp.port) || 465;
  return nodemailer.createTransport({
    host: smtp.hote, port, secure: port === 465, auth: { user: smtp.utilisateur, pass: smtp.motDePasse },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}

function messageErreur(e) {
  if (e.code === 'EAUTH') return 'Identifiant ou mot de passe refusé par ta messagerie. Pour Gmail, il faut un « mot de passe d\'application », pas ton mot de passe habituel.';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND'].includes(e.code)) return 'Impossible de joindre le serveur d\'envoi : vérifie l\'adresse du serveur, le port et ta connexion.';
  if (e.responseCode >= 500) return `Refusé par la messagerie : ${e.response ?? e.message}`;
  return e.message;
}

// « enReponseA » : identifiant du premier email. La relance part alors comme une vraie réponse, dans le même fil.
export async function envoyerEmail(smtp, { a, objet, corps, enReponseA }) {
  try {
    const info = await transport(smtp).sendMail({
      from: { name: smtp.expediteur || smtp.utilisateur, address: smtp.utilisateur },
      to: a, subject: enReponseA ? `Re: ${objet}` : objet, text: corps,
      ...(enReponseA && { inReplyTo: enReponseA, references: enReponseA }),
      headers: { 'List-Unsubscribe': `<mailto:${smtp.utilisateur}?subject=stop>` },
    });
    return { ok: true, identifiant: info.messageId };
  } catch (e) {
    return { ok: false, erreur: messageErreur(e) };
  }
}

export const smtpConfigure = (c) => Boolean(c.smtp?.hote && c.smtp?.utilisateur && c.smtp?.motDePasse);

// ---------------------------------------------------------------------------------------------
// Séquences : 1er email, puis relances espacées, tant que le prospect n'a ni répondu ni refusé

// On n'écrit aux entreprises qu'aux heures de bureau : du lundi au vendredi, de 8 h 30 à 18 h 30.
export function heuresOuvrables(d = new Date()) {
  const minutes = d.getHours() * 60 + d.getMinutes();
  return d.getDay() >= 1 && d.getDay() <= 5 && minutes >= 510 && minutes <= 1110;
}

export const jourLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function envoyesLe(sequences, jour) {
  return Object.values(sequences).flatMap((s) => s.etapes).filter((e) => e.statut === 'envoye' && !e.manuel && e.date && jourLocal(new Date(e.date)) === jour).length;
}

// Prochaine étape d'une séquence et date à partir de laquelle elle peut partir (null si la séquence est finie ou arrêtée).
export function prochaineEtape(seq) {
  if (seq.arret) return null;
  const n = seq.etapes.findIndex((e) => e.statut !== 'envoye');
  if (n === -1) return null;
  const precedente = seq.etapes[n - 1];
  const due = n === 0 ? new Date(seq.cree) : new Date(new Date(precedente.date).getTime() + (seq.etapes[n].delaiJours ?? 4) * 864e5);
  return { n, etape: seq.etapes[n], due };
}

/** Séquences dont une étape doit partir maintenant, la plus ancienne d'abord. */
export function aEnvoyer(sequences, { maintenant = new Date(), relancesAuto = true, stop = [] } = {}) {
  return Object.values(sequences)
    .map((seq) => ({ seq, p: prochaineEtape(seq) }))
    .filter(({ seq, p }) => p && !seq.manuel && p.etape.statut !== 'erreur' && p.due <= maintenant
      && (p.n === 0 || relancesAuto || p.etape.forcee) && !stop.includes(seq.email.toLowerCase()))
    .sort((a, b) => a.p.due - b.p.due);
}
