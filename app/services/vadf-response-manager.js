
import fs from 'fs/promises';
import path from 'path';

const RESPONSES_PATH = path.resolve(process.cwd(), 'app/prompts/vadf_reponses.json');

class VADFResponseManager {
  constructor() {
    this.responses = null;
    this.loaded = false;
  }

  async load() {
    if (!this.loaded) {
      const data = await fs.readFile(RESPONSES_PATH, 'utf-8');
      this.responses = JSON.parse(data);
      this.loaded = true;
    }
  }

  // Détection automatique d'intention (simple matching, à améliorer par NLP si besoin)
  detectIntent(message) {
    const msg = message.toLowerCase();
    const intents = Object.keys(this.responses.intents);

    // Mapping simple mots-clés -> intention
    // Intents spécifiques VADF (gestion de compte, support)
    const specificMapping = {
      activation_compte: ["activer", "activation", "compte", "inscription"],
      mot_de_passe_oublie: ["mot de passe", "oublié", "reset", "réinitialiser"],
      mise_a_jour_infos_entreprise: ["mettre à jour", "modifier", "email", "coordonnées", "changement"],
      escalade_support: ["problème complexe", "support technique", "bloqué", "bug"],
      origine_produit: ["origine", "fabriqué", "provenance", "made in"],
      personnalisation: ["personnaliser", "personnalisation", "broderie", "sérigraphie", "impression"],
      b2b_only: ["b2b", "particulier", "professionnel", "entreprise"]
    };

    // Intents génériques (à renvoyer vers MCP si détectés)
    const genericMapping = {
      salutation: ["bonjour", "salut", "hello", "hi", "hey"],
      remerciement: ["merci", "thanks", "thank you"],
      au_revoir: ["au revoir", "bye", "à bientôt", "goodbye"]
    };

    // Mots-clés produit (doivent basculer vers MCP pour recherche produits)
    const productKeywords = ["produit", "article", "cherche", "recherche", "prix", "stock", "disponible", "acheter", "commander", "panier", "cart", "commande"];

    // Chercher d'abord les mots-clés produit = fallback MCP
    if (productKeywords.some(k => msg.includes(k))) {
      console.log('[VADF] Product-related query detected, fallback to MCP');
      return "unknown"; // Force fallback vers MCP Storefront
    }

    // Chercher ensuite les intents spécifiques VADF
    for (const [intent, keywords] of Object.entries(specificMapping)) {
      if (keywords.some(k => msg.includes(k))) {
        return intent;
      }
    }

    // Si intent générique détecté, retourner le nom de l'intent (géré dans chat.jsx)
    for (const [intent, keywords] of Object.entries(genericMapping)) {
      if (keywords.some(k => msg.includes(k))) {
        return intent; // Retourne 'salutation', 'remerciement', 'au_revoir'
      }
    }

    // Aucun intent détecté = fallback vers MCP
    return "unknown";
  }

  // Sélection intelligente de la meilleure réponse selon le contexte
  getResponse(intent, context = {}) {
    console.log('[VADF] getResponse called with intent:', intent, 'context:', context);

    if (!this.responses || !this.responses.intents[intent]) {
      console.log('[VADF] Intent not found or responses not loaded');
      return { text: this.responses?.common_phrases?.error || "Erreur interne.", type: "error" };
    }

    const intentObj = this.responses.intents[intent];
    console.log('[VADF] Intent object:', intentObj);

    // Chercher la première réponse dont toutes les conditions sont remplies
    for (const resp of intentObj.responses) {
      console.log('[VADF] Checking response:', resp);

      if (!resp.conditions || resp.conditions.length === 0) {
        console.log('[VADF] No conditions, returning response');
        return { text: this.replaceVars(resp.text, context), type: intent };
      }
      let ok = true;
      for (const cond of resp.conditions) {
        // Ex: "compte_actif == true"
        const [varName, op, val] = cond.split(/\s*==\s*/);
        console.log('[VADF] Checking condition:', cond, 'varName:', varName, 'context value:', context[varName], 'expected:', val);
        if (context[varName] == null || String(context[varName]) !== val) {
          ok = false;
          break;
        }
      }
      if (ok) {
        console.log('[VADF] All conditions met, returning response');
        return { text: this.replaceVars(resp.text, context), type: intent };
      }
    }
    // Si aucune condition ne matche, réponse d'erreur générique
    console.log('[VADF] No matching condition found, returning error');
    return { text: this.responses.common_phrases.error, type: "error" };
  }

  // Remplacement dynamique des variables dans la réponse
  replaceVars(text, context) {
    return text.replace(/\{\{(\w+)\}\}/g, (m, v) => context[v] ?? "…");
  }

  // Enrichir le contexte (exemple : premier message, statut, etc.)
  enrichContext(ctx = {}) {
    // Peut être enrichi dynamiquement selon l'utilisateur
    return {
      ...this.responses.context,
      ...ctx
    };
  }

  // Gestion des erreurs et phrases communes
  getCommonPhrase(key) {
    return this.responses.common_phrases[key] || "";
  }
}

// Export instance unique
let vadfManagerInstance = null;
export async function getVadfManager() {
  if (!vadfManagerInstance) {
    vadfManagerInstance = new VADFResponseManager();
    await vadfManagerInstance.load();
  }
  return vadfManagerInstance;
}

// Pour compatibilité :
export async function getVadfResponses() {
  const mgr = await getVadfManager();
  return mgr.responses;
}
