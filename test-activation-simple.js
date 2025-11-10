// Test simple de la réponse activation_compte
import fs from 'fs/promises';

async function testActivationResponse() {
  console.log('🧪 TEST: Réponse activation_compte');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Charger le fichier JSON directement
  const jsonContent = await fs.readFile('./app/prompts/vadf_reponses.json', 'utf-8');
  const vadfResponses = JSON.parse(jsonContent);

  // Test 1: Vérifier que l'intent existe
  const intentExists = !!vadfResponses.intents.activation_compte;
  console.log('✅ Intent activation_compte existe:', intentExists ? 'OUI ✓' : 'NON ✗');
  console.log('');

  // Test 2: Récupérer la première réponse (celle sans conditions)
  const responses = vadfResponses.intents.activation_compte.responses;
  const defaultResponse = responses.find(r => !r.conditions || r.conditions.length === 0);

  if (!defaultResponse) {
    console.log('❌ Aucune réponse par défaut trouvée !');
    return;
  }

  console.log('📤 Réponse par défaut trouvée:');
  console.log('───────────────────────────────────────────────────────────');
  console.log(defaultResponse.text);
  console.log('───────────────────────────────────────────────────────────');
  console.log('');

  // Test 3: Vérification du contenu
  const containsSubject = defaultResponse.text.includes('Activation de compte');
  const containsEmail = defaultResponse.text.includes('support@vadf.fr');
  const containsObjet = defaultResponse.text.includes('objet de votre email');

  console.log('✅ Contient "Activation de compte":', containsSubject ? 'OUI ✓' : 'NON ✗');
  console.log('✅ Contient "support@vadf.fr":', containsEmail ? 'OUI ✓' : 'NON ✗');
  console.log('✅ Contient "objet de votre email":', containsObjet ? 'OUI ✓' : 'NON ✗');
  console.log('');

  if (containsSubject && containsEmail && containsObjet) {
    console.log('🎉 TEST RÉUSSI ! La réponse contient tous les éléments attendus.');
    console.log('');
    console.log('📋 Résumé: La réponse indique bien de mentionner "Activation de compte"');
    console.log('   dans l\'objet de l\'email à support@vadf.fr');
  } else {
    console.log('❌ TEST ÉCHOUÉ ! La réponse ne contient pas tous les éléments attendus.');
  }
}

testActivationResponse().catch(console.error);
