// Import direct du JSON au lieu de fs.readFile
import vadfReponsesJson from '../prompts/vadf_reponses.json';

console.log('[VADF INIT] VADF responses imported successfully');

class VADFResponseManager {
  constructor() {
    this.responses = null;
    this.loaded = false;
  }

  async load() {
    if (!this.loaded) {
      console.log('[VADF LOAD] Loading responses from imported JSON');
      try {
        // Utiliser le JSON importé directement
        this.responses = vadfReponsesJson;
        this.loaded = true;
        console.log('[VADF LOAD] Successfully loaded responses');
        console.log('[VADF LOAD] Available intents:', Object.keys(this.responses.intents));
        console.log('[VADF LOAD] Salutation intent exists:', !!this.responses.intents.salutation);
      } catch (error) {
        console.error('[VADF LOAD] ERROR loading responses:', error);
        throw error;
      }
    } else {
      console.log('[VADF LOAD] Responses already loaded, skipping');
    }
  }

  // Détection automatique d'intention (simple matching, à améliorer par NLP si besoin)
  detectIntent(message) {
    const msg = message.toLowerCase();
    const intents = Object.keys(this.responses.intents);

    console.log('════════════════════════════════════════════════════════');
    console.log('🔍 [VADF INTENT] Starting intent detection');
    console.log('📝 [VADF INTENT] Original message:', message);
    console.log('📝 [VADF INTENT] Lowercase message:', msg);
    console.log('════════════════════════════════════════════════════════');

    // Mapping simple mots-clés -> intention
    // Intents spécifiques VADF (gestion de compte, support, produits)
    const specificMapping = {
      // Compte (4 intents)
      creation_compte: ["créer un compte", "créer compte", "ouvrir un compte", "inscription", "s'inscrire", "nouveau compte"],
      activation_compte: ["activer", "activation", "compte pas activé", "accès au site", "activer votre compte", "activer mon compte"],
      mot_de_passe_oublie: ["mot de passe", "oublié", "reset", "réinitialiser"],
      mise_a_jour_infos_entreprise: ["mettre à jour", "modifier", "email", "coordonnées", "changement"],

      // Support (3 intents)
      escalade_support: ["problème complexe", "support technique", "bloqué", "bug"],
      erreur_generique: ["erreur", "ne comprends pas", "reformuler", "incompréhensible"],
      faq: ["faq", "aide", "question", "informations"],

      // Produits (12 intents)
      origine_produit: ["origine", "provenance", "made in", "d'où viennent"],
      fabrication: ["fabriqué", "fabrication", "production locale", "vêtements écologiques", "fabrication responsable"],
      materiaux: ["matériaux", "tissus", "matières", "composition", "tissus locaux", "matériaux écologiques"],
      personnalisation: ["personnaliser", "personnalisation", "broderie", "sérigraphie", "impression", "marquage", "customisation"],
      b2b_only: ["b2b", "particulier", "professionnel", "entreprise", "qui peut commander", "pas une entreprise"],
      decouvrir_produits: ["découvrir", "quels produits", "voir catalogue", "produits disponibles", "que vendez"],
      commander_produits: ["comment commander", "passer commande", "faire un achat", "acheter"],
      reliquat: ["reliquat", "réapprovisionnement", "rupture de stock", "demander reliquat", "réassort"],
      stock_indisponible: ["indisponible", "non disponible", "quand disponible", "trouve pas articles", "article introuvable"],
      devis: ["devis", "prix mesure", "devis personnalisé", "obtenir devis", "demander devis"],
      tarifs: ["voir tarifs", "voir prix", "tarifs produits", "prix articles", "combien coûte"],
      photos_produits: ["photos produits", "photo produit", "visuels produits", "images produits", "où trouver les photos", "télécharger visuels", "visuels et photos optimisés"],
      fiches_techniques: ["fiche technique", "documentation", "caractéristiques", "spécifications", "guide impression"]
    };

    // Intents génériques (à renvoyer vers MCP si détectés)
    const genericMapping = {
      salutation: ["bonjour", "salut", "hello", "hi", "hey"],
      remerciement: ["merci", "thanks", "thank you"],
      au_revoir: ["au revoir", "bye", "à bientôt", "goodbye"]
    };

    // Chercher d'abord les intents spécifiques VADF (priorité haute)
    console.log('🔎 [VADF INTENT] Step 1: Checking specific VADF intents');
    for (const [intent, keywords] of Object.entries(specificMapping)) {
      const foundKeyword = keywords.find(k => msg.includes(k));
      if (foundKeyword) {
        console.log(`✅ [VADF INTENT] Specific intent matched!`);
        console.log(`   - Intent: "${intent}"`);
        console.log(`   - Keyword: "${foundKeyword}"`);
        console.log('════════════════════════════════════════════════════════');
        return intent;
      }
    }
    console.log('⚪ [VADF INTENT] No specific VADF intents found');

    // Si intent générique détecté, retourner le nom de l'intent (géré dans chat.jsx)
    console.log('🔎 [VADF INTENT] Step 3: Checking generic intents');
    for (const [intent, keywords] of Object.entries(genericMapping)) {
      const foundKeyword = keywords.find(k => msg.includes(k));
      if (foundKeyword) {
        console.log(`✅ [VADF INTENT] Generic intent matched!`);
        console.log(`   - Intent: "${intent}"`);
        console.log(`   - Keyword: "${foundKeyword}"`);
        console.log('════════════════════════════════════════════════════════');
        return intent; // Retourne 'salutation', 'remerciement', 'au_revoir'
      }
    }
    console.log('⚪ [VADF INTENT] No generic intents found');

    // Aucun intent détecté = fallback vers MCP
    console.log('⚠️ [VADF INTENT] No intent detected anywhere');
    console.log('🔄 [VADF INTENT] Returning "unknown" for MCP fallback');
    console.log('════════════════════════════════════════════════════════');
    return "unknown";
  }

  // Sélection intelligente de la meilleure réponse selon le contexte
  getResponse(intent, context = {}) {
    console.log('[VADF] getResponse called with intent:', intent, 'context:', context);
    console.log('[VADF] this.responses loaded:', !!this.responses);
    console.log('[VADF] this.responses.intents exists:', !!this.responses?.intents);
    console.log('[VADF] Available intents:', this.responses?.intents ? Object.keys(this.responses.intents) : 'NONE');
    console.log('[VADF] Intent "' + intent + '" exists:', !!this.responses?.intents?.[intent]);

    if (!this.responses || !this.responses.intents[intent]) {
      console.log('[VADF] Intent not found or responses not loaded');
      console.log('[VADF] Returning error. this.responses:', !!this.responses, 'intent exists:', !!this.responses?.intents?.[intent]);
      return { text: this.responses?.common_phrases?.error || "Erreur interne.", type: "error" };
    }

    const intentObj = this.responses.intents[intent];
    console.log('[VADF] Intent object:', intentObj);

    // Chercher la première réponse dont toutes les conditions sont remplies
    for (const resp of intentObj.responses) {
      console.log('[VADF] Checking response:', resp);

      if (!resp.conditions || resp.conditions.length === 0) {
        console.log('[VADF] No conditions, returning response');
        const finalText = this.replaceVars(resp.text, context);
        if (intent === 'activation_compte') {
          console.log('🎯 [VADF ACTIVATION_COMPTE] Response text being returned:', finalText);
        }
        return { text: finalText, type: intent };
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
