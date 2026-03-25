import { getVadfManager } from "../app/services/vadf-response-manager";

async function testVadf() {
  const vadf = await getVadfManager();

  // Test 1 : Activation compte actif
  let ctx = { compte_actif: true };
  let r = vadf.getResponse("activation_compte", ctx);
  console.assert(r.text.includes("activé"), "Activation compte actif échoue");

  // Test 2 : Mot de passe oublié (reset envoyé)
  ctx = { reset_envoye: true };
  r = vadf.getResponse("mot_de_passe_oublie", ctx);
  console.assert(r.text.includes("réinitialiser"), "Mot de passe oublié échoue");

  // Test 3 : Escalade support
  ctx = { escalade: true };
  r = vadf.getResponse("escalade_support", ctx);
  console.assert(r.text.includes("contact@vadf.fr"), "Escalade support échoue");

  // Test 4 : Détection d'intention automatique
  let intent = vadf.detectIntent("Je veux activer mon compte");
  console.assert(intent === "activation_compte", "Détection intention activation échoue");

  intent = vadf.detectIntent("Je suis bloqué, besoin d'aide");
  console.assert(intent === "escalade_support", "Détection intention escalade échoue");

  // Test 5 : Remplacement variable
  ctx = { email_renvoye: true, email: "test@vadf.fr" };
  r = vadf.getResponse("activation_compte", ctx);
  console.assert(r.text.includes("test@vadf.fr"), "Remplacement variable email échoue");

  // Test 6 : Erreur générique
  intent = vadf.detectIntent("blablabla");
  r = vadf.getResponse(intent, {});
  console.assert(r.type === "error", "Gestion erreur générique échoue");

  console.log("✅ Tous les tests VADFResponseManager sont passés.");
}

testVadf();
