// vadf-response-manager.js
// Gestionnaire pour charger les réponses-types VADF depuis le fichier JSON

import fs from 'fs/promises';
import path from 'path';

const RESPONSES_PATH = path.resolve(process.cwd(), 'app/prompts/vadf_reponses.json');

export async function getVadfResponses() {
  try {
    const data = await fs.readFile(RESPONSES_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lors du chargement des réponses VADF:', error);
    return null;
  }
}

// Utilisation possible :
// const responses = await getVadfResponses();
// responses.activation_compte
