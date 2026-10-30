// Moteur de recherche de prospects : croise toutes les sources disponibles pour chaque entreprise.
//
//  1. Registre SIRENE      : toutes les entreprises déclarées (nom, adresse, dirigeant, SIRET, création, salariés).
//  2. OpenStreetMap        : vitrines visibles sur la carte, téléphones et sites connus.
//  3. Google Maps (clé)    : fiches Google (téléphone, note, avis, site déclaré). La carte est découpée en zones
//                            pour dépasser la limite de 60 résultats par recherche.
//  4. Détection de domaine : teste nom.fr, nom-ville.fr… et vérifie que le site parle bien de la ville.
//
// Les entreprises trouvées par plusieurs sources sont fusionnées (nom proche + même endroit, ou même téléphone).

import { promises as dns } from 'node:dns';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------------------------
// Métiers : codes NAF (SIRENE), étiquettes OpenStreetMap, requête Google, angle commercial.

export const METIERS = {
  coiffeur:    { label: 'Coiffure',                  naf: ['96.02A'], osm: ['shop=hairdresser'], google: 'coiffeur', angle: 'Prise de RDV en ligne 24h/24 et galerie de coupes : les clients réservent depuis leur téléphone, sans appeler pendant une coupe.' },
  barbier:     { label: 'Barbier',                   naf: ['96.02A'], osm: ['shop=hairdresser'], google: 'barbier', angle: 'Réservation en ligne et tarifs visibles : une clientèle jeune qui cherche tout sur Google.' },
  beaute:      { label: 'Institut de beauté',        naf: ['96.02B'], osm: ['shop=beauty', 'shop=cosmetics'], google: 'institut de beauté', angle: 'Carte des soins et réservation en ligne. Le visuel vend : photos avant/après.' },
  onglerie:    { label: 'Onglerie',                  naf: ['96.02B'], osm: ['shop=beauty'], google: 'onglerie', angle: 'Galerie de réalisations et réservation. Instagram ne suffit pas pour apparaître sur Google.' },
  massage:     { label: 'Massage / bien-être',       naf: ['96.04Z', '96.09Z'], osm: ['shop=massage', 'leisure=spa'], google: 'massage bien-être', angle: 'Site apaisant, réservation en ligne et bons cadeaux vendus en ligne.' },
  restaurant:  { label: 'Restaurant',                naf: ['56.10A', '56.10C'], osm: ['amenity=restaurant', 'amenity=fast_food'], google: 'restaurant', angle: 'Menu en ligne, réservation et photos : les gens choisissent où manger AVANT de sortir.' },
  bar:         { label: 'Bar / café',                naf: ['56.30Z'], osm: ['amenity=bar', 'amenity=pub', 'amenity=cafe'], google: 'bar café', angle: 'Horaires, événements, privatisation : tout ce que les gens cherchent avant de venir.' },
  boulangerie: { label: 'Boulangerie / pâtisserie',  naf: ['10.71C', '10.71D', '47.24Z'], osm: ['shop=bakery', 'shop=pastry', 'shop=confectionery'], google: 'boulangerie pâtisserie', angle: 'Commande de gâteaux et d\'événements en ligne, horaires à jour : les commandes spéciales rapportent.' },
  boucherie:   { label: 'Boucherie / traiteur',      naf: ['47.22Z', '56.21Z'], osm: ['shop=butcher', 'shop=deli'], google: 'boucherie traiteur', angle: 'Commandes en ligne (barbecue, fêtes) et carte traiteur.' },
  epicerie:    { label: 'Épicerie / alimentation',   naf: ['47.11B', '47.11C', '47.29Z', '47.21Z'], osm: ['shop=convenience', 'shop=greengrocer', 'shop=supermarket'], google: 'épicerie', angle: 'Raconter l\'histoire des produits et proposer le click & collect.' },
  caviste:     { label: 'Caviste',                   naf: ['47.25Z'], osm: ['shop=wine', 'shop=alcohol'], google: 'caviste', angle: 'Sélection du moment, événements dégustation et coffrets cadeaux en click & collect.' },
  fleuriste:   { label: 'Fleuriste',                 naf: ['47.76Z'], osm: ['shop=florist'], google: 'fleuriste', angle: 'Commande de bouquets en ligne : mariages, deuils, Saint-Valentin, fête des mères.' },
  vetements:   { label: 'Boutique (vêtements, chaussures)', naf: ['47.71Z', '47.72A'], osm: ['shop=clothes', 'shop=shoes', 'shop=boutique'], google: 'boutique de vêtements', angle: 'Vitrine en ligne des nouveautés et réservation d\'articles : les clients vérifient avant de se déplacer.' },
  bijouterie:  { label: 'Bijouterie',                naf: ['47.77Z'], osm: ['shop=jewelry'], google: 'bijouterie', angle: 'Catalogue des créations, prise de RDV (mariage, sur-mesure) et réparations.' },
  opticien:    { label: 'Opticien',                  naf: ['47.78A'], osm: ['shop=optician'], google: 'opticien', angle: 'Prise de RDV (examen de vue), marques disponibles et prise en charge mutuelle expliquée.' },
  librairie:   { label: 'Librairie / papeterie',     naf: ['47.61Z', '47.62Z'], osm: ['shop=books', 'shop=stationery'], google: 'librairie', angle: 'Coups de cœur, événements (dédicaces) et commande en ligne à retirer en boutique.' },
  animaux:     { label: 'Animalerie / toilettage',   naf: [], osm: ['shop=pet', 'shop=pet_grooming'], google: 'toilettage animalerie', angle: 'Prise de RDV toilettage en ligne et tarifs par race.' },
  veterinaire: { label: 'Vétérinaire',               naf: ['75.00Z'], osm: ['amenity=veterinary'], google: 'vétérinaire', angle: 'Prise de RDV en ligne, urgences et conseils : moins d\'appels au secrétariat.' },
  garage:      { label: 'Garage automobile',         naf: ['45.20A', '45.20B'], osm: ['shop=car_repair', 'shop=tyres'], google: 'garage automobile', angle: 'Tarifs transparents, prise de RDV et avis clients en avant : ça rassure face aux grandes chaînes.' },
  plombier:    { label: 'Plombier / chauffagiste',   naf: ['43.22A', '43.22B'], osm: ['craft=plumber', 'craft=hvac'], google: 'plombier', angle: 'Être trouvé en urgence (« plombier + ville ») et recevoir des demandes de devis en ligne.' },
  electricien: { label: 'Électricien',               naf: ['43.21A'], osm: ['craft=electrician'], google: 'électricien', angle: 'Demande de devis en ligne et réalisations : les particuliers comparent avant d\'appeler.' },
  menuisier:   { label: 'Menuisier / serrurier',     naf: ['43.32A', '43.32B', '16.23Z'], osm: ['craft=carpenter', 'craft=locksmith', 'shop=locksmith'], google: 'menuisier serrurier', angle: 'Galerie de réalisations (l\'argument n°1) et devis en ligne.' },
  peintre:     { label: 'Peintre en bâtiment',       naf: ['43.34Z'], osm: ['craft=painter'], google: 'peintre en bâtiment', angle: 'Photos avant/après et demande de devis.' },
  macon:       { label: 'Maçon / rénovation',        naf: ['43.99C', '43.39Z', '41.20A'], osm: ['craft=builder', 'craft=tiler', 'craft=plasterer'], google: 'maçon rénovation', angle: 'Galerie avant/après et devis en ligne : un chantier de rénovation se choisit sur photos.' },
  couvreur:    { label: 'Couvreur',                  naf: ['43.91B'], osm: ['craft=roofer'], google: 'couvreur', angle: 'Être trouvé pour les urgences toiture, réalisations et devis.' },
  paysagiste:  { label: 'Paysagiste / jardinier',    naf: ['81.30Z'], osm: ['craft=gardener'], google: 'paysagiste', angle: 'Galerie de jardins réalisés et devis. Mentionner le crédit d\'impôt services à la personne.' },
  nettoyage:   { label: 'Nettoyage / pressing',      naf: ['81.21Z', '81.22Z', '96.01B'], osm: ['shop=dry_cleaning', 'shop=laundry'], google: 'pressing nettoyage', angle: 'Crédibilité auprès des entreprises et des syndics : un site, c\'est du sérieux.' },
  demenageur:  { label: 'Déménagement',              naf: ['49.42Z'], osm: ['office=moving_company'], google: 'déménagement', angle: 'Demande de devis en ligne avec volume à déménager : des demandes qualifiées.' },
  informatique:{ label: 'Réparation téléphone / informatique', naf: ['95.11Z', '95.12Z', '95.21Z'], osm: ['shop=computer', 'shop=mobile_phone', 'craft=electronics_repair'], google: 'réparation téléphone informatique', angle: 'Tarifs des réparations par modèle et prise de RDV : les gens comparent les prix en ligne.' },
  cordonnerie: { label: 'Cordonnerie / clés',        naf: ['95.23Z'], osm: ['shop=shoe_repair', 'craft=shoemaker', 'craft=key_cutter'], google: 'cordonnerie', angle: 'Services et tarifs visibles (clés, talons, gravure) : on vous trouve quand on en a besoin.' },
  autoecole:   { label: 'Auto-école',                naf: ['85.53Z'], osm: ['amenity=driving_school'], google: 'auto-école', angle: 'Tarifs des forfaits, inscription en ligne et taux de réussite.' },
  photographe: { label: 'Photographe',               naf: ['74.20Z'], osm: ['craft=photographer', 'shop=photo'], google: 'photographe', angle: 'Un portfolio en ligne est indispensable, avec réservation de séances.' },
  sport:       { label: 'Salle de sport / coach',    naf: ['93.13Z', '85.51Z'], osm: ['leisure=fitness_centre'], google: 'salle de sport coach', angle: 'Planning des cours, réservation et tarifs d\'abonnement.' },
  tatoueur:    { label: 'Tatoueur',                  naf: ['96.09Z'], osm: ['shop=tattoo'], google: 'tatoueur', angle: 'Portfolio par style et demande de projet en ligne.' },
  hotel:       { label: 'Hôtel / chambre d\'hôtes',  naf: ['55.10Z', '55.20Z'], osm: ['tourism=hotel', 'tourism=guest_house'], google: 'hôtel chambre d\'hôtes', angle: 'Réservation en direct sur son site : pas de commission Booking (15 à 20 %).' },
  immobilier:  { label: 'Agence immobilière',        naf: ['68.31Z'], osm: ['office=estate_agent'], google: 'agence immobilière', angle: 'Annonces sur son propre site et estimation en ligne (génère des mandats).' },
  avocat:      { label: 'Avocat',                    naf: ['69.10Z'], osm: ['office=lawyer'], google: 'avocat', angle: 'Domaines d\'expertise, honoraires indicatifs et prise de RDV : un client choisit son avocat en ligne.' },
  comptable:   { label: 'Expert-comptable',          naf: ['69.20Z'], osm: ['office=accountant'], google: 'expert-comptable', angle: 'Offres par type de client (artisan, auto-entrepreneur…) et demande de devis en ligne.' },
  architecte:  { label: 'Architecte / décoration',   naf: ['71.11Z', '74.10Z'], osm: ['office=architect'], google: 'architecte', angle: 'Portfolio de projets : c\'est ce qui déclenche la prise de contact.' },
  taxi:        { label: 'Taxi / VTC',                naf: ['49.32Z'], osm: ['office=taxi'], google: 'taxi VTC', angle: 'Réservation en ligne (aéroport, gare) et tarifs, pour exister face aux applis.', horsVilleEntiere: true }, // surtout des chauffeurs VTC seuls
};

