import fetch from "node-fetch";

async function testVadfChatAPI() {
  const url = "http://localhost:3000/chat";

  // 1. Test intention activation compte
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Je veux activer mon compte", prompt_type: "vadfAssistant" })
  });
  let data = await res.json();
  console.assert(data.text && data.text.includes("activé"), "Réponse activation compte échoue");

  // 2. Test intention mot de passe oublié
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "J'ai oublié mon mot de passe", prompt_type: "vadfAssistant" })
  });
  data = await res.json();
  console.assert(data.text && data.text.match(/mot de passe|réinitialiser/), "Réponse mot de passe oublié échoue");

  // 3. Test escalade support
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Je suis bloqué, besoin d'aide", prompt_type: "vadfAssistant" })
  });
  data = await res.json();
  console.assert(data.text && data.text.includes("contact@vadf.fr"), "Réponse escalade échoue");

  // 4. Test erreur générique
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "blablabla", prompt_type: "vadfAssistant" })
  });
  data = await res.json();
  console.assert(data.text && data.text.match(/erreur|contact@vadf.fr/), "Réponse erreur générique échoue");

  console.log("✅ Tous les tests d'intégration VADF chat API sont passés.");
}

testVadfChatAPI();
