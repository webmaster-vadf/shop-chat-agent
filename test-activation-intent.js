#!/usr/bin/env node

/**
 * Script de test pour vérifier le flux d'activation de compte
 * Usage: node test-activation-intent.js
 */

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Test du flux d\'intention "activation_compte"             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Message sans email
console.log('🧪 TEST 1: Message "Activer votre compte professionnel" (sans email)');
console.log('─────────────────────────────────────────────────────────────');

const message1 = 'Activer votre compte professionnel';
const emailRegex = /[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/;
const emailMatch1 = message1.match(emailRegex);
const email1 = emailMatch1 ? emailMatch1[0] : undefined;

console.log('📝 Message:', message1);
console.log('📧 Email extrait:', email1 || 'aucun');
console.log('✅ Résultat attendu: Pas de vérification de compte');
console.log('✅ Réponse attendue: Message VADF par défaut (support@vadf.fr)\n');

// Test 2: Message avec email
console.log('🧪 TEST 2: Message avec email');
console.log('─────────────────────────────────────────────────────────────');

const message2 = 'Je veux activer mon compte avec jean.dupont@example.com';
const emailMatch2 = message2.match(emailRegex);
const email2 = emailMatch2 ? emailMatch2[0] : undefined;

console.log('📝 Message:', message2);
console.log('📧 Email extrait:', email2 || 'aucun');
console.log('✅ Résultat attendu: Vérification de compte effectuée');
console.log('✅ Réponse attendue: Message selon statut du compte\n');

// Test 3: Détection d'intention
console.log('🧪 TEST 3: Détection d\'intention');
console.log('─────────────────────────────────────────────────────────────');

const activationKeywords = ['activer', 'activation', 'compte pas activé', 'accès au site', 'activer votre compte', 'activer mon compte'];
const testMessages = [
  'Activer votre compte professionnel',
  'activer mon compte',
  'Je souhaite activer mon compte entreprise',
  'activation du compte',
  'Mon compte n\'est pas activé'
];

testMessages.forEach(msg => {
  const msgLower = msg.toLowerCase();
  const matchedKeyword = activationKeywords.find(kw => msgLower.includes(kw));
  console.log(`  ➜ "${msg}"`);
  console.log(`    Keyword trouvé: ${matchedKeyword || 'aucun'} → Intent: ${matchedKeyword ? 'activation_compte' : 'unknown'}`);
});

console.log('\n');

// Test 4: Sélection de réponse
console.log('🧪 TEST 4: Sélection de réponse VADF');
console.log('─────────────────────────────────────────────────────────────');

const responses = [
  {
    text: 'Merci d\'écrire à support@vadf.fr en indiquant le nom de votre entreprise...',
    conditions: [],
    id: 'R1'
  },
  {
    text: 'Votre compte entreprise est associé à l\'adresse e-mail {{email}}...',
    conditions: ['email_renvoye == true'],
    id: 'R2'
  },
  {
    text: 'Vous allez recevoir un e-mail d\'activation à l\'adresse {{email}}...',
    conditions: ['nouveau_compte == true'],
    id: 'R3'
  },
  {
    text: 'Un e-mail d\'invitation au nouveau site VADF vous sera envoyé...',
    conditions: [],
    id: 'R4'
  },
  {
    text: 'Une fois votre compte activé, vous pourrez vous connecter normalement...',
    conditions: [],
    id: 'R5'
  }
];

// Contexte vide
const context1 = {};
console.log('Contexte:', JSON.stringify(context1));

for (const resp of responses) {
  const hasConditions = resp.conditions.length > 0;
  const conditionsMet = !hasConditions || resp.conditions.every(cond => {
    const [varName, op, val] = cond.split(/\s*==\s*/);
    return context1[varName] != null && String(context1[varName]) === val;
  });

  if (!hasConditions || conditionsMet) {
    console.log(`✅ Réponse sélectionnée: ${resp.id} (${hasConditions ? 'conditions remplies' : 'aucune condition'})`);
    console.log(`   Texte: ${resp.text.substring(0, 60)}...`);
    break;
  }
}

console.log('\n');

// Test 5: Override avec accountCheckResult
console.log('🧪 TEST 5: Override avec accountCheckResult.message');
console.log('─────────────────────────────────────────────────────────────');

const vadfResponseText = 'Merci d\'écrire à support@vadf.fr...';
const accountCheckResults = [
  null,
  { status: 'not_found', message: 'Compte introuvable. Redirection vers la page d\'inscription.' },
  { status: 'active', message: 'Compte actif. Vous pouvez demander une réinitialisation du mot de passe si besoin.' }
];

accountCheckResults.forEach((result, idx) => {
  console.log(`\n  Cas ${idx + 1}:`);
  console.log(`    accountCheckResult:`, result ? `{ status: '${result.status}', message: '${result.message.substring(0, 40)}...' }` : 'null');

  let finalText = vadfResponseText;
  if (result && result.message) {
    console.log(`    ⚠️ OVERRIDE: Utilisation du message du compte`);
    finalText = result.message;
  } else {
    console.log(`    ✅ NO OVERRIDE: Utilisation de la réponse VADF`);
  }

  console.log(`    Texte final: ${finalText.substring(0, 60)}...`);
});

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Tests terminés                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝');
