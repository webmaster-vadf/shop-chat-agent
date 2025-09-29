// vadf-intent-matcher.js
// Utilitaire pour tester localement la correspondance d'intentions et la sélection de réponses

import fs from 'fs/promises';
import path from 'path';

const RESPONSES_PATH = path.resolve(process.cwd(), 'app/prompts/vadf_reponses.json');

// Mappe les mots-clés d'intention à la clé du JSON
const intentKeywords = [
  { key: 'activation_compte', patterns: [/activation.*compte|activer.*compte|mon compte.*actif/i] },
  { key: 'mot_de_passe_oublie', patterns: [/mot de passe.*oubli|réinitialis.*mot de passe|j'ai oublié.*mot de passe/i] },
  { key: 'mise_a_jour_infos_entreprise', patterns: [/modifier.*(email|adresse|coordonnée)/i] },
  { key: 'escalade_support', patterns: [/transmettre.*support|problème.*complexe|contacter.*support/i] }
];

function detectIntent(userInput) {
  for (const intent of intentKeywords) {
    for (const pattern of intent.patterns) {
      if (pattern.test(userInput)) return intent.key;
    }
  }
  return null;
}

async function getVadfResponses() {
  const data = await fs.readFile(RESPONSES_PATH, 'utf-8');
  return JSON.parse(data);
}

export async function getResponseForUserInput(userInput, mode = 'random') {
  const intent = detectIntent(userInput);
  if (!intent) return "Je n'ai pas compris votre demande. Pouvez-vous préciser ?";
  const responses = await getVadfResponses();
  const arr = responses[intent];
  if (!arr || arr.length === 0) return "Aucune réponse disponible pour cette intention.";
  if (mode === 'sequential') {
    // Pour le test local, on prend la première réponse (peut être amélioré avec un index persistant)
    return arr[0];
  }
  // Par défaut, réponse aléatoire
  return arr[Math.floor(Math.random() * arr.length)];
}

// Exemple d'utilisation locale :
// (async () => {
//   const userInput = "J'ai oublié mon mot de passe";
//   const response = await getResponseForUserInput(userInput);
//   console.log(response);
// })();