const METIERS_VILLE_ENTIERE = Object.entries(METIERS).filter(([, m]) => !m.horsVilleEntiere);

export function listeMetiers() {
  return Object.entries(METIERS).map(([cle, m]) => ({ cle, label: m.label }));
}

function resoudreMetier(cle) {
  if (!cle || cle === 'tous') {
    return { cle: 'tous', label: 'Tous métiers', tous: true, sousMetiers: METIERS_VILLE_ENTIERE.map(([k, m]) => ({ cle: k, ...m })) };
  }
  if (!METIERS[cle]) throw new Error(`Métier inconnu : ${cle}`);
  return { cle, ...METIERS[cle], sousMetiers: [{ cle, ...METIERS[cle] }] };
}

// ---------------------------------------------------------------------------------------------
// Utilitaires

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export const normaliser = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' et ').replace(/[^a-z0-9]+/g, ' ').trim();

// « CHAMPS-SUR-MARNE » → « Champs-sur-Marne », « 19 RUE DE LA MAIRIE » → « 19 Rue de la Mairie »
const titre = (s) => (s ?? '').toLowerCase()
  .replace(/(^|[\s'’(-])\p{L}/gu, (m) => m.toUpperCase())
  .replace(/(?<=[\s-])(De|Du|Des|La|Le|Les|Sur|Sous|Et|En|Aux?|D'|L')(?=[\s-]|$|(?<=')\p{L})/gu, (m) => m.toLowerCase())
  .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (m) => m.toUpperCase())
  .replace(/(?<=\p{L}['’])S\b/gu, 's'); // « Charly's », pas « Charly'S »

async function getJSON(url, options = {}, essais = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout ?? 25000) });
    if ((r.status === 429 || r.status >= 500) && i < essais) { await pause(1500 * (i + 1)); continue; }
    if (!r.ok) {
      const texte = (await r.text()).slice(0, 400);
      const err = new Error(`Erreur ${r.status} (${new URL(url).hostname}) ${texte}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }
}

async function parLots(elements, taille, fn, progres) {
  const sortie = [];
  for (let i = 0; i < elements.length; i += taille) {
    sortie.push(...await Promise.all(elements.slice(i, i + taille).map(fn)));
    progres?.(Math.min(i + taille, elements.length), elements.length);
  }
  return sortie;
}

function distanceM(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

const chiffresTel = (t) => {
  const c = String(t ?? '').split(/[;,/]/)[0].replace(/\D/g, '');
  return c.startsWith('33') && c.length === 11 ? `0${c.slice(2)}` : c;
};

export function formaterTelephone(t) {
  if (!t) return '';
  const national = chiffresTel(t);
  // Numéro français : 01 23 45 67 89. Numéro étranger : on le garde tel quel, avec son indicatif (+32…).
  return national.length === 10 && national.startsWith('0') ? national.replace(/(\d{2})(?=\d)/g, '$1 ') : String(t).split(/[;,/]/)[0].trim();
}

// ---------------------------------------------------------------------------------------------
// Commune (API Géo)

export async function trouverCommune(saisie) {
  const s = saisie.trim();
  const champs = 'fields=nom,code,codesPostaux,centre,population,contour';
  const cpDansSaisie = s.match(/\b(\d{5})\b/)?.[1];
  const nom = s.replace(/\(?\b\d{5}\b\)?/, '').trim();
  let url;
  if (nom && cpDansSaisie) url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&codePostal=${cpDansSaisie}&${champs}`;
  else if (cpDansSaisie) url = `https://geo.api.gouv.fr/communes?codePostal=${cpDansSaisie}&${champs}`;
  else url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&${champs}&boost=population&limit=5`;
  const communes = await getJSON(url);
  const exacte = communes.find((c) => normaliser(c.nom) === normaliser(nom));
  // Sans code postal ni nom exact, la recherche française est approximative (« Luxembourg » → « Bouy-Luxembourg ») :
  // on vérifie d'abord si ce n'est pas une ville d'un autre pays.
  if (!exacte && !cpDansSaisie) {
    const ailleurs = await trouverVilleEtrangere(s);
    if (ailleurs) return ailleurs;
  }
  if (!communes.length) throw new Error(`Ville introuvable : « ${saisie} ». Vérifie l'orthographe, ou ajoute le pays (ex. « Liège, Belgique »).`);
  const c = exacte ?? [...communes].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  return {
    nom: c.nom, insee: c.code, cp: cpDansSaisie && c.codesPostaux.includes(cpDansSaisie) ? cpDansSaisie : c.codesPostaux[0],
    lat: c.centre.coordinates[1], lon: c.centre.coordinates[0], contour: c.contour, population: c.population,
    pays: 'fr', paysNom: 'France', alias: [c.nom], tlds: ['.fr', '.com'],
  };
}

// Adresse postale à partir d'une position (pour les commerces dont la carte ne donne pas la rue). 1 requête/seconde max.
export async function adresseDepuisPosition(lat, lon) {
  try {
    const r = await getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${Number(lat)}&lon=${Number(lon)}&format=jsonv2&zoom=18&addressdetails=1&accept-language=fr`,
      { headers: { 'User-Agent': 'prospecteur-local/1.0' } }, 1);
    const a = r.address ?? {};
    const rue = [a.house_number, a.road ?? a.pedestrian ?? a.square].filter(Boolean).join(' ');
    const ville = a.city ?? a.town ?? a.village ?? a.municipality ?? '';
    if (!rue) return { ok: false };
    return { ok: true, adresse: [rue, `${a.postcode ?? ''} ${ville}`.trim()].filter(Boolean).join(', '), cp: a.postcode ?? '', approximatif: !a.house_number };
  } catch { return { ok: false }; }
}

// Villes hors de France : géocodage OpenStreetMap (Nominatim). Renvoie null si la meilleure réponse est en France.
async function trouverVilleEtrangere(saisie) {
  let lieux;
  try {
    lieux = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(saisie)}`
      + '&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0005&addressdetails=1&namedetails=1&limit=5&accept-language=fr',
    { headers: { 'User-Agent': 'prospecteur-local/1.0' } }, 1);
  } catch { return null; }
  const l = lieux.find((x) => x.category === 'boundary' && x.type === 'administrative') ?? lieux.find((x) => x.category === 'place');
  if (!l || l.address?.country_code === 'fr') return null;
  const pays = l.address?.country_code ?? '';
  const n = l.namedetails ?? {};
  const alias = [...new Set([n['name:fr'], l.name, n.name, n['name:nl'], n['name:de'], n['name:en'], n['name:it']]
    .filter(Boolean).flatMap((x) => x.split(' - ')))];
  const [sud, nord, ouest, est] = l.boundingbox.map(Number);
  return {
    nom: n['name:fr'] ?? l.name, insee: `osm${l.osm_id}`, cp: l.address?.postcode ?? '',
    lat: Number(l.lat), lon: Number(l.lon),
    contour: ['Polygon', 'MultiPolygon'].includes(l.geojson?.type) ? l.geojson
      : { type: 'Polygon', coordinates: [[[ouest, sud], [est, sud], [est, nord], [ouest, nord], [ouest, sud]]] },
    pays, paysNom: l.address?.country ?? pays.toUpperCase(), etranger: true, alias, tlds: [`.${pays}`, '.com'],
  };
}

function polygones(contour) {
  if (!contour) return [];
  return contour.type === 'Polygon' ? [contour.coordinates[0]] : contour.coordinates.map((p) => p[0]);
}

function dansContour(lat, lon, contour) {
  return polygones(contour).some((anneau) => {
    let dedans = false;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const [xi, yi] = anneau[i]; const [xj, yj] = anneau[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
    return dedans;
  });
}

// [sud, ouest, nord, est]
function boiteEnglobante(contour) {
  const points = polygones(contour).flat();
  const lats = points.map((p) => p[1]); const lons = points.map((p) => p[0]);
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
}

function boiteZone(commune, rayonKm) {
  if (!rayonKm && commune.contour) return boiteEnglobante(commune.contour);
  const km = rayonKm || 3;
  const dLat = km / 111; const dLon = km / (111 * Math.cos((commune.lat * Math.PI) / 180));
  return [commune.lat - dLat, commune.lon - dLon, commune.lat + dLat, commune.lon + dLon];
}

function dansLaZone(commune, rayonKm, lat, lon) {
  if (lat == null || lon == null) return true;
  if (rayonKm) return distanceM(commune.lat, commune.lon, lat, lon) <= rayonKm * 1000;
  return commune.contour ? dansContour(lat, lon, commune.contour) : distanceM(commune.lat, commune.lon, lat, lon) <= 3000;
}

// ---------------------------------------------------------------------------------------------
// Rapprochement des noms entre sources

const MOTS_VIDES = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'a', 'au', 'aux', 'en', 'chez', 'the',
  'sarl', 'sas', 'sasu', 'eurl', 'sa', 'snc', 'ei', 'eirl', 'ets', 'ste', 'societe', 'sci']);
const MOTS_GENERIQUES = new Set(['coiffure', 'coiffeur', 'salon', 'barber', 'barbier', 'shop', 'barbershop', 'garage',
  'auto', 'autos', 'automobile', 'automobiles', 'restaurant', 'resto', 'pizza', 'pizzeria', 'boulangerie', 'patisserie',
  'boucherie', 'institut', 'beaute', 'beauty', 'ongles', 'nails', 'spa', 'massage', 'bar', 'cafe', 'brasserie',
  'traiteur', 'kebab', 'tacos', 'sushi', 'burger', 'immobilier', 'agence', 'ecole', 'plomberie', 'electricite',
  'renovation', 'batiment', 'services', 'service', 'multi', 'market', 'marche', 'epicerie', 'fleurs', 'fleuriste',
  'photo', 'studio', 'fitness', 'sport', 'taxi', 'vtc', 'sur', 'sous', 'saint', 'cabinet', 'hotel', 'optique',
  'boutique', 'maison', 'atelier', 'pressing', 'cordonnerie', 'avocat', 'avocats', 'expert', 'comptable', 'conseil']);

const jetons = (s) => normaliser(s).split(' ').filter((m) => m.length >= 2 && !MOTS_VIDES.has(m));

function jetonsCorrespondent(A, B, motsVille) {
  if (!A.length || !B.length) return false;
  const [a2, b2] = [A.join(''), B.join('')];
  if (a2 === b2) return true;
  // « DK Barber » / « DK Barbershop » : l'un prolonge l'autre, avec au moins un mot distinctif.
  const [court, long] = a2.length <= b2.length ? [A, b2] : [B, a2];
  if (court.join('').length >= 5 && long.startsWith(court.join(''))
    && court.some((m) => !MOTS_GENERIQUES.has(m) && !motsVille.has(m))) return true;
  const communs = A.filter((m) => B.includes(m));
  const distinctifs = communs.filter((m) => m.length >= 3 && !MOTS_GENERIQUES.has(m) && !motsVille.has(m));
  return distinctifs.length >= 1 && communs.length / Math.min(A.length, B.length) >= 0.6;
}

// Trouve pour chaque candidat la ligne la plus proche qui a un nom compatible (ou le même téléphone).
// « memeMetier » (facultatif) : refuse de fusionner deux fiches de métiers différents dont les noms se ressemblent
// (« Auto-école des Bords de Marne » et « Immo des Bords de Marne » sont deux entreprises), sauf nom strictement identique.
function rapprocher(lignes, candidats, { nomCandidat, latLon, telephone, champ, distanceMax, motsVille, memeMetier }) {
  const orphelins = [];
  for (const c of candidats) {
    const jc = jetons(nomCandidat(c));
    const [lat, lon] = latLon(c);
    const tel = chiffresTel(telephone(c));
    let meilleure = null; let meilleurScore = Infinity;
    for (const l of lignes) {
      if (l[champ]) continue;
      const telIdentique = tel.length === 10 && l.telephone && chiffresTel(l.telephone) === tel;
      let score;
      if (telIdentique) score = -1;
      else {
        const d = l.lat && lat ? distanceM(l.lat, l.lon, lat, lon) : null;
        if (d === null || d > distanceMax) continue;
        if (!l._jetons.some((jl) => jetonsCorrespondent(jl, jc, motsVille))) continue;
        if (memeMetier && !memeMetier(l, c) && !l._jetons.some((jl) => jl.join('') === jc.join(''))) continue;
        score = d;
      }
      if (score < meilleurScore) { meilleure = l; meilleurScore = score; }
    }
    if (meilleure) meilleure[champ] = c; else orphelins.push(c);
  }
  return orphelins;
}

// ---------------------------------------------------------------------------------------------
// Source 1 : SIRENE (API Recherche d'entreprises, gratuite)

function dirigeantDe(ent) {
  const d = (ent.dirigeants ?? []).find((x) => x.nom) ?? (ent.dirigeants ?? [])[0];
  if (!d) return null;
  if (d.nom) return { prenom: titre((d.prenoms ?? '').split(' ')[0]), nom: titre(d.nom.replace(/\s*\(.*\)\s*/g, ' ').trim()), qualite: d.qualite ?? '' };
  return d.denomination ? { prenom: '', nom: d.denomination, qualite: d.qualite ?? 'Société dirigeante' } : null;
}

const estChaine = (ent) => ['GE', 'ETI'].includes(ent.categorie_entreprise) || ent.nombre_etablissements_ouverts > 3;

async function chercherSirene(commune, metier, rayonKm, max, progres) {
  const trouves = new Map();
  const nafs = [...new Set(metier.sousMetiers.flatMap((m) => m.naf))];
  if (!nafs.length) return [];
  for (let page = 1, totalPages = 1; page <= totalPages && trouves.size < max; page++) {
    const url = rayonKm
      ? `https://recherche-entreprises.api.gouv.fr/near_point?lat=${commune.lat}&long=${commune.lon}`
        + `&radius=${rayonKm}&activite_principale=${nafs.join(',')}&per_page=25&page=${page}`
      : `https://recherche-entreprises.api.gouv.fr/search?code_commune=${commune.insee}`
        + `&activite_principale=${nafs.join(',')}&etat_administratif=A&per_page=25&page=${page}`;
    const data = await getJSON(url);
    totalPages = Math.min(data.total_pages, 400);
    progres(page, totalPages);
    for (const ent of data.results) {
      if (estChaine(ent)) continue;
      for (const etab of ent.matching_etablissements ?? []) {
        if (etab.etat_administratif !== 'A' || trouves.has(etab.siret) || trouves.size >= max) continue;
        if (!rayonKm && etab.commune !== commune.insee) continue;
        if (!nafs.includes(etab.activite_principale)) continue;
        trouves.set(etab.siret, { ent, etab });
      }
    }
    await pause(180); // limite de l'API : 7 requêtes/seconde
  }
  return [...trouves.values()];
}

async function enrichirSirene(nom, cp) {
  try {
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(nom)}`
      + `&code_postal=${cp}&etat_administratif=A&per_page=3`;
    const data = await getJSON(url);
    const motsVille = new Set();
    for (const ent of data.results) {
      const etab = (ent.matching_etablissements ?? []).find((e) => e.code_postal === cp && e.etat_administratif === 'A');
      if (!etab) continue;
      // On vérifie que le nom trouvé ressemble vraiment (la recherche plein texte est large).
      const noms = nomsCandidats(ent, etab);
      if (!noms.some((n) => jetonsCorrespondent(jetons(n), jetons(nom), motsVille))) continue;
      return {
        siret: etab.siret, creation: etab.date_creation ?? ent.date_creation, dirigeant: dirigeantDe(ent),
        raisonSociale: ent.nom_raison_sociale ?? ent.nom_complet, employeur: (etab.caractere_employeur ?? ent.caractere_employeur) === 'O',
        chaine: estChaine(ent),
      };
    }
  } catch { /* enrichissement facultatif */ }
  return {};
}

function nomsCandidats(ent, etab) {
  return [etab.liste_enseignes?.[0], etab.nom_commercial, ent.nom_raison_sociale, ent.nom_complet?.replace(/\s*\(.*\)\s*$/, '')]
    .filter(Boolean).filter((n, i, t) => t.findIndex((m) => normaliser(m) === normaliser(n)) === i);
}

// ---------------------------------------------------------------------------------------------
// Source 2 : OpenStreetMap (Overpass, gratuit), gardé 7 jours en cache

const SERVEURS_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const TOUS_TAGS_OSM = [...new Set(Object.values(METIERS).flatMap((m) => m.osm))];
const DUREE_CACHE_OSM = 7 * 864e5;

async function telechargerOSM(commune, rayonKm) {
  const zone = rayonKm || !commune.contour
    ? `(around:${Math.round((rayonKm || 3) * 1000)},${commune.lat},${commune.lon})`
    : `(${boiteEnglobante(commune.contour).join(',')})`;
  const requete = `[out:json][timeout:90];(${TOUS_TAGS_OSM.map((t) => {
    const [k, v] = t.split('=');
    return `nwr["${k}"="${v}"]["name"]${zone};`;
  }).join('')});out center tags;`;
  // Les serveurs publics sont parfois surchargés : on les interroge en parallèle, le premier qui répond gagne.
  const data = await Promise.any(SERVEURS_OVERPASS.map((serveur) => getJSON(serveur, {
    method: 'POST', timeout: 100000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'prospecteur-local/1.0' },
    body: `data=${encodeURIComponent(requete)}`,
  }, 0)));
  return data.elements
    .map((el) => ({ type: el.type, id: el.id, tags: el.tags, lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon }))
    .filter((el) => el.lat && dansLaZone(commune, rayonKm, el.lat, el.lon));
}

async function chercherOSM(commune, metier, rayonKm, dossierCache) {
  const fichier = dossierCache && path.join(dossierCache, `osm_${commune.insee}_${rayonKm ?? 'ville'}.json`);
  let elements;
  try {
    const cache = JSON.parse(await readFile(fichier, 'utf8'));
    if (Date.now() - cache.date < DUREE_CACHE_OSM) elements = cache.elements;
  } catch { /* pas de cache */ }
  if (!elements) {
    elements = await telechargerOSM(commune, rayonKm);
    if (fichier) {
      await mkdir(dossierCache, { recursive: true });
      await writeFile(fichier, JSON.stringify({ date: Date.now(), elements }));
    }
  }
  return elements
    .map((el) => ({ ...el, metier: metier.sousMetiers.find((m) => m.osm.some((t) => { const [k, v] = t.split('='); return el.tags[k] === v; })) }))
    .filter((el) => el.metier);
}

// ---------------------------------------------------------------------------------------------
// Source 3 : Google Places (clé API), avec compteur pour ne pas dépasser le quota gratuit

const URL_GOOGLE = process.env.PROSPECTEUR_GOOGLE_URL ?? 'https://places.googleapis.com/v1/places:searchText';
const CHAMPS_GOOGLE = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteUri', 'rating',
  'userRatingCount', 'googleMapsUri', 'businessStatus', 'location', 'primaryTypeDisplayName']
  .map((c) => `places.${c}`).concat('nextPageToken').join(',');

async function requeteGoogle(cle, corps, champs = CHAMPS_GOOGLE) {
  return getJSON(URL_GOOGLE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': champs },
    body: JSON.stringify(corps),
  }, 2);
}

// Avis Google d'une entreprise précise (1 requête) : sert à citer un VRAI avis dans l'accroche d'appel.
export async function avisGoogle(cle, nom, adresse) {
  try {
    const data = await requeteGoogle(cle, { textQuery: `${nom} ${adresse}`, languageCode: 'fr', regionCode: 'FR', pageSize: 1 },
      'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri');
    const lieu = data.places?.[0];
    if (!lieu) return { ok: false, message: 'Aucune fiche Google trouvée pour cette entreprise.' };
    return {
      ok: true, fiche: lieu.displayName?.text, adresse: lieu.formattedAddress, note: lieu.rating ?? null, total: lieu.userRatingCount ?? 0,
      avis: (lieu.reviews ?? [])
        .map((a) => ({ texte: (a.text?.text ?? a.originalText?.text ?? '').trim(), note: a.rating, auteur: a.authorAttribution?.displayName ?? '', quand: a.relativePublishTimeDescription ?? '' }))
        .filter((a) => a.texte),
    };
  } catch (e) {
    return { ok: false, message: messageErreurGoogle(e.message) };
  }
}

function messageErreurGoogle(texte) {
  if (/API_KEY_INVALID|API key not valid/i.test(texte)) return 'Clé invalide : vérifie que tu l\'as copiée en entier.';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(texte)) return 'La « Places API (New) » n\'est pas activée sur ton projet Google Cloud.';
  if (/BILLING/i.test(texte)) return 'La facturation n\'est pas activée sur ton projet Google Cloud (obligatoire, même pour la partie gratuite).';
  if (/API_KEY_.*BLOCKED|referer|not authorized/i.test(texte)) return 'Cette clé n\'a pas le droit d\'utiliser « Places API (New) » : vérifie ses restrictions.';
  if (/RESOURCE_EXHAUSTED|quota/i.test(texte)) return 'Quota Google atteint pour aujourd\'hui (limite que tu as fixée dans Google Cloud).';
  return texte;
}

export async function testerCleGoogle(cle) {
  try {
    const data = await requeteGoogle(cle, { textQuery: 'boulangerie à Paris', languageCode: 'fr', pageSize: 1 });
    return { ok: true, message: `Clé valide ✓ (test : « ${data.places?.[0]?.displayName?.text ?? 'aucun résultat'} »)` };
  } catch (e) {
    return { ok: false, message: messageErreurGoogle(e.message) };
  }
}

const rectangle = ([s, o, n, e]) => ({ low: { latitude: s, longitude: o }, high: { latitude: n, longitude: e } });
const diviser = ([s, o, n, e]) => {
  const [ml, mo] = [(s + n) / 2, (o + e) / 2];
  return [[s, o, ml, mo], [s, mo, ml, e], [ml, o, n, mo], [ml, mo, n, e]];
};

// Google ne renvoie que 60 résultats par recherche : si une zone est pleine, on la découpe en 4 (2 niveaux max).
async function chercherGoogleMetier(commune, rayonKm, metier, ctx) {
  const lieux = new Map();
  const explorer = async (boite, profondeur) => {
    let pageToken; let recus = 0;
    for (let p = 0; p < 3; p++) {
      if (ctx.restant <= 0) { ctx.quotaAtteint = true; return; }
      ctx.restant--; ctx.utilisees++;
      const data = await requeteGoogle(ctx.cle, {
        textQuery: metier.google, languageCode: 'fr', regionCode: (commune.pays ?? 'fr').toUpperCase(), pageSize: 20,
        locationRestriction: { rectangle: rectangle(boite) }, ...(pageToken && { pageToken }),
      });
      for (const l of data.places ?? []) { lieux.set(l.id, { ...l, metier }); recus++; }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
      await pause(300);
    }
    if (recus >= 60 && profondeur < 2) for (const sous of diviser(boite)) await explorer(sous, profondeur + 1);
  };
  await explorer(boiteZone(commune, rayonKm), 0);
  return [...lieux.values()].filter((l) => l.businessStatus === 'OPERATIONAL'
    && dansLaZone(commune, rayonKm, l.location?.latitude, l.location?.longitude));
}

// ---------------------------------------------------------------------------------------------
// Source 4 : détection d'un site au nom de l'entreprise

// Franchisés : société indépendante dans le registre, mais déjà présents sur le site de leur enseigne.
const FRANCHISES = /\b(era immobilier|century 21|orpi|laforet|guy hoquet|stephane plaza|nestenn|foncia|square habitat|citya|franprix|carrefour|intermarche|leclerc|super u|u express|casino shop|spar|vival|monoprix|auchan|lidl|aldi|picard|biocoop|la vie claire|naturalia|marie blachere|la mie caline|boulangerie paul|feuillette|mcdonald s?|burger king|kfc|subway|o tacos|domino s|pizza hut|speed rabbit|five pizza|pitaya|sushi shop|planet sushi|speedy|midas|norauto|feu vert|point s|euromaster|vulco|carglass|france pare brise|mondial pare brise|jean louis david|franck provost|dessange|tchip|saint algue|camille albane|body minute|yves rocher|nocibe|sephora|basic fit|fitness park|keep cool|l orange bleue|cer|ecf|stych|interflora|monceau fleurs|au nom de la rose|optic 2000|afflelou|krys|atol|grand optical|optical center|generale d optique|histoire d or|marc orian|celio|jules|kiabi|promod|pimkie|maison de la presse|relay|cultura|fnac|ibis|campanile|kyriad|premiere classe|novotel|mercure|b et b hotel|animalis|tom et co|maxi zoo|jardiland|truffaut|fiducial|in extenso|nicolas|v and b|cavavin|5 a sec|pressing de france)\b/;

const RESEAUX = /facebook\.com|fb\.com|instagram\.com|linktr\.ee|tiktok\.com|wa\.me|snapchat\.com/i;
const ANNUAIRES = /pagesjaunes\.fr|business\.site|planity\.com|treatwell\.fr|google\.com|g\.page|uber\.com|deliveroo|justeat|thefork\.fr|lafourchette|doctolib|booking\.com|airbnb/i;
const PARKING = /(domain|domaine)[^<]{0,40}(for sale|a vendre|à vendre|est disponible|is available)|parked|sedoparking|parkingcrew|bodis\.com|hugedomains|dan\.com|afternic|buy this domain|ce nom de domaine a ete reserve|domaine reserve|site en construction|coming soon/i;
const FORMES_JURIDIQUES = /\b(sarl|sas|sasu|eurl|sa|snc|sci|ei|eirl|earl|scop|selarl|selas|scp|ets|etablissements?|ste|societe)\b/g;

function variantesDomaine(nom, commune) {
  const base = normaliser(nom.replace(/\(.*?\)/g, ' ').replace(/['’]/g, '')).replace(FORMES_JURIDIQUES, ' ').replace(/\s+/g, ' ').trim();
  if (base.length < 3) return [];
  const mots = base.split(' ');
  const ville = normaliser(commune.nom).split(' ');
  const slugs = [mots.join(''), mots.join('-'), `${mots.join('-')}-${ville.join('-')}`, `${mots.join('')}${ville[0]}`];
  return [...new Set(slugs)].filter((s) => s.length >= 3 && s.length <= 63).flatMap((s) => (commune.tlds ?? ['.fr', '.com']).map((t) => s + t));
}

async function testerDomaine(domaine, indices, telephone) {
  // resolve4 interroge le DNS directement (pas de file d'attente comme dns.lookup) : beaucoup plus rapide en masse.
  try { await dns.resolve4(domaine); } catch { return null; }
  for (const proto of ['https://', 'http://']) {
    try {
      const r = await fetch(proto + domaine, {
        redirect: 'follow', signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
      });
      const html = (await r.text()).slice(0, 300000);
      if (PARKING.test(html) || html.length < 500) return { statut: 'parking', url: r.url };
      const texte = normaliser(html);
      const tel = chiffresTel(telephone);
      const lie = indices.some((i) => i && texte.includes(i)) || (tel.length === 10 && html.replace(/\D/g, '').includes(tel));
      return { statut: lie ? 'site' : 'autre', url: r.url };
    } catch { /* on tente http:// */ }
  }
  return null;
}

async function detecterSiteParDomaine(noms, commune, cp, telephone) {
  const domaines = [...new Set(noms.flatMap((n) => variantesDomaine(n, commune)))].slice(0, 16);
  // Un vrai site d'entreprise locale mentionne presque toujours sa ville, son code postal ou son téléphone.
  const indices = [cp, ...(commune.alias ?? [commune.nom]).map(normaliser)].filter(Boolean);
  const resultats = await Promise.all(domaines.map((d) => testerDomaine(d, indices, telephone)));
  const site = resultats.find((r) => r?.statut === 'site');
  if (site) return { statut: 'oui', url: site.url, source: 'Site au nom de l\'entreprise' };
  const douteux = resultats.find((r) => r?.statut === 'autre')?.url;
  if (douteux) return { statut: 'douteux', url: douteux, source: 'Domaine homonyme (pas de lien évident avec l\'entreprise)' };
  return { statut: 'non', url: '', source: 'Aucun site trouvé' };
}

function siteDepuisURL(url, source) {
  if (!url) return null;
  if (RESEAUX.test(url)) return { statut: 'reseaux', url, source: `${source} : réseaux sociaux uniquement` };
  if (ANNUAIRES.test(url)) return { statut: 'reseaux', url, source: `${source} : page d'annuaire / plateforme uniquement` };
  return { statut: 'oui', url: /^https?:/.test(url) ? url : `https://${url}`, source };
}

function siteDepuisOSM(tags) {
  const site = siteDepuisURL(tags.website ?? tags['contact:website'] ?? tags.url, 'OpenStreetMap');
  if (site) return site;
  const social = tags['contact:facebook'] ?? tags.facebook ?? tags['contact:instagram'] ?? tags.instagram;
  return social ? { statut: 'reseaux', url: social.startsWith('http') ? social : `https://www.facebook.com/${social}`, source: 'OpenStreetMap : réseaux sociaux uniquement' } : null;
}

// ---------------------------------------------------------------------------------------------
// Construction et finalisation des lignes

const ESTSITE = (s) => s.statut === 'oui' || s.statut === 'franchise';
const lienMaps = (nom, adresse) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nom} ${adresse}`)}`;

function ligneDepuisSirene({ ent, etab }, commune) {
  const metier = Object.values(METIERS).find((m) => m.naf.includes(etab.activite_principale)) ?? { label: etab.activite_principale, angle: '', google: '' };
  const enseigne = etab.liste_enseignes?.[0] ?? etab.nom_commercial;
  const raison = ent.nom_raison_sociale ?? ent.nom_complet.replace(/\s*\(.*\)\s*$/, '');
  const noms = nomsCandidats(ent, etab);
  return {
    id: etab.siret, nom: titre(enseigne ?? raison),
    raisonSociale: enseigne && normaliser(enseigne) !== normaliser(raison) ? titre(raison) : '',
    categorie: metier.label, motCle: metier.google, angle: metier.angle,
    adresse: titre(etab.adresse), ville: etab.commune === commune.insee ? commune.nom : titre(etab.libelle_commune), cp: etab.code_postal,
    lat: Number(etab.latitude) || null, lon: Number(etab.longitude) || null,
    telephone: '', note: null, avis: null, vitrine: false,
    employeur: (etab.caractere_employeur ?? ent.caractere_employeur) === 'O',
    dirigeant: dirigeantDe(ent), siret: etab.siret, creation: etab.date_creation ?? ent.date_creation ?? '',
    mapsUrl: lienMaps(enseigne ?? ent.nom_complet, etab.adresse),
    _sources: ['Registre officiel'], _noms: noms, _jetons: noms.map(jetons),
  };
}

function ligneDepuisOSM(osm, commune) {
  const t = osm.tags;
  const cp = t['addr:postcode'] ?? commune.cp;
  const rue = [t['addr:housenumber'] ?? t['contact:housenumber'], t['addr:street'] ?? t['contact:street']].filter(Boolean).join(' ');
  const adresse = [rue, `${cp} ${t['addr:city'] ?? commune.nom}`.trim()].filter(Boolean).join(', ');
  return {
    id: `osm:${osm.type}/${osm.id}`, nom: t.name, raisonSociale: '',
    categorie: osm.metier.label, motCle: osm.metier.google, angle: osm.metier.angle,
    adresse, ville: t['addr:city'] ?? commune.nom, cp, lat: osm.lat, lon: osm.lon,
    telephone: '', note: null, avis: null, vitrine: true, employeur: false, dirigeant: null, siret: '', creation: '',
    adresseIncomplete: !rue, // pas de rue sur la carte : l'interface la retrouve à partir de la position
    mapsUrl: rue ? lienMaps(t.name, adresse) : `https://www.google.com/maps/search/${encodeURIComponent(t.name)}/@${osm.lat},${osm.lon},19z`,
    _sources: [], _osm: osm, _noms: [t.name], _jetons: [jetons(t.name)],
  };
}

function ligneDepuisGoogle(g, commune, sirene, tous) {
  const nom = g.displayName?.text ?? '';
  const cp = g.formattedAddress?.match(/\b(\d{5})\b/)?.[1] ?? commune.cp;
  return {
    id: sirene.siret || `g:${g.id}`, nom,
    raisonSociale: sirene.raisonSociale && normaliser(sirene.raisonSociale) !== normaliser(nom) ? titre(sirene.raisonSociale) : '',
    categorie: tous ? (g.primaryTypeDisplayName?.text ?? g.metier.label) : g.metier.label, motCle: g.metier.google, angle: g.metier.angle,
    adresse: g.formattedAddress?.replace(/, France$/, ''), ville: commune.nom, cp,
    lat: g.location?.latitude, lon: g.location?.longitude,
    telephone: '', note: null, avis: null, vitrine: true, employeur: Boolean(sirene.employeur),
    dirigeant: sirene.dirigeant ?? null, siret: sirene.siret ?? '', creation: sirene.creation ?? '',
    mapsUrl: g.googleMapsUri, _chaine: sirene.chaine,
    _sources: sirene.siret ? ['Registre officiel'] : [], _google: g, _noms: [nom], _jetons: [jetons(nom)],
  };
}

// Classement des prospects (commerces locaux) :
//   A = à contacter en premier : pas de vrai site, joignable tout de suite, et commerce manifestement actif ;
//   B = bon prospect, mais il manque le téléphone, ou les signes d'activité sont plus faibles ;
//   C = à creuser : peu d'éléments (souvent un indépendant à domicile), ou présence web incertaine.
// Renvoie aussi les raisons, affichées dans la fiche, et un niveau de confiance (combien de sources concordent).
function classement(l) {
  const raisons = [];
  const anciennete = l.creation ? Math.floor((Date.now() - new Date(l.creation)) / (365.25 * 864e5)) : 0;
  const nbSources = new Set(l._sources).size;
  const confiance = l.site.statut === 'douteux' ? 'faible' : nbSources >= 2 || l._google ? 'haute' : 'moyenne';
  if (ESTSITE(l.site)) return { classement: 'Z', raisons: [l.site.statut === 'franchise' ? 'Franchise ou réseau : passe par le site de l\'enseigne' : 'A déjà un site'], confiance };

  // 1. Le besoin : quelle présence en ligne aujourd'hui ?
  if (l.site.statut === 'reseaux') raisons.push(/business\.site|g\.page/.test(l.site.url) ? 'Avait une page Google gratuite, fermée par Google en 2024 : il a déjà voulu un site' : 'Seulement une page de réseau social ou d\'annuaire : il cherche déjà à être visible');
  else if (l.site.statut === 'douteux') raisons.push('Aucun site trouvé à son nom (un site homonyme existe : à vérifier)');
  else raisons.push(l._google ? 'Aucun site sur sa fiche Google' : 'Aucun site trouvé');

  // 2. Peut-on le joindre ?
  if (l.telephone) raisons.push('Téléphone connu');
  if (l.email) raisons.push('Adresse email connue');

  // 3. Le commerce est-il actif et établi ?
  let activite = 0;
  if (l._google && l.avis >= 20 && l.note >= 4) { activite += 2; raisons.push(`${l.avis} avis Google, note ${String(l.note).replace('.', ',')} : une clientèle réelle à montrer`); }
  else if (l._google && l.avis >= 5) { activite += 1; raisons.push(`${l.avis} avis Google`); }
  if (l.vitrine) { activite += 1; raisons.push('Commerce visible sur la carte (vitrine ou local)'); }
  if (l.employeur) { activite += 1; raisons.push('A des salariés'); }
  if (anciennete >= 3) { activite += 1; raisons.push(`Installé depuis ${anciennete} ans`); }
  if (!activite) raisons.push('Peu de signes d\'activité : probablement un indépendant à domicile ou une entreprise récente');

  // A : on peut l'appeler tout de suite (téléphone connu) et au moins un signe montre que le commerce tourne.
  // B : le commerce tourne mais le téléphone manque (à chercher sur Google Maps), ou l'inverse.
  // C : ni contact ni signe d'activité.
  let note = l.telephone && activite >= 1 ? 'A' : activite >= 1 || l.telephone || l.email ? 'B' : 'C';
  if (confiance === 'faible' && note === 'A') note = 'B'; // on ne met pas en tête un prospect dont la présence web reste à vérifier
  return { classement: note, raisons, confiance };
}

// Regroupe tout ce que les sources savent sur l'entreprise, puis cherche son site si aucune source ne l'a donné.
async function finaliser(l, commune) {
  const g = l._google; const o = l._osm;
  if (o) {
    l._sources.push('OpenStreetMap');
    l.vitrine = true;
    l.telephone ||= formaterTelephone(o.tags.phone ?? o.tags['contact:phone'] ?? o.tags['contact:mobile']);
    l.email = (o.tags.email ?? o.tags['contact:email'] ?? '').split(/[;,\s]/)[0];
    if (l.email) l.emailSource = 'carte';
  }
  if (g) {
    l._sources.push('Google Maps');
    l.telephone = formaterTelephone(g.nationalPhoneNumber) || l.telephone;
    l.note = g.rating ?? null;
    l.avis = g.userRatingCount ?? 0;
    l.mapsUrl = g.googleMapsUri ?? l.mapsUrl;
    l.vitrine = true;
  }

  const noms = [...l._noms, ...(g ? [g.displayName?.text] : []), ...(o ? [o.tags.name] : [])].filter(Boolean);
  const franchise = normaliser(`${noms.join(' ')} ${o?.tags.brand ?? ''}`).match(FRANCHISES);
  if (franchise || l._chaine || o?.tags.brand || o?.tags['brand:wikidata']) {
    l.site = { statut: 'franchise', url: siteDepuisURL(g?.websiteUri, '')?.url ?? '', source: `Franchise / réseau ${franchise ? `« ${titre(franchise[1])} »` : o?.tags.brand ?? ''} : déjà sur le site de l'enseigne`.replace(/\s+:/, ' :') };
  } else {
    const connus = [siteDepuisURL(g?.websiteUri, 'Fiche Google'), o && siteDepuisOSM(o.tags)].filter(Boolean);
    l.site = connus.find((s) => s.statut === 'oui');
    if (!l.site) {
      const domaine = await detecterSiteParDomaine([...new Set(noms)], commune, l.cp, l.telephone);
      if (domaine.statut === 'oui') l.site = domaine;
      else {
        l.site = connus.find((s) => s.statut === 'reseaux')
          ?? (g ? { statut: 'non', url: '', source: 'Aucun site sur la fiche Google, ni à son nom' } : domaine);
        if (domaine.statut === 'douteux' && l.site.statut !== 'douteux') l.site.source += ` (domaine homonyme : ${domaine.url})`;
      }
    }
  }

  l.pays = commune.pays ?? 'fr';
  Object.assign(l, classement(l)); // classement, raisons, confiance
  l.source = [...new Set(l._sources)].join(' + ');
  for (const k of Object.keys(l)) if (k.startsWith('_')) delete l[k];
  return l;
}

// ---------------------------------------------------------------------------------------------
// Recherche complète

/**
 * @param {object} p
 * @param {string} p.ville         nom, code postal ou « Nom (CP) »
 * @param {string} p.metier        clé de METIERS ou « tous »
 * @param {number} [p.rayon]       km autour du centre ; vide = la commune uniquement
 * @param {string} [p.cleGoogle]   clé Places API (New) ; absente = sources gratuites seulement
 * @param {number} [p.budgetGoogle] nombre maximum de requêtes Google autorisées pour cette recherche
 * @param {string} [p.dossierCache]
 */
export async function rechercher({ ville, metier: cleMetier, rayon, cleGoogle, budgetGoogle = Infinity, dossierCache }, progres = () => {}) {
  const metier = resoudreMetier(cleMetier);
  const rayonKm = Number(rayon) > 0 ? Math.min(Math.max(Number(rayon), 0.5), 50) : null;
  const avertissements = [];
  const google = { cle: cleGoogle, restant: budgetGoogle, utilisees: 0, quotaAtteint: false };

  progres(2, 'Localisation de la commune…');
  const commune = await trouverCommune(ville);
  const motsVille = new Set((commune.alias ?? [commune.nom]).flatMap(jetons));

  // 1. Registre officiel (France uniquement)
  const max = metier.tous ? 3000 : 600;
  let lignes = [];
  if (commune.etranger) {
    avertissements.push(`${commune.nom} est hors de France (${commune.paysNom}) : le registre officiel français ne s'applique pas. `
      + `Les résultats viennent d'OpenStreetMap${cleGoogle ? ' et de Google Maps' : ''} : pas de nom de dirigeant ni de numéro d'entreprise, et les commerces absents de la carte ne sont pas listés. `
      + 'Vérifie aussi les règles locales de démarchage téléphonique avant d\'appeler.');
  } else {
    progres(3, 'Registre officiel des entreprises…');
    const etabs = await chercherSirene(commune, metier, rayonKm, max,
      (p, t) => progres(3 + Math.round((p / t) * 22), `Registre officiel des entreprises : page ${p}/${t}`));
    lignes = etabs.map((e) => ligneDepuisSirene(e, commune));
  }

  // 2. OpenStreetMap
  progres(26, 'OpenStreetMap : vitrines, téléphones et sites connus…');
  try {
    const lieux = await chercherOSM(commune, metier, rayonKm, dossierCache);
    const orphelins = rapprocher(lignes, lieux, {
      nomCandidat: (l) => l.tags.name, latLon: (l) => [l.lat, l.lon], telephone: () => '', champ: '_osm', distanceMax: 400, motsVille,
      memeMetier: (ligne, lieu) => ligne.categorie === lieu.metier.label,
    });
    lignes.push(...orphelins.map((o) => ligneDepuisOSM(o, commune)));
    // Téléphones OSM tout de suite : ils servent aussi à reconnaître l'entreprise sur Google.
    for (const l of lignes) if (l._osm) l.telephone = formaterTelephone(l._osm.tags.phone ?? l._osm.tags['contact:phone'] ?? l._osm.tags['contact:mobile']);
  } catch {
    avertissements.push('OpenStreetMap ne répond pas en ce moment : cette recherche n\'a pas ses vitrines et téléphones. Relance-la plus tard pour les avoir.');
  }

  // 3. Google Maps
  if (cleGoogle) {
    if (google.restant <= 0) {
      avertissements.push('Quota Google du mois atteint (voir Réglages) : recherche faite sans Google Maps.');
    } else {
      try {
        const parId = new Map();
        for (const [i, m] of metier.sousMetiers.entries()) {
          progres(32 + Math.round((i / metier.sousMetiers.length) * 28), `Google Maps : ${m.label} (${google.utilisees} requêtes)`);
          for (const l of await chercherGoogleMetier(commune, rayonKm, m, google)) if (!parId.has(l.id)) parId.set(l.id, l);
          if (google.quotaAtteint) break;
        }
        if (google.quotaAtteint) avertissements.push(`Quota Google du mois atteint pendant la recherche : certains métiers n'ont pas été cherchés sur Google Maps.`);

        // Même entreprise dans le registre ou sur OSM → on fusionne ; sinon on cherche son SIRET pour fusionner quand même.
        const orphelins = rapprocher(lignes, [...parId.values()], {
          nomCandidat: (g) => g.displayName?.text ?? '', latLon: (g) => [g.location?.latitude, g.location?.longitude],
          telephone: (g) => g.nationalPhoneNumber, champ: '_google', distanceMax: 250, motsVille,
        });
        const parSiret = new Map(lignes.map((l) => [l.siret, l]).filter(([s]) => s));
        progres(61, `Google Maps : ${orphelins.length} entreprises en plus, recherche de leur SIRET…`);
        await parLots(orphelins, 4, async (g) => {
          const cp = g.formattedAddress?.match(/\b(\d{5})\b/)?.[1];
          const sirene = cp && !commune.etranger ? await enrichirSirene(g.displayName?.text ?? '', cp) : {};
          const existante = sirene.siret && parSiret.get(sirene.siret);
          if (existante && !existante._google) existante._google = g;
          else if (!existante) lignes.push(ligneDepuisGoogle(g, commune, sirene, metier.tous));
        }, (fait, total) => progres(61 + Math.round((fait / total) * 6), `Google Maps : SIRET des entreprises en plus ${fait}/${total}`));
      } catch (e) {
        avertissements.push(`Google Maps a refusé la recherche : ${messageErreurGoogle(e.message)} La recherche a continué avec les sources gratuites.`);
      }
    }
  }

  // 4. Sites web + fusion finale
  progres(68, `Vérification des sites web de ${lignes.length} entreprises…`);
  const finales = await parLots(lignes, 16, (l) => finaliser(l, commune),
    (fait, total) => progres(68 + Math.round((fait / total) * 31), `Vérification des sites web : ${fait}/${total}`));

  finales.sort((a, b) => a.classement.localeCompare(b.classement) || (b.avis ?? 0) - (a.avis ?? 0) || a.nom.localeCompare(b.nom));
  const sansSite = finales.filter((l) => !ESTSITE(l.site));
  const avecGoogle = finales.filter((l) => l.source.includes('Google')).length;
  progres(100, 'Terminé');
  return {
    meta: {
      ville: commune.nom, cp: commune.cp, insee: commune.insee, pays: commune.pays ?? 'fr', paysNom: commune.paysNom ?? 'France', zone: rayonKm ? `${commune.nom} + ${rayonKm} km` : commune.nom, rayon: rayonKm,
      metier: metier.cle, metierLabel: metier.label, mode: avecGoogle ? 'complet' : 'gratuit',
      requetesGoogle: google.utilisees, date: new Date().toISOString(),
      total: finales.length, sansSite: sansSite.length, prioritaires: sansSite.filter((l) => l.classement === 'A').length,
      avecGoogle, avertissements,
    },
    lignes: finales,
  };
}
