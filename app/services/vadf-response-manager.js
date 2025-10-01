
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
    const mapping = {
      activation_compte: ["activer", "activation", "compte", "inscription"],
      mot_de_passe_oublie: ["mot de passe", "oublié", "reset", "réinitialiser"],
      mise_a_jour_infos_entreprise: ["mettre à jour", "modifier", "email", "coordonnées", "changement"],
      escalade_support: ["problème", "erreur", "support", "contact", "bloqué", "aide"],
      origine_produit: ["origine", "fabriqué", "france", "bio", "recyclé"],
      personnalisation: ["personnaliser", "broderie", "sérigraphie", "impression"],
      b2b_only: ["particulier", "b2c", "prix public", "tarif public"],
      salutation: ["bonjour", "salut", "hello"],
      remerciement: ["merci", "thanks", "remeciement"],
      au_revoir: ["au revoir", "bye", "à bientôt"]
    };
    for (const [intent, keywords] of Object.entries(mapping)) {
      if (keywords.some(k => msg.includes(k))) {
        return intent;
      }
    }
    return "erreur_generique";
  }

  // Sélection intelligente de la meilleure réponse selon le contexte
  getResponse(intent, context = {}) {
    if (!this.responses || !this.responses.intents[intent]) {
      return { text: this.responses?.common_phrases?.error || "Erreur interne.", type: "error" };
    }
    const intentObj = this.responses.intents[intent];
    // Chercher la première réponse dont toutes les conditions sont remplies
    for (const resp of intentObj.responses) {
      if (!resp.conditions || resp.conditions.length === 0) {
        return { text: this.replaceVars(resp.text, context), type: intent };
      }
      let ok = true;
      for (const cond of resp.conditions) {
        // Ex: "compte_actif == true"
        const [varName, op, val] = cond.split(/\s*==\s*/);
        if (context[varName] == null || String(context[varName]) !== val) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return { text: this.replaceVars(resp.text, context), type: intent };
      }
    }
    // Si aucune condition ne matche, réponse d'erreur générique
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
