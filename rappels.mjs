// Rappels sur le PC : notifications Windows pour les rendez-vous et les relances.
//
//  - Rendez-vous : la veille au soir, le matin même, 1 h avant et 15 min avant.
//  - Relances    : une notification groupée par jour (« 3 prospects à relancer aujourd'hui »).
//
// Les notifications sont envoyées par le serveur tant qu'il tourne ; l'option « démarrer avec Windows »
// (raccourci dans le dossier Démarrage) le lance en arrière-plan à l'ouverture de session.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

const STATUTS_TERMINES = ['signe', 'refus'];

const deuxChiffres = (n) => String(n).padStart(2, '0');
export const jourLocal = (d) => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
const heureTexte = (d) => `${d.getHours()}h${deuxChiffres(d.getMinutes())}`;

/**
 * Liste les notifications à envoyer maintenant.
 * @param {object} prospects   contenu de prospects.json
 * @param {Date}   maintenant
 * @param {object} envoyes     clés des rappels déjà envoyés
 * @param {string} adresse     adresse de l'outil (http://localhost:4321)
 * @returns {{cles: string[], titre: string, texte: string, url: string}[]}
 */
export function calculerRappels(prospects, maintenant, envoyes, adresse) {
  const rappels = [];
  const aujourdhui = jourLocal(maintenant);
  const demain = jourLocal(new Date(maintenant.getTime() + 864e5));
  const heure = maintenant.getHours();

  for (const [id, p] of Object.entries(prospects)) {
    if (!p.rdv?.date || !p.ligne || STATUTS_TERMINES.includes(p.statut)) continue;
    const quand = new Date(p.rdv.date);
    const minutes = (quand - maintenant) / 60000;
    if (Number.isNaN(minutes) || minutes <= 0) continue;

    const base = `rdv|${id}|${p.rdv.date}`;
    const details = [p.rdv.lieu || p.ligne.adresse, p.telephone || p.ligne.telephone].filter(Boolean).join(' · ');
    // On n'envoie que le rappel le plus proche : s'il est 14h50 pour un RDV à 15h, inutile d'envoyer aussi « dans 1 h ».
    let type; let titre;
    if (minutes <= 15) { type = '15min'; titre = `Dans ${Math.max(1, Math.round(minutes))} min : RDV ${p.ligne.nom}`; }
    else if (minutes <= 60) { type = '1h'; titre = `Dans ${Math.round(minutes)} min : RDV ${p.ligne.nom}`; }
    else if (jourLocal(quand) === aujourdhui && heure >= 7) { type = 'matin'; titre = `Aujourd'hui à ${heureTexte(quand)} : RDV ${p.ligne.nom}`; }
    else if (jourLocal(quand) === demain && heure >= 17) { type = 'veille'; titre = `Demain à ${heureTexte(quand)} : RDV ${p.ligne.nom}`; }
    else continue;

    const ordre = ['veille', 'matin', '1h', '15min'];
    if (envoyes[`${base}|${type}`]) continue;
    rappels.push({
      cles: ordre.slice(0, ordre.indexOf(type) + 1).map((t) => `${base}|${t}`),
      titre, texte: details, url: `${adresse}/#fiche=${encodeURIComponent(id)}`,
    });
  }

  // Relances du jour (et en retard), à partir de 8 h
  const cleRelances = `relances|${aujourdhui}`;
  if (heure >= 8 && !envoyes[cleRelances]) {
    const aRelancer = Object.values(prospects)
      .filter((p) => p.ligne && p.relance && p.relance <= aujourdhui && p.statut && !STATUTS_TERMINES.includes(p.statut));
    if (aRelancer.length) {
      const noms = aRelancer.slice(0, 4).map((p) => p.ligne.nom).join(', ') + (aRelancer.length > 4 ? '…' : '');
      rappels.push({
        cles: [cleRelances],
        titre: aRelancer.length === 1 ? `À relancer aujourd'hui : ${aRelancer[0].ligne.nom}` : `${aRelancer.length} prospects à relancer aujourd'hui`,
        texte: aRelancer.length === 1 ? (aRelancer[0].telephone || aRelancer[0].ligne.telephone || '') : noms,
        url: aRelancer.length === 1
          ? `${adresse}/#fiche=${encodeURIComponent(Object.entries(prospects).find(([, p]) => p === aRelancer[0])[0])}`
          : `${adresse}/#relances`,
      });
    }
  }
  return rappels;
}

