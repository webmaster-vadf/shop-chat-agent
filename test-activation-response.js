// Test rapide de la réponse activation_compte
import { getVadfManager } from './app/services/vadf-response-manager.js';

async function testActivationResponse() {
  console.log('🧪 TEST: Réponse activation_compte');
  console.log('═══════════════════════════════════════════════════════════\n');

  const vadfManager = await getVadfManager();

  // Test 1: Détection d'intent
  const testMessage = "Activer votre compte professionnel";
  console.log('📝 Message test:', testMessage);

  const intent = vadfManager.detectIntent(testMessage);
  console.log('🔍 Intent détecté:', intent);
  console.log('✅ Intent correct?', intent === 'activation_compte' ? 'OUI' : 'NON');
  console.log('');

  // Test 2: Récupération de la réponse
  const response = vadfManager.getResponse('activation_compte', {});
  console.log('📤 Réponse générée:');
  console.log('───────────────────────────────────────────────────────────');
  console.log(response.text);
  console.log('───────────────────────────────────────────────────────────');
  console.log('');

  // Test 3: Vérification du contenu
  const containsSubject = response.text.includes('Activation de compte');
  const containsEmail = response.text.includes('support@vadf.fr');

  console.log('✅ Contient "Activation de compte":', containsSubject ? 'OUI ✓' : 'NON ✗');
  console.log('✅ Contient "support@vadf.fr":', containsEmail ? 'OUI ✓' : 'NON ✗');
  console.log('');

  if (containsSubject && containsEmail) {
    console.log('🎉 TEST RÉUSSI ! La réponse est correcte.');
  } else {
    console.log('❌ TEST ÉCHOUÉ ! La réponse ne contient pas les éléments attendus.');
  }
}

testActivationResponse().catch(console.error);
