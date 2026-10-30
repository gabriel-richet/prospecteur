// Serveur local du Prospecteur : accessible uniquement depuis cet ordinateur (127.0.0.1).
// Lancement : double-clic sur LANCER.bat (ou « node serveur.mjs »), le navigateur s'ouvre tout seul.

process.env.UV_THREADPOOL_SIZE ??= '64'; // plus de requêtes réseau en parallèle (4 par défaut)

import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rechercher, listeMetiers, testerCleGoogle, avisGoogle, adresseDepuisPosition, normaliser } from './moteur.mjs';
import { calculerRappels, notifier, demarrageActif, reglerDemarrage } from './rappels.mjs';
import { genererScript, testerCleAnthropic, MODELES, MODELE_DEFAUT } from './ia.mjs';
import { analyserSite, envoyerEmail, smtpConfigure, heuresOuvrables, envoyesLe, aEnvoyer, prochaineEtape, jourLocal as jourEmail } from './emails.mjs';

const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
// PROSPECTEUR_DONNEES (avec PORT) permet de lancer une copie de test sans toucher aux vraies données.
const DONNEES = process.env.PROSPECTEUR_DONNEES || path.join(DOSSIER, 'donnees');
const RECHERCHES = path.join(DONNEES, 'recherches');
const FICHIER_PROSPECTS = path.join(DONNEES, 'prospects.json');
const FICHIER_CONFIG = path.join(DONNEES, 'config.json');
const PORT = Number(process.env.PORT) || 4321;

// ---------------------------------------------------------------------------------------------
// Stockage (fichiers JSON dans le dossier « donnees »)

async function lireJSON(fichier, defaut) {
  try { return JSON.parse(await readFile(fichier, 'utf8')); } catch { return defaut; }
}