// ---------------------------------------------------------------------------------------------
// Notification Windows (toast). Le texte passe par des variables d'environnement : rien n'est interprété.

const SCRIPT_TOAST = `
$ErrorActionPreference = 'Stop'
$appId = 'Prospecteur.Rappels'
$cle = "HKCU:\\Software\\Classes\\AppUserModelId\\$appId"
if (-not (Test-Path $cle)) {
  New-Item -Path $cle -Force | Out-Null
  New-ItemProperty -Path $cle -Name DisplayName -Value 'Prospecteur' -PropertyType String -Force | Out-Null
}
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$e = { param($s) [System.Security.SecurityElement]::Escape($s) }
$url = & $e $env:PROSPECTEUR_URL
$lignes = @($env:PROSPECTEUR_TITRE) + @(($env:PROSPECTEUR_TEXTE -split [char]10) | Where-Object { $_ } | Select-Object -First 2)
$textes = ($lignes | ForEach-Object { '<text>' + (& $e $_) + '</text>' }) -join ''
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast scenario="reminder" activationType="protocol" launch="' + $url + '"><visual><binding template="ToastGeneric">' + $textes + '</binding></visual><actions><action content="Ouvrir la fiche" activationType="protocol" arguments="' + $url + '"/><action content="OK" activationType="system" arguments="dismiss"/></actions></toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
`;

function powershell(script, env = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve({ ok: false, erreur: 'Les notifications ne fonctionnent que sous Windows.' }); return; }
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { env: { ...process.env, ...env }, windowsHide: true });
    let erreur = '';
    p.stderr.on('data', (d) => { erreur += d; });
    p.on('error', (e) => resolve({ ok: false, erreur: e.message }));
    p.on('close', (code) => resolve({ ok: code === 0, erreur: code === 0 ? '' : erreur.replace(/#< CLIXML[\s\S]*/, '').trim() || `code ${code}` }));
  });
}

export function notifier({ titre, texte = '', url }) {
  return powershell(SCRIPT_TOAST, { PROSPECTEUR_TITRE: titre, PROSPECTEUR_TEXTE: texte, PROSPECTEUR_URL: url });
}

// ---------------------------------------------------------------------------------------------
// Démarrage avec Windows : un raccourci dans le dossier « Démarrage » de l'utilisateur (aucun droit admin).

const raccourciDemarrage = () => path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Prospecteur (rappels).lnk');

export const demarrageActif = () => process.platform === 'win32' && existsSync(raccourciDemarrage());

export async function reglerDemarrage(actif, dossierOutil) {
  if (!actif) { await unlink(raccourciDemarrage()).catch(() => {}); return { ok: true }; }
  return powershell(`
$ErrorActionPreference = 'Stop'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:PROSPECTEUR_LNK)
$s.TargetPath = "$env:SystemRoot\\System32\\wscript.exe"
$s.Arguments = '"' + $env:PROSPECTEUR_VBS + '"'
$s.WorkingDirectory = $env:PROSPECTEUR_DOSSIER
$s.Description = 'Prospecteur : rappels de rendez-vous en arriere-plan'
$s.Save()
`, { PROSPECTEUR_LNK: raccourciDemarrage(), PROSPECTEUR_VBS: path.join(dossierOutil, 'arriere-plan.vbs'), PROSPECTEUR_DOSSIER: dossierOutil });
}
