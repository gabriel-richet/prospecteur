// Script d'appel sur mesure, rédigé par Claude (API Anthropic) à partir de la fiche du prospect.
// Facultatif : ne fonctionne que si une clé API Anthropic est enregistrée dans Réglages.

import Anthropic from '@anthropic-ai/sdk';

// Prix en dollars par million de tokens (entrée / sortie), pour afficher le coût de chaque génération.
export const MODELES = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 : le plus fin', entree: 4, sortie: 20 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 : bon équilibre, 2 fois moins cher', entree: 2, sortie: 10 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 : le plus économique', entree: 0.10, sortie: 0.50 },
};
export const MODELE_DEFAUT = 'claude-opus-5-5';

const SYSTEME = `Tu aides Gabriel, créateur de sites web indépendant, à préparer un appel de prospection vers un commerce ou un artisan de sa région qui n'a pas de site internet (ou seulement une page de réseau social). Tu écris le script qu'il aura sous les yeux pendant l'appel.

Le contexte de l'appel : le commerçant n'a rien demandé, il est occupé, et il reçoit déjà des démarchages. Ce qui fait la différence, c'est que Gabriel est quelqu'un du coin, qu'il a vraiment regardé cette entreprise-là, et qu'il vient avec une maquette déjà préparée. L'objectif de l'appel est d'obtenir un rendez-vous de 15 minutes pour montrer cette maquette, pas de vendre au téléphone.

Règle absolue : n'invente rien. Tu ne disposes que de la fiche fournie. N'invente ni avis client, ni note, ni chiffre, ni prix, ni détail sur l'entreprise, ni nom de concurrent. Le commerçant connaît son affaire par cœur : une seule information fausse et Gabriel perd toute crédibilité. Si un avis client est fourni, cite-le mot pour mot, entre guillemets, sans le modifier ni l'embellir. Quand une information utile manque (un créneau, un prix non renseigné), écris-la entre crochets, par exemple [mardi en fin de matinée], pour que Gabriel la complète. Si la fiche est pauvre, fais un script plus court et dis-le dans la section de préparation plutôt que de combler avec des généralités.

Gabriel se présente toujours sous son vrai prénom et dit tout de suite qu'il crée des sites web. Pas de fausse familiarité, pas de prétexte, pas de pression : si la personne refuse clairement, le script la remercie et s'arrête.

Le style : du français parlé, naturel, des phrases courtes qu'on peut dire à voix haute sans reprendre son souffle. Vouvoiement. Pas d'anglicismes, pas de jargon du web (ni « SEO », ni « landing page », ni « visibilité digitale »), pas de formules creuses de commercial. Les répliques de Gabriel sont entre guillemets français « ». Les conseils pour lui (quand se taire, quoi noter) sont en clair, sans guillemets, et brefs.

Adapte tout à ce prospect précis : son métier, son ancienneté, sa réputation, ce qu'on trouve ou non sur lui en ligne. Les objections que tu prépares doivent être celles que CE commerçant a le plus de chances de faire, avec une réponse qui s'appuie sur sa situation. Si l'historique montre des échanges précédents, c'est un rappel : le script doit reprendre là où la conversation s'était arrêtée, répondre aux objections déjà entendues, et ne pas refaire la présentation depuis le début.

Format de ta réponse : du texte brut, sans Markdown (pas de #, pas de **, pas de listes à puces avec des tirets en début de ligne). Chaque section commence par un titre seul sur sa ligne, encadré ainsi : 【TITRE】. Utilise ces sections, dans cet ordre :

【AVANT D'APPELER】 deux ou trois points concrets à vérifier ou à avoir en tête pour ce prospect, et le meilleur moment pour appeler ce type de commerce.
【OUVERTURE】 la présentation et la demande de permission (« je vous prends une minute »).
【ACCROCHE】 ce que Gabriel a remarqué sur cette entreprise, avec l'avis client s'il y en a un, puis le constat sur son absence en ligne.
【QUESTIONS À POSER】 deux ou trois questions ouvertes, propres à ce métier, qui font parler le commerçant de ses clients.
【PROPOSITION】 ce que le site apporterait à ce commerce précis, la maquette, et la demande de rendez-vous avec deux créneaux entre crochets.
【OBJECTIONS PROBABLES】 les trois ou quatre objections les plus plausibles pour ce prospect. Pour chacune : une ligne « S'il dit : … » puis la réponse de Gabriel, qui se termine en ramenant vers le rendez-vous.
【CONCLUSION】 la phrase de fin si le rendez-vous est pris, et celle si c'est non.

Le script entier doit tenir en 350 à 500 mots : Gabriel le lit d'un coup d'œil en téléphonant. Réponds uniquement avec le script, sans phrase d'introduction ni commentaire après.`;

