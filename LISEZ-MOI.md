# Prospecteur

Ton outil pour trouver les entreprises **sans site web**, les appeler avec un script personnalisé et suivre tes prospects.
Il tourne **uniquement sur ton ordinateur** : personne d'autre ne peut y accéder, et tes données restent chez toi.

## Ouvrir l'outil

**Double-clic sur l'icône « Prospecteur » du Bureau** (ou sur `LANCER.bat`) : l'outil s'ouvre dans ton navigateur (adresse : http://localhost:4321).

- L'outil tourne **en arrière-plan, sans fenêtre**. Il n'y a rien à garder ouvert : tu peux fermer l'onglet, les rappels continuent d'arriver.
- Avec l'option « Démarrer avec Windows » (onglet Réglages), il se lance tout seul à l'allumage du PC. L'adresse http://localhost:4321 marche alors en permanence, tu peux la mettre en favori.
- Pour l'arrêter complètement : Réglages → « Arrêter l'outil ».
- En cas de problème au démarrage, l'erreur est écrite dans `donnees/journal.log`.
- Il faut [Node.js](https://nodejs.org) (déjà installé sur ce PC).

## L'appel guidé

Dans la fiche du prospect, bouton **« 📞 Lancer l'appel guidé »**. Aucune IA, aucun coût : c'est un arbre de conversation.

- L'écran affiche **ce que tu dois dire**, en gros, personnalisé avec le nom, le dirigeant, le métier, l'ancienneté et les avis.
- En dessous, des boutons : **ce que le prospect vient de répondre** (« C'est combien ? », « J'ai déjà Facebook », « Pas le temps »…). Tu cliques (ou tu tapes le chiffre 1 à 9), et l'écran t'affiche la bonne réponse, puis la suite.
- À droite : une antisèche (dirigeant, avis, présence web) et un champ pour tes notes pendant l'appel.
- Touche Retour arrière : revenir à l'étape précédente.
- À la fin, **« Terminer et noter l'appel »** ouvre le compte rendu déjà rempli : résultat, objections entendues, critères de qualification. Tu complètes la date et tu enregistres.
- Après quelques appels, l'onglet Mes prospects affiche ton bilan : personnes jointes, rendez-vous obtenus, objections les plus fréquentes.

### Citer un vrai avis client

Bloc **« Avis client à citer dans l'accroche »** de la fiche : colle un avis lu sur la fiche Google Maps du commerce (et le prénom du client si tu veux). L'accroche de l'appel, le script et l'email le citent alors mot pour mot.
Avec une clé Google, le bouton « Récupérer ses avis Google » les affiche directement (1 requête par entreprise) : vérifie que la fiche trouvée est la bonne, puis clique sur « Citer cet avis ».
**N'utilise que des avis réels** : le commerçant connaît les siens.

Dans Réglages, le champ « Prix de départ d'un site » sert à la réponse « C'est combien ? ».

## Le script IA (facultatif, payant à l'usage)

Dans la fiche, onglet **« ✨ Script IA »** : Claude rédige un script d'appel sur mesure (préparation, ouverture, accroche, questions propres au métier, proposition, objections probables, conclusion). Il s'appuie sur la fiche, l'avis client cité, tes notes et tes appels précédents, et a pour consigne de ne rien inventer. **Relis-le toujours avant d'appeler.**

- Il faut une **clé Anthropic** (compte développeur sur platform.claude.com, séparé de l'abonnement Claude) : Réglages → « Script IA », le guide est sur place.
- Coût par script, en ordre de grandeur : Opus 5.5 environ 0,05 à 0,10 $ ; Sonnet 5.5 environ 0,03 à 0,05 $ ; Haiku 5.5 moins de 0,01 $. Le modèle se choisit dans Réglages, et le coût exact s'affiche après chaque génération.
- Un **plafond mensuel** (5 $ par défaut) bloque l'outil quand il est atteint.
- Le script est gardé dans la fiche : il n'est facturé qu'une fois, sauf si tu cliques sur « Régénérer » (utile après un nouvel appel, pour qu'il tienne compte de ce qui s'est dit).
- Le script IA s'affiche aussi dans l'appel guidé, colonne de droite.

L'appel guidé et les modèles de script restent gratuits et fonctionnent sans clé.

## Les emails de prospection (onglet « Emails »)

L'onglet liste les entreprises dont l'email est connu et prépare pour chacune une séquence de 3 messages : un premier email, une relance 4 jours après, un dernier message 7 jours plus tard. La séquence s'arrête dès que tu cliques sur « A répondu » ou « Ne plus contacter ».

**Deux types de proposition, choisis automatiquement :**
- **Création** : l'entreprise n'a pas de site. L'email le constate et propose une maquette gratuite.
- **Refonte** : l'entreprise a un site, et l'outil y a relevé au moins un défaut vérifiable (pas adapté aux téléphones, pas sécurisé, année ancienne en bas de page). L'email cite ces défauts. Un site sans défaut constaté n'est pas proposé : l'outil n'invente pas d'argument.

**Trouver des adresses :**
- la carte (OpenStreetMap) en fournit quelques-unes ;
- le bouton **« Chercher les emails sur les sites de la recherche affichée »** lit la page d'accueil et la page de contact de chaque site existant (150 sites par clic) ;
- tu peux saisir une adresse dans le champ Email d'une fiche, par exemple après un « envoyez-moi un mail ».

**Envoyer, au choix :**
- **Depuis ta messagerie** (rien à régler) : le bouton « Ma messagerie » ouvre l'email tout prêt, tu l'envoies toi-même, puis tu confirmes dans l'outil. Les relances te sont proposées le moment venu.
- **Envoi par l'outil** : Réglages → « Envoi d'emails » (adresse, mot de passe d'application, guide Gmail sur place). Tu coches les destinataires, tu relis (« Lire »), tu valides. L'outil envoie alors un email par minute au plus, du lundi au vendredi de 8 h 30 à 18 h 30, dans la limite du plafond quotidien (15 par défaut), et les relances partent toutes seules (case décochable).

**Ce qui protège ta boîte mail :**
- **Montée progressive** (Réglages, activée par défaut) : 5 emails par jour au début, puis 5 de plus tous les trois jours d'envoi, jusqu'à ton maximum. Une boîte qui écrit d'un coup à 25 inconnus se fait classer comme spam.
- **Emails en texte simple**, sans lien, sans image et sans mouchard d'ouverture. C'est pour ça que l'outil ne mesure pas les ouvertures : seules les réponses comptent.
- **« Me l'envoyer pour voir »** (dans l'aperçu d'un email) : envoie un exemplaire à une autre de tes adresses, pour vérifier s'il arrive en réception ou en spam avant de te lancer.
- **« Adresse invalide »** : à cliquer quand tu reçois un message d'erreur (« Mail Delivery Subsystem »). Trop d'adresses inexistantes abîment la réputation de ta boîte.

**Les objets** tiennent en 35 caractères (au-delà, ils sont coupés sur téléphone), sans majuscule ni ponctuation. Deux formulations alternent d'un prospect à l'autre, et le bloc **Résultats** de l'onglet compare leurs taux de réponse. Ne conclus rien avant une cinquantaine d'envois par formulation.

**Chaque email dit d'où vient l'adresse** (ton site, la fiche publique du commerce…) : c'est une obligation quand on écrit à quelqu'un qui ne nous a pas donné son adresse. Hors de France, l'outil ne propose que les adresses génériques (info@, contact@).

**Garde-fous :** un email qui contient encore un trou entre crochets (profil incomplet) est refusé ; une adresse ne reçoit jamais deux séquences ; la liste « Ne plus contacter » est toujours respectée ; chaque envoi est noté dans l'historique de la fiche. L'outil ne lit pas ta boîte de réception : c'est à toi de signaler les réponses.

**À savoir :** en France, écrire à une entreprise sans son accord est permis si l'offre concerne son activité, si tu te présentes clairement et si elle peut refuser simplement (la dernière ligne de chaque email sert à ça). Les règles changent selon le pays : renseigne-toi avant d'écrire à l'étranger. Reste à 15 ou 20 emails par jour pour ne pas être classé comme spam.

## Après chaque appel ou visite

Dans la fiche du prospect, bouton **« ＋ Noter un appel ou une visite »** :

1. Le type (appel, visite, email/SMS) et le **résultat**. Le statut se met à jour tout seul :
   - *Pas de réponse*, *Message laissé*, *À rappeler*, *Intéressé* → une **date de relance** est proposée (modifiable) ;
   - *RDV pris* → tu indiques le **jour, l'heure et le lieu** ;
   - *Pas intéressé* ou *Signé* → le prospect sort de tes actions à faire.
2. Une note sur ce qui s'est dit. Chaque contact s'ajoute à l'**historique** de la fiche.
3. La **qualification** : 4 cases à cocher (décideur, besoin, prix, délai). 3 ou 4 cases = prospect **chaud**, 1 ou 2 = tiède, 0 = froid.

## Rappels sur le PC

Windows affiche une notification en bas à droite de l'écran :

- pour chaque **rendez-vous** : la veille à partir de 17 h, le matin, 1 h avant et 15 min avant ;
- chaque matin à partir de 8 h s'il y a des **prospects à relancer** (date de relance arrivée ou dépassée).

Un clic sur la notification ouvre la fiche. L'onglet **Mes prospects** affiche en haut la liste « À faire » (rendez-vous à venir, rendez-vous passés à noter, relances), et sa pastille compte les actions du jour.
Le bouton « Ajouter à Google Agenda » de la fiche crée aussi l'événement dans ton agenda, pour avoir le rappel sur ton téléphone.

Si le PC est éteint à l'heure d'un rappel, tu reçois le suivant à l'allumage. Si aucune notification n'apparaît : Réglages → « Envoyer une notification de test », et vérifie que le mode « Ne pas déranger » de Windows est désactivé.

## Comment ça marche

1. **Rechercher** : tape une ville, choisis un métier ou garde « Tous les métiers », puis lance la recherche.
   - Un métier : environ 20 secondes. Une ville entière : 2 à 5 minutes (chaque entreprise est vérifiée).
   - Chaque recherche est enregistrée : tu la retrouves en un clic sous la barre de recherche.
2. **Filtrer** : « Sans site », priorité A/B/C, catégorie, ou recherche par nom ou par rue. Clique sur les chiffres du haut pour filtrer directement.
3. **Ouvrir la fiche d'une entreprise** (un clic sur la ligne) :
   - liens vers **Google Maps**, **Google** et **Pages Jaunes** pour vérifier et trouver le téléphone ;
   - boutons **« Vérifié : pas de site »** / **« Il a un site »** pour corriger la détection ;
   - **statut** (À contacter, Appelé, À rappeler, RDV, Signé, Refus), **date de relance** et **notes** ;
   - **script d'appel, email, SMS, message de répondeur et email de relance**, déjà personnalisés avec le nom, le dirigeant, les avis et l'ancienneté. Il suffit de les copier.
4. **Mes prospects** : toutes les entreprises à qui tu as donné un statut, toutes recherches confondues. Le filtre « ⏰ À relancer » affiche celles dont la date de relance est arrivée.
5. **Excel** : le bouton exporte la liste affichée.
6. **Réglages** : remplis ton profil (prénom, téléphone…) pour qu'il s'insère dans les scripts.

## Villes hors de France

Tu peux taper une ville étrangère : `Bruxelles`, `Genève`, `Luxembourg`, ou `Liège, Belgique` pour lever une ambiguïté.

- Le registre officiel des entreprises est français : hors de France, les résultats viennent d'**OpenStreetMap** (et de Google Maps si tu as une clé). Il n'y a donc **ni dirigeant, ni numéro d'entreprise, ni date de création**, et les commerces absents de la carte ne sont pas listés.
- Les téléphones gardent leur indicatif (+32, +41…). Quand la carte la connaît, l'**adresse email** du commerce est affichée (icône ✉ dans la liste, champ Email dans la fiche).
- Si la carte ne donne pas la rue, l'outil la retrouve à l'ouverture de la fiche, à partir de la position du commerce.
- Une grande ville, tous métiers confondus, représente plusieurs milliers de commerces : compte 10 minutes ou plus. Commence par un seul métier.
- **Renseigne-toi sur les règles locales de démarchage** avant d'appeler (en Belgique, par exemple, il existe une liste « Ne m'appelez plus »).

## D'où viennent les données

Chaque recherche **croise les 4 sources** et fusionne les fiches d'une même entreprise (nom proche au même endroit, ou même téléphone) :

| Source | Ce qu'elle apporte | Coût |
|---|---|---|
| Registre officiel des entreprises (SIRENE) | Toutes les entreprises déclarées : nom, adresse, dirigeant, SIRET, date de création, présence de salariés | Gratuit |
| OpenStreetMap | Les vitrines visibles sur la carte, des **téléphones** et des **sites** | Gratuit |
| **Google Maps** (avec une clé) | Toutes les fiches Google : **téléphone, note, nombre d'avis, site déclaré**. Les entreprises absentes du registre sont ajoutées. Sur les grandes villes, la carte est découpée en zones pour dépasser la limite de 60 résultats de Google | ~1 000 requêtes gratuites par mois |
| Détection automatique | Teste les sites au nom de l'entreprise (`nom.fr`, `nom-ville.fr`…) et vérifie qu'ils parlent bien de la ville | Gratuit |

Sans clé Google, la mention « Aucun site trouvé » reste une **estimation**, et il manque la plupart des téléphones : vérifie la fiche Google Maps avant d'appeler (un clic dans la fiche), puis confirme avec « Vérifié : pas de site ».

### Activer Google (10 minutes, une seule fois)

Onglet **Réglages** → « Obtenir ta clé » : 6 liens directs à suivre dans l'ordre (créer le projet, activer la facturation, activer Places API, créer la clé, la coller, fixer un plafond journalier).

**Coût :** l'outil compte chaque requête Google et **s'arrête tout seul avant la limite mensuelle** fixée dans Réglages (900 par défaut, sous le quota gratuit de Google). Ordre de grandeur : un métier dans une ville ≈ 1 à 5 requêtes ; une ville entière, tous métiers ≈ 40 à 150 requêtes selon sa taille. Soit environ 6 à 20 villes complètes par mois, gratuitement.

Les chaînes et franchises (Century 21, Franprix, Point S…) sont écartées ou marquées « Franchise ». Les chauffeurs VTC ne sont pas inclus dans « Tous les métiers » (trop nombreux) ; choisis « Taxi / VTC » pour les voir.

## Priorités

- **A** : à contacter en premier. Pas de vrai site, un téléphone connu, et au moins un signe que le commerce tourne (vitrine sur la carte, salariés, 3 ans d'existence, avis Google).
- **B** : le commerce tourne mais le téléphone manque (à chercher sur Google Maps), ou l'inverse.
- **C** : ni contact ni signe d'activité (souvent un indépendant à domicile ou une entreprise récente).

La fiche de chaque prospect explique son classement (bloc « Pourquoi cette priorité ») et indique un niveau de confiance : haute si plusieurs sources concordent, moyenne avec une seule source, faible si sa présence en ligne reste à vérifier. Sans clé Google, la plupart des prospects sont en B, faute de téléphone.

## Tes données

Tout est dans le dossier `donnees` :
- `recherches/` : les résultats de chaque recherche ;
- `prospects.json` : tes statuts, notes, relances et corrections. **C'est le fichier le plus précieux : sauvegarde-le de temps en temps** ;
- `config.json` : ton profil, ta clé Google et ta limite mensuelle (ne le partage pas) ;
- `usage-google.json` : le compteur de requêtes Google du mois ;
- `cache/` : les données OpenStreetMap, gardées 7 jours pour accélérer les recherches.

## Ajouter un métier

Dans `moteur.mjs`, liste `METIERS` : ajoute une ligne avec les codes NAF (voir [insee.fr](https://www.insee.fr/fr/information/2406147)), les étiquettes OpenStreetMap, le mot-clé Google et l'angle d'attaque. Relance ensuite `LANCER.bat`.