async function ecrireJSON(fichier, valeur) {
  await mkdir(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp`;
  await writeFile(tmp, JSON.stringify(valeur, null, 2));
  await rename(tmp, fichier);
}

// Les écritures sur un même fichier passent les unes après les autres (pas de perte si 2 modifs arrivent en même temps).
const files = new Map();
function enFile(cle, tache) {
  const suite = (files.get(cle) ?? Promise.resolve()).then(tache, tache);
  files.set(cle, suite.catch(() => {}));
  return suite;
}

// Compteur de requêtes Google du mois : l'outil s'arrête avant de dépasser la limite fixée dans Réglages
// (Google offre environ 1 000 requêtes par mois pour les informations utilisées ici).
const FICHIER_USAGE = path.join(DONNEES, 'usage-google.json');
const LIMITE_GOOGLE_DEFAUT = 900;
const moisCourant = () => new Date().toISOString().slice(0, 7);
const limiteGoogle = (c) => c.limiteGoogle ?? LIMITE_GOOGLE_DEFAUT;

async function requetesDuMois() {
  const u = await lireJSON(FICHIER_USAGE, {});
  return u.mois === moisCourant() ? u.requetes : 0;
}

function compterRequetesGoogle(n) {
  if (!n) return Promise.resolve();
  return enFile(FICHIER_USAGE, async () => {
    const u = await lireJSON(FICHIER_USAGE, {});
    const historique = u.historique ?? {};
    const requetes = (u.mois === moisCourant() ? u.requetes : 0) + n;
    historique[moisCourant()] = requetes;
    await ecrireJSON(FICHIER_USAGE, { mois: moisCourant(), requetes, historique });
  });
}

// Dépense IA du mois (en dollars) : même principe que pour Google, l'outil s'arrête au plafond fixé dans Réglages.
const FICHIER_USAGE_IA = path.join(DONNEES, 'usage-ia.json');
const LIMITE_IA_DEFAUT = 5;
const limiteIA = (c) => c.limiteIA ?? LIMITE_IA_DEFAUT;

async function depenseIADuMois() {
  const u = await lireJSON(FICHIER_USAGE_IA, {});
  return u.mois === moisCourant() ? u : { dollars: 0, generations: 0 };
}

function compterDepenseIA(dollars, generation = true) {
  if (!dollars) return Promise.resolve();
  return enFile(FICHIER_USAGE_IA, async () => {
    const u = await depenseIADuMois();
    await ecrireJSON(FICHIER_USAGE_IA, { mois: moisCourant(), dollars: u.dollars + dollars, generations: u.generations + (generation ? 1 : 0) });
  });
}

// ---------------------------------------------------------------------------------------------
// Emails de prospection : séquences (1er email + relances), envoyées une par minute au maximum,
// aux heures de bureau, dans la limite du plafond quotidien, jamais vers la liste « ne plus contacter ».
const FICHIER_EMAILS = path.join(DONNEES, 'emails.json');
const EMAILS_PAR_JOUR_DEFAUT = 15;
const lireEmails = async () => ({ sequences: {}, stop: [], ...(await lireJSON(FICHIER_EMAILS, {})) });
const modifierEmails = (fn) => enFile(FICHIER_EMAILS, async () => { const d = await lireEmails(); const r = await fn(d); await ecrireJSON(FICHIER_EMAILS, d); return r; });
const ADRESSE_VALIDE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
// Montée progressive : une boîte qui écrit d'un coup à 25 inconnus se fait classer comme spam. On commence à 5 par jour,
// puis +5 tous les trois jours d'envoi, jusqu'au plafond choisi. Désactivable dans Réglages.
const PALIERS = [5, 5, 5, 10, 10, 10, 15, 15, 15, 20, 20, 20];
function plafondDuJour(c, sequences, maintenant = new Date()) {
  const max = c.emailsParJour ?? EMAILS_PAR_JOUR_DEFAUT;
  if (c.monteeProgressive === false) return max;
  const jours = new Set(Object.values(sequences).flatMap((s) => s.etapes)
    .filter((e) => e.statut === 'envoye' && !e.manuel && e.date).map((e) => jourEmail(new Date(e.date))));
  jours.delete(jourEmail(maintenant));
  return Math.min(max, PALIERS[jours.size] ?? max);
}
const TROU_A_REMPLIR = /\[[^\]\n]{2,60}\]/; // « [Ton prénom] », « [mardi ou jeudi] » : un email incomplet ne doit jamais partir

// Garde une trace de chaque email dans la fiche du prospect (historique + statut « Contacté »).
function noterEmailDansFiche(seq, n, objet) {
  return enFile(FICHIER_PROSPECTS, async () => {
    const tous = await lireJSON(FICHIER_PROSPECTS, {});
    const p = tous[seq.id] ?? { ligne: seq.ligne };
    p.historique = [{ date: new Date().toISOString(), type: 'message', resultat: 'email', note: `Email ${n + 1}/${seq.etapes.length} envoyé à ${seq.email} : ${objet}` }, ...(p.historique ?? [])];
    if (!p.statut || p.statut === 'a-contacter') p.statut = 'appele';
    p.email ??= seq.email;
    tous[seq.id] = { ...p, maj: new Date().toISOString() };
    await ecrireJSON(FICHIER_PROSPECTS, tous);
  });
}

let envoiEnCours = false;
async function verifierEmails() {
  if (envoiEnCours) return;
  envoiEnCours = true;
  try {
    const test = Boolean(process.env.PROSPECTEUR_SMTP_TEST);
    const c = await lireJSON(FICHIER_CONFIG, {});
    const maintenant = new Date();
    if (!test && (!smtpConfigure(c) || !heuresOuvrables(maintenant))) return;
    const donnees = await lireEmails();
    if (envoyesLe(donnees.sequences, jourEmail(maintenant)) >= plafondDuJour(c, donnees.sequences, maintenant)) return;
    const [suivant] = aEnvoyer(donnees.sequences, { maintenant, relancesAuto: c.relancesAuto !== false, stop: donnees.stop });
    if (!suivant) return;
    const { seq, p } = suivant;
    const r = await envoyerEmail(c.smtp ?? {}, {
      a: seq.email, objet: p.etape.objet, corps: p.etape.corps,
      enReponseA: p.n > 0 ? seq.etapes[0].identifiant : undefined,
    });
    await modifierEmails((d) => {
      const e = d.sequences[seq.id]?.etapes[p.n];
      if (!e) return;
      if (r.ok) {
        Object.assign(e, { statut: 'envoye', date: new Date().toISOString(), identifiant: r.identifiant });
        delete e.forcee; delete e.erreur;
        if (p.n === seq.etapes.length - 1) d.sequences[seq.id].arret = 'termine';
      } else {
        Object.assign(e, { statut: 'erreur', erreur: r.erreur });
      }
    });
    if (r.ok) await noterEmailDansFiche(seq, p.n, p.etape.objet);
    else console.error(`Email non envoyé à ${seq.email} :`, r.erreur);
  } catch (e) {
    console.error('Emails :', e.message);
  } finally {
    envoiEnCours = false;
  }
}

// Rappels : toutes les minutes, on regarde s'il y a un rendez-vous ou des relances à signaler.
const FICHIER_RAPPELS = path.join(DONNEES, 'rappels-envoyes.json');
const ADRESSE = `http://localhost:${PORT}`;

async function verifierRappels() {
  try {
    const [prospects, envoyes] = await Promise.all([lireJSON(FICHIER_PROSPECTS, {}), lireJSON(FICHIER_RAPPELS, {})]);
    const rappels = calculerRappels(prospects, new Date(), envoyes, ADRESSE);
    if (!rappels.length) return;
    for (const r of rappels) {
      const resultat = await notifier(r);
      if (!resultat.ok) { console.error('Notification impossible :', resultat.erreur); continue; }
      for (const cle of r.cles) envoyes[cle] = Date.now();
    }
    // On oublie les rappels de plus de 60 jours pour que le fichier ne grossisse pas indéfiniment.
    for (const [cle, date] of Object.entries(envoyes)) if (Date.now() - date > 60 * 864e5) delete envoyes[cle];
    await ecrireJSON(FICHIER_RAPPELS, envoyes);
  } catch (e) {
    console.error('Rappels :', e.message);
  }
}

const idRecherche = (meta) => [meta.metier, normaliser(meta.ville).replace(/ /g, '-'), meta.rayon ? `${meta.rayon}km` : 'ville', meta.mode].join('_');

// ---------------------------------------------------------------------------------------------
// HTTP

function envoyerJSON(res, statut, donnees) {
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(donnees));
}

async function lireCorps(req) {
  let corps = '';
  for await (const morceau of req) {
    corps += morceau;
    if (corps.length > 5e6) throw new Error('Requête trop volumineuse');
  }
  return corps ? JSON.parse(corps) : {};
}

const routes = {
  'GET /api/ping': async () => ({ ok: true, app: 'prospecteur' }),

  'GET /api/metiers': async () => listeMetiers(),

  'GET /api/config': async () => {
    const c = await lireJSON(FICHIER_CONFIG, {});
    return {
      aCleGoogle: Boolean(c.cleGoogle),
      cleApercu: c.cleGoogle ? `${c.cleGoogle.slice(0, 6)}…${c.cleGoogle.slice(-4)}` : '',
      profil: c.profil ?? {},
      google: { utilisees: await requetesDuMois(), limite: limiteGoogle(c) },
      rappels: { auDemarrage: demarrageActif() },
      smtp: { configure: smtpConfigure(c), hote: c.smtp?.hote ?? '', port: c.smtp?.port ?? 465, utilisateur: c.smtp?.utilisateur ?? '', expediteur: c.smtp?.expediteur ?? '' },
      ia: {
        aCle: Boolean(c.cleAnthropic),
        cleApercu: c.cleAnthropic ? `${c.cleAnthropic.slice(0, 10)}…${c.cleAnthropic.slice(-4)}` : '',
        modele: MODELES[c.modeleIA] ? c.modeleIA : MODELE_DEFAUT,
        modeles: Object.entries(MODELES).map(([id, m]) => ({ id, label: m.label })),
        limite: limiteIA(c), ...(await depenseIADuMois()),
      },
    };
  },

  'POST /api/ia/tester': async (req) => {
    const { cle } = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    const aTester = (cle ?? '').trim() || c.cleAnthropic;
    if (!aTester) return { ok: false, message: 'Aucune clé à tester.' };
    const r = await testerCleAnthropic(aTester, MODELES[c.modeleIA] ? c.modeleIA : MODELE_DEFAUT);
    await compterDepenseIA(r.cout, false);
    return r;
  },

  'POST /api/ia/script': async (req) => {
    const { prospect } = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    if (!c.cleAnthropic) return { ok: false, message: 'Ajoute d\'abord ta clé Anthropic dans l\'onglet Réglages.' };
    if (!prospect?.nom) return { ok: false, message: 'Fiche prospect manquante.' };
    const depense = await depenseIADuMois();
    if (depense.dollars >= limiteIA(c)) return { ok: false, message: `Plafond IA du mois atteint (${limiteIA(c)} $). Tu peux le relever dans Réglages.` };
    const r = await genererScript({ cle: c.cleAnthropic, modele: c.modeleIA, prospect, profil: c.profil ?? {} });
    await compterDepenseIA(r.cout);
    return { ...r, date: new Date().toISOString() };
  },

  // --- Emails de prospection ---
  'GET /api/emails': async () => {
    const [d, c] = await Promise.all([lireEmails(), lireJSON(FICHIER_CONFIG, {})]);
    const sequences = Object.fromEntries(Object.entries(d.sequences).map(([id, s]) => {
      const p = prochaineEtape(s);
      return [id, { ...s, ligne: undefined, prochaine: p && { n: p.n, due: p.due.toISOString() } }];
    }));
    return {
      sequences, stop: d.stop, envoyesAujourdhui: envoyesLe(d.sequences, jourEmail(new Date())),
      parJour: plafondDuJour(c, d.sequences), parJourMax: c.emailsParJour ?? EMAILS_PAR_JOUR_DEFAUT,
      monteeProgressive: c.monteeProgressive !== false, relancesAuto: c.relancesAuto !== false,
      configure: smtpConfigure(c), ouvrable: heuresOuvrables(),
    };
  },

  // Crée les séquences validées par l'utilisateur. « manuel » : il a envoyé le 1er email lui-même depuis sa messagerie.
  'POST /api/emails/sequences': async (req) => {
    const { items = [] } = await lireCorps(req);
    const refuses = []; const crees = [];
    await modifierEmails((d) => {
      for (const it of items) {
        const email = String(it.email ?? '').trim().toLowerCase();
        const refuser = (raison) => refuses.push({ id: it.id, nom: it.nom, raison });
        if (!ADRESSE_VALIDE.test(email)) { refuser('adresse email invalide'); continue; }
        if (d.stop.includes(email)) { refuser('dans la liste « ne plus contacter »'); continue; }
        if (d.sequences[it.id] && !['erreur'].includes(d.sequences[it.id].arret)) { refuser('déjà contacté par email'); continue; }
        if (Object.values(d.sequences).some((s) => s.email === email && s.id !== it.id)) { refuser('cette adresse a déjà reçu un email pour une autre fiche'); continue; }
        if (!Array.isArray(it.etapes) || !it.etapes.length || it.etapes.some((e) => !e.objet || !e.corps)) { refuser('email vide'); continue; }
        if (it.etapes.some((e) => TROU_A_REMPLIR.test(e.corps) || TROU_A_REMPLIR.test(e.objet))) { refuser('texte incomplet (il reste des crochets à remplir : complète l\'onglet Profil)'); continue; }
        const maintenant = new Date().toISOString();
        d.sequences[it.id] = {
          id: it.id, nom: it.nom, email, type: it.type === 'refonte' ? 'refonte' : 'creation', variante: String(it.variante ?? '').slice(0, 20), cree: maintenant, manuel: Boolean(it.manuel), ligne: it.ligne, arret: null,
          etapes: it.etapes.slice(0, 3).map((e, n) => ({
            objet: String(e.objet), corps: String(e.corps), delaiJours: Number(e.delaiJours) || 4,
            ...(it.manuel && n === 0 ? { statut: 'envoye', date: maintenant, manuel: true } : { statut: 'attente' }),
          })),
        };
        crees.push(d.sequences[it.id]);
      }
    });
    for (const s of crees.filter((x) => x.manuel)) await noterEmailDansFiche(s, 0, s.etapes[0].objet);
    return { crees: crees.length, refuses };
  },

  'POST /api/emails/action': async (req) => {
    const { id, action } = await lireCorps(req);
    let aNoter = null;
    const resultat = await modifierEmails((d) => {
      const s = d.sequences[id];
      if (!s) return { ok: false, message: 'Séquence introuvable.' };
      const p = prochaineEtape(s);
      if (action === 'repondu') s.arret = 'repondu';
      else if (action === 'stop') { s.arret = 'stop'; if (!d.stop.includes(s.email)) d.stop.push(s.email); }
      else if (action === 'rebond') { s.arret = 'rebond'; if (!d.stop.includes(s.email)) d.stop.push(s.email); } // adresse inexistante
      else if (action === 'reprendre') s.arret = null;
      else if (action === 'relancer' && p) p.etape.forcee = true; // partira au prochain passage, même si les relances automatiques sont coupées
      else if (action === 'reessayer' && p) { p.etape.statut = 'attente'; delete p.etape.erreur; }
      else if (action === 'marquer-envoye' && p) { // relance envoyée à la main depuis sa messagerie
        Object.assign(p.etape, { statut: 'envoye', date: new Date().toISOString(), manuel: true });
        if (p.n === s.etapes.length - 1) s.arret = 'termine';
        aNoter = { seq: s, n: p.n, objet: p.etape.objet };
      } else if (action === 'supprimer') {
        if (s.etapes.some((e) => e.statut === 'envoye')) return { ok: false, message: 'Un email est déjà parti : arrête la séquence au lieu de la supprimer.' };
        delete d.sequences[id];
      } else return { ok: false, message: 'Action impossible.' };
      return { ok: true };
    });
    if (aNoter) await noterEmailDansFiche(aNoter.seq, aNoter.n, aNoter.objet);
    if (resultat.ok && action === 'stop') {
      await enFile(FICHIER_PROSPECTS, async () => {
        const tous = await lireJSON(FICHIER_PROSPECTS, {});
        if (tous[id]) { Object.assign(tous[id], { statut: 'refus', relance: '' }); await ecrireJSON(FICHIER_PROSPECTS, tous); }
      });
    }
    return resultat;
  },

  'POST /api/emails/stop': async (req) => {
    const { email, retirer } = await lireCorps(req);
    const e = String(email ?? '').trim().toLowerCase();
    if (!ADRESSE_VALIDE.test(e)) return { ok: false, message: 'Adresse invalide.' };
    await modifierEmails((d) => { d.stop = retirer ? d.stop.filter((x) => x !== e) : [...new Set([...d.stop, e])]; });
    return { ok: true };
  },

  'POST /api/emails/tester': async (req) => {
    const essai = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    const smtp = { ...c.smtp, ...Object.fromEntries(Object.entries(essai.smtp ?? {}).filter(([, v]) => v !== '' && v !== undefined)) };
    if (!smtp.hote || !smtp.utilisateur || !smtp.motDePasse) return { ok: false, erreur: 'Remplis le serveur, l\'adresse et le mot de passe.' };
    const r = await envoyerEmail(smtp, {
      a: smtp.utilisateur, objet: 'Test du Prospecteur',
      corps: 'Si tu lis ce message, l\'envoi d\'emails depuis le Prospecteur fonctionne.\n\nCe message n\'a été envoyé qu\'à toi.',
    });
    return r.ok ? { ok: true, message: `Email de test envoyé à ${smtp.utilisateur} : vérifie ta boîte de réception.` } : r;
  },

  // Envoie un exemplaire d'un email de prospection à une adresse de l'utilisateur, pour voir où il arrive (réception ou spam).
  'POST /api/emails/essai': async (req) => {
    const { a, objet, corps } = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    if (!smtpConfigure(c)) return { ok: false, erreur: 'Branche d\'abord ta boîte mail dans Réglages.' };
    if (!ADRESSE_VALIDE.test(String(a ?? ''))) return { ok: false, erreur: 'Adresse invalide.' };
    if (!objet || !corps || TROU_A_REMPLIR.test(corps)) return { ok: false, erreur: 'Email incomplet : complète l\'onglet Profil.' };
    return envoyerEmail(c.smtp, { a: String(a).trim(), objet: String(objet), corps: String(corps) });
  },

  // Lit les sites des entreprises d'une recherche : adresse de contact + défauts vérifiables (pour proposer une refonte).
  'POST /api/emails/analyser-sites': async (req) => {
    const { id } = await lireCorps(req);
    if (!/^[\w.-]+$/.test(String(id))) return { ok: false, message: 'Recherche invalide.' };
    const fichier = path.join(RECHERCHES, `${id}.json`);
    const recherche = await lireJSON(fichier, null);
    if (!recherche) return { ok: false, message: 'Recherche introuvable.' };
    const aFaire = recherche.lignes.filter((l) => l.site?.statut === 'oui' && l.site.url && !l.audit);
    const lot = aFaire.slice(0, 150);
    let trouves = 0;
    for (let i = 0; i < lot.length; i += 8) {
      await Promise.all(lot.slice(i, i + 8).map(async (l) => {
        const r = await analyserSite(l.site.url);
        l.audit = r.ok ? r.audit : { injoignable: true, date: new Date().toISOString().slice(0, 10) };
        if (!r.ok || !r.email) return;
        // Site seulement déduit du nom (possible homonyme) : on garde l'adresse à part, elle ne servira qu'après vérification.
        if (!/^(OpenStreetMap|Fiche Google)/.test(l.site.source ?? '')) l.audit.emailSite = r.email;
        else if (!l.email) { l.email = r.email; l.emailSource = 'site'; trouves++; }
      }));
    }
    await ecrireJSON(fichier, recherche);
    return { ok: true, analyses: lot.length, trouves, restants: aFaire.length - lot.length };
  },

  'GET /api/adresse': async (req, url) => adresseDepuisPosition(url.searchParams.get('lat'), url.searchParams.get('lon')),

  'POST /api/avis': async (req) => {
    const { nom, adresse } = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    if (!c.cleGoogle) return { ok: false, message: 'Il faut une clé Google (onglet Réglages) pour récupérer les avis automatiquement.' };
    if (await requetesDuMois() >= limiteGoogle(c)) return { ok: false, message: 'Quota Google du mois atteint (voir Réglages).' };
    await compterRequetesGoogle(1);
    return avisGoogle(c.cleGoogle, String(nom ?? ''), String(adresse ?? ''));
  },

  'PUT /api/rappels/demarrage': async (req) => {
    const { actif } = await lireCorps(req);
    const r = await reglerDemarrage(Boolean(actif), DOSSIER);
    return { ok: r.ok, erreur: r.erreur, auDemarrage: demarrageActif() };
  },

  'POST /api/rappels/test': async () => notifier({
    titre: 'Test du Prospecteur',
    texte: 'Les rappels fonctionnent : tu recevras ce type de message avant chaque rendez-vous.',
    url: ADRESSE,
  }),

  'POST /api/arreter': async () => {
    setTimeout(() => process.exit(0), 300);
    return { ok: true };
  },

  'PUT /api/config': async (req) => {
    const maj = await lireCorps(req);
    return enFile(FICHIER_CONFIG, async () => {
      const c = await lireJSON(FICHIER_CONFIG, {});
      if (maj.profil) c.profil = { ...c.profil, ...maj.profil };
      if (maj.limiteGoogle !== undefined) c.limiteGoogle = Math.max(0, Math.round(Number(maj.limiteGoogle) || 0));
      if (maj.limiteIA !== undefined) c.limiteIA = Math.max(0, Number(maj.limiteIA) || 0);
      if (maj.smtp) { // un mot de passe laissé vide = on garde l'ancien
        const { motDePasse, ...reste } = maj.smtp;
        c.smtp = { ...c.smtp, ...reste, ...(motDePasse ? { motDePasse: String(motDePasse).replace(/\s/g, '') } : {}) };
      }
      if (maj.supprimerSmtp) delete c.smtp;
      if (maj.emailsParJour !== undefined) c.emailsParJour = Math.min(50, Math.max(1, Math.round(Number(maj.emailsParJour) || EMAILS_PAR_JOUR_DEFAUT)));
      if (maj.relancesAuto !== undefined) c.relancesAuto = Boolean(maj.relancesAuto);
      if (maj.monteeProgressive !== undefined) c.monteeProgressive = Boolean(maj.monteeProgressive);
      if (MODELES[maj.modeleIA]) c.modeleIA = maj.modeleIA;
      if (typeof maj.cleAnthropic === 'string') {
        if (maj.cleAnthropic.trim()) c.cleAnthropic = maj.cleAnthropic.trim(); else delete c.cleAnthropic;
      }
      if (typeof maj.cleGoogle === 'string') {
        if (maj.cleGoogle.trim()) c.cleGoogle = maj.cleGoogle.trim(); else delete c.cleGoogle;
      }
      await ecrireJSON(FICHIER_CONFIG, c);
      return { ok: true };
    });
  },

  'POST /api/config/tester-cle': async (req) => {
    const { cle } = await lireCorps(req);
    const c = await lireJSON(FICHIER_CONFIG, {});
    const aTester = (cle ?? '').trim() || c.cleGoogle;
    if (!aTester) return { ok: false, message: 'Aucune clé à tester.' };
    await compterRequetesGoogle(1);
    return testerCleGoogle(aTester);
  },

  'GET /api/recherches': async () => {
    await mkdir(RECHERCHES, { recursive: true });
    const fichiers = (await readdir(RECHERCHES)).filter((f) => f.endsWith('.json'));
    const metas = await Promise.all(fichiers.map(async (f) => ({ id: f.slice(0, -5), ...(await lireJSON(path.join(RECHERCHES, f), {})).meta })));
    return metas.filter((m) => m.date).sort((a, b) => b.date.localeCompare(a.date));
  },

  'GET /api/prospects': async () => lireJSON(FICHIER_PROSPECTS, {}),
};

// Routes avec paramètre
async function routeDynamique(req, url) {
  const m = url.pathname.match(/^\/api\/(recherches|prospects)\/([^/]+)$/);
  if (!m) return undefined;
  const id = decodeURIComponent(m[2]);
  if (m[1] === 'recherches') {
    if (!/^[\w.-]+$/.test(id)) return { statut: 400, donnees: { erreur: 'Identifiant invalide' } };
    const fichier = path.join(RECHERCHES, `${id}.json`);
    if (req.method === 'GET') {
      const r = await lireJSON(fichier, null);
      return r ? { donnees: { id, ...r } } : { statut: 404, donnees: { erreur: 'Recherche introuvable' } };
    }
    if (req.method === 'DELETE') { await unlink(fichier).catch(() => {}); return { donnees: { ok: true } }; }
  }
  if (m[1] === 'prospects' && req.method === 'PUT') {
    const maj = await lireCorps(req);
    return enFile(FICHIER_PROSPECTS, async () => {
      const tous = await lireJSON(FICHIER_PROSPECTS, {});
      tous[id] = { ...tous[id], ...maj, maj: new Date().toISOString() };
      await ecrireJSON(FICHIER_PROSPECTS, tous);
      return { donnees: tous[id] };
    });
  }
  return undefined;
}

// Recherche en direct : le navigateur reçoit la progression au fur et à mesure (Server-Sent Events).
async function fluxRecherche(req, res, url) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const envoyer = (evenement, donnees) => res.write(`event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`);
  try {
    const c = await lireJSON(FICHIER_CONFIG, {});
    const resultat = await rechercher({
      ville: url.searchParams.get('ville') ?? '',
      metier: url.searchParams.get('metier') || 'tous',
      rayon: url.searchParams.get('rayon'),
      cleGoogle: url.searchParams.get('mode') === 'gratuit' ? null : c.cleGoogle,
      budgetGoogle: limiteGoogle(c) - await requetesDuMois(),
      dossierCache: path.join(DONNEES, 'cache'),
    }, (pourcent, message) => envoyer('progres', { pourcent, message }));
    await compterRequetesGoogle(resultat.meta.requetesGoogle);
    const id = idRecherche(resultat.meta);
    await ecrireJSON(path.join(RECHERCHES, `${id}.json`), resultat);
    envoyer('fin', { id, ...resultat });
  } catch (e) {
    console.error(e);
    envoyer('erreur', { message: e.message });
  }
  res.end();
}