const annees = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / (365.25 * 864e5)) : null);

// La fiche envoyée au modèle : uniquement des faits connus, avec leur source.
function ficheProspect(p, profil) {
  const lignes = [];
  const ajouter = (libelle, valeur) => { if (valeur !== undefined && valeur !== null && valeur !== '') lignes.push(`${libelle} : ${valeur}`); };
  const site = p.site ?? {};
  const presence = p.siteManuel === 'non' ? 'Aucun site (vérifié à la main par Gabriel)'
    : site.statut === 'reseaux' ? `Pas de vrai site, seulement une page ailleurs : ${site.url}`
      : site.statut === 'douteux' ? `Aucun site trouvé à son nom (un site homonyme existe, sans lien apparent : ${site.url})`
        : p.aUnSite ? `A déjà un site : ${site.url || 'adresse inconnue'} (l'appel porterait sur une refonte)`
          : 'Aucun site trouvé (non vérifié à la main)';

  lignes.push('## Le prospect');
  ajouter('Entreprise', p.nom);
  ajouter('Raison sociale', p.raisonSociale);
  ajouter('Métier', p.categorie);
  ajouter('Adresse', p.adresse);
  ajouter('Dirigeant', p.dirigeant?.nom ? `${p.dirigeant.prenom ?? ''} ${p.dirigeant.nom}${p.dirigeant.qualite ? ` (${p.dirigeant.qualite})` : ''}`.trim() : 'inconnu');
  const ans = annees(p.creation);
  ajouter('Ancienneté', ans !== null ? `créée en ${String(p.creation).slice(0, 4)}, soit ${ans} an${ans > 1 ? 's' : ''}` : '');
  ajouter('Salariés', p.employeur ? 'oui, emploie du personnel' : '');
  ajouter('Note Google', p.note ? `${p.note}/5 sur ${p.avis} avis` : 'inconnue');
  ajouter('Présence en ligne', presence);
  ajouter('Téléphone connu', p.telephone ? 'oui' : 'non');
  if (p.avisCite?.texte?.trim()) {
    lignes.push('', '## Avis client réel, relevé sur sa fiche Google (à citer mot pour mot)');
    lignes.push(`« ${p.avisCite.texte.trim()} »${p.avisCite.auteur ? ` — ${p.avisCite.auteur.trim().split(' ')[0]}` : ''}`);
  } else {
    lignes.push('', '## Avis client', 'Aucun avis fourni. Ne cite aucun avis.');
  }
  if (p.angle) lignes.push('', '## Ce qu\'un site apporte en général à ce métier (piste, à adapter)', p.angle);
  if (p.notes?.trim()) lignes.push('', '## Notes de Gabriel sur ce prospect', p.notes.trim());

  const historique = (p.historique ?? []).slice(0, 6);
  if (historique.length) {
    lignes.push('', '## Échanges précédents (du plus récent au plus ancien)');
    for (const h of historique) {
      lignes.push(`- ${String(h.date).slice(0, 10)}, ${h.type}, résultat : ${h.resultat}${h.objections?.length ? `, objections entendues : ${h.objections.join(', ')}` : ''}${h.note ? `. Note : ${h.note}` : ''}`);
    }
  } else {
    lignes.push('', '## Échanges précédents', 'Aucun : c\'est le premier appel.');
  }
  const qualif = Object.entries(p.qualif ?? {}).filter(([, v]) => v).map(([k]) => k);
  if (qualif.length) ajouter('Critères déjà validés', qualif.join(', '));

  lignes.push('', '## Gabriel');
  ajouter('Prénom', profil.prenom || '[Ton prénom]');
  ajouter('Ville où il travaille', profil.ville || '[ta ville]');
  ajouter('Son téléphone', profil.telephone || '[ton numéro]');
  ajouter('Prix de départ d\'un site', profil.prixDepart || 'non renseigné : écris [ton prix de départ]');
  return lignes.join('\n');
}

function client(cle) {
  return new Anthropic({ apiKey: cle, ...(process.env.PROSPECTEUR_ANTHROPIC_URL && { baseURL: process.env.PROSPECTEUR_ANTHROPIC_URL }) });
}

function messageErreur(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Clé Anthropic invalide : vérifie que tu l\'as copiée en entier.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Cette clé n\'a pas le droit d\'utiliser ce modèle.';
  if (e instanceof Anthropic.NotFoundError) return 'Ce modèle n\'est pas disponible pour ton compte : choisis-en un autre dans Réglages.';
  if (e instanceof Anthropic.RateLimitError) return 'Trop de demandes d\'un coup : réessaie dans une minute.';
  if (e instanceof Anthropic.BadRequestError) return /credit balance/i.test(e.message) ? 'Ton compte Anthropic n\'a plus de crédit : ajoutes-en sur platform.claude.com (Billing).' : `Demande refusée par Anthropic : ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Impossible de joindre Anthropic : vérifie ta connexion internet.';
  if (e instanceof Anthropic.APIError) return `Erreur Anthropic (${e.status}) : ${e.message}`;
  return e.message;
}

function coutDollars(modele, usage) {
  const prix = MODELES[modele] ?? MODELES[MODELE_DEFAUT];
  const entree = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
  return (entree * prix.entree + (usage?.output_tokens ?? 0) * prix.sortie) / 1e6;
}

async function appeler(cle, modele, params) {
  // Opus et Sonnet peuvent décliner une demande ; « fallbacks » la relance alors sur un autre modèle côté serveur.
  // Haiku n'a pas ce mécanisme.
  if (modele === 'claude-haiku-5-5') return client(cle).messages.create({ model: modele, ...params });
  return client(cle).beta.messages.create({ model: modele, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', ...params });
}

export async function genererScript({ cle, modele = MODELE_DEFAUT, prospect, profil = {} }) {
  if (!MODELES[modele]) modele = MODELE_DEFAUT;
  try {
    const reponse = await appeler(cle, modele, {
      max_tokens: 16000,
      system: SYSTEME,
      messages: [{ role: 'user', content: `Voici la fiche. Écris le script d'appel.\n\n${ficheProspect(prospect, profil)}` }],
    });
    const cout = coutDollars(MODELES[reponse.model] ? reponse.model : modele, reponse.usage);
    if (reponse.stop_reason === 'refusal') return { ok: false, cout, message: 'L\'IA a refusé de traiter cette fiche. Réessaie, ou retire les notes inhabituelles de la fiche.' };
    const texte = reponse.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texte) return { ok: false, cout, message: 'L\'IA n\'a rien renvoyé. Réessaie.' };
    return { ok: true, texte, cout, modele: reponse.model, tronque: reponse.stop_reason === 'max_tokens' };
  } catch (e) {
    return { ok: false, cout: 0, message: messageErreur(e) };
  }
}

export async function testerCleAnthropic(cle, modele = MODELE_DEFAUT) {
  try {
    const reponse = await appeler(cle, MODELES[modele] ? modele : MODELE_DEFAUT, {
      max_tokens: 2000, messages: [{ role: 'user', content: 'Réponds uniquement par le mot : OK' }],
    });
    return { ok: true, cout: coutDollars(modele, reponse.usage), message: `Clé valide ✓ (${MODELES[modele]?.label.split(' :')[0] ?? modele} a répondu)` };
  } catch (e) {
    return { ok: false, cout: 0, message: messageErreur(e) };
  }
}