const serveur = http.createServer(async (req, res) => {
  // Protection : on n'accepte que les pages ouvertes depuis cet ordinateur.
  const hote = (req.headers.host ?? '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(hote)) { res.writeHead(403); res.end('Accès refusé'); return; }
  // … et qu'aucun autre site web ouvert dans le navigateur ne puisse piloter l'outil.
  const origine = req.headers.origin;
  if (origine && ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(origine)) { res.writeHead(403); res.end('Accès refusé'); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(path.join(DOSSIER, 'public', 'index.html')));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/recherche') { await fluxRecherche(req, res, url); return; }
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) { envoyerJSON(res, 200, await route(req, url)); return; }
    const dyn = await routeDynamique(req, url);
    if (dyn) { envoyerJSON(res, dyn.statut ?? 200, dyn.donnees); return; }
    envoyerJSON(res, 404, { erreur: 'Introuvable' });
  } catch (e) {
    console.error(e);
    envoyerJSON(res, 500, { erreur: e.message });
  }
});

function ouvrirNavigateur(adresse) {
  const commande = process.platform === 'win32' ? `start "" "${adresse}"` : process.platform === 'darwin' ? `open "${adresse}"` : `xdg-open "${adresse}"`;
  exec(commande);
}

serveur.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Déjà lancé (deuxième double-clic) : on ouvre simplement le navigateur.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`, { headers: { host: `localhost:${PORT}` } });
    if ((await r.json()).app === 'prospecteur') {
      console.log('Le Prospecteur tourne déjà.');
      if (!process.argv.includes('--sans-navigateur')) ouvrirNavigateur(ADRESSE);
      setTimeout(() => process.exit(0), 500);
      return;
    }
  } catch { /* le port est pris par autre chose */ }
  console.error(`Le port ${PORT} est déjà utilisé par un autre programme. Ferme-le ou lance avec un autre port (set PORT=4322).`);
  process.exit(1);
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`${new Date().toLocaleString('fr-FR')}  Prospecteur lancé : ${ADRESSE}`);
  if (!process.argv.includes('--sans-navigateur')) ouvrirNavigateur(ADRESSE);
  setTimeout(verifierRappels, 5000);
  setInterval(verifierRappels, 60000);
  // Un email par minute au plus : l'envoi reste lent et régulier, comme le ferait une personne.
  setInterval(verifierEmails, Number(process.env.PROSPECTEUR_INTERVALLE_EMAILS) || 60000);
});
