/**
 * Intent Classifier Service
 * Uses Claude Haiku for fast, cheap intent classification
 * Falls back to regex if Claude call fails
 */
import { Anthropic } from "@anthropic-ai/sdk";

const CLASSIFIER_MODEL = process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";
const CONFIDENCE_THRESHOLD_HIGH = 0.7;
const CONFIDENCE_THRESHOLD_MEDIUM = 0.5;

const CLASSIFICATION_PROMPT = `Tu es un classifieur d'intents pour VADF, un site B2B de vêtements éco-responsables.

Analyse le message utilisateur et retourne un JSON avec :
- "intent": l'intent détectée (voir liste ci-dessous)
- "confidence": score de confiance entre 0 et 1
- "entities": entités extraites du message

INTENTS DISPONIBLES :
COMPTE :
- "creation_compte" : création de compte pro (mots-clés: créer, inscription, ouvrir un compte, s'inscrire)
- "activation_compte" : activation de compte (mots-clés: activer, activation, accès au site, compte pas activé)
- "mot_de_passe_oublie" : réinitialisation mot de passe (mots-clés: mot de passe, oublié, reset, réinitialiser, connexion impossible)
- "mise_a_jour_infos_entreprise" : mise à jour infos entreprise (mots-clés: mettre à jour, modifier, coordonnées, changement email)

SUPPORT :
- "escalade_support" : besoin d'aide humaine (mots-clés: problème complexe, support technique, bloqué, bug, aide urgente)
- "erreur_generique" : incompréhension (mots-clés: erreur, ne comprends pas, reformuler)
- "faq" : questions générales (mots-clés: faq, aide, informations générales)

PRODUITS :
- "origine_produit" : origine/provenance (mots-clés: origine, provenance, made in, d'où viennent)
- "fabrication" : processus de fabrication (mots-clés: fabriqué, fabrication, production, ateliers)
- "materiaux" : matériaux/tissus (mots-clés: matériaux, tissus, matières, composition, bio, recyclé)
- "personnalisation" : personnalisation produits (mots-clés: personnaliser, broderie, sérigraphie, impression, marquage)
- "b2b_only" : accès B2B uniquement (mots-clés: particulier, professionnel, entreprise, qui peut commander)
- "decouvrir_produits" : découverte catalogue (mots-clés: découvrir, quels produits, catalogue, que vendez-vous)
- "commander_produits" : comment commander (mots-clés: comment commander, passer commande, acheter)
- "reliquat" : reliquat/réassort (mots-clés: reliquat, rupture, réapprovisionnement, réassort)
- "stock_indisponible" : stock indisponible (mots-clés: indisponible, non disponible, quand disponible, introuvable)
- "devis" : demande de devis (mots-clés: devis, prix sur mesure, devis personnalisé)
- "tarifs" : consultation tarifs (mots-clés: tarifs, prix, combien coûte)
- "photos_produits" : photos/visuels (mots-clés: photos, visuels, images, télécharger)
- "fiches_techniques" : fiches techniques (mots-clés: fiche technique, documentation, caractéristiques, spécifications, guide impression)

GENERAL :
- "salutation" : salutation (mots-clés: bonjour, salut, hello, hi, hey, coucou)
- "remerciement" : remerciement (mots-clés: merci, thanks, thank you)
- "au_revoir" : au revoir (mots-clés: au revoir, bye, à bientôt)

- "unknown" : si aucun intent ne correspond clairement

ENTITES A EXTRAIRE :
- "email" : adresse email si présente
- "companyName" : nom d'entreprise si mentionné
- "productName" : nom de produit si mentionné
- "orderNumber" : numéro de commande si mentionné

REGLES :
- Si le message est ambigu, retourne l'intent le plus probable avec une confiance plus basse
- Si le message contient des mots-clés de recherche produit (cherche, prix, stock, commander, panier, cart, commande), privilégie les intents produits
- Ne retourne QUE du JSON valide, sans explication

EXEMPLES :
Message: "Bonjour, j'ai oublié mon mot de passe pour mon@email.fr"
Réponse: {"intent":"mot_de_passe_oublie","confidence":0.95,"entities":{"email":"mon@email.fr"}}

Message: "Est-ce que vous vendez aux particuliers ?"
Réponse: {"intent":"b2b_only","confidence":0.9,"entities":{}}

Message: "Je cherche des t-shirts en coton bio"
Réponse: {"intent":"unknown","confidence":0.3,"entities":{"productName":"t-shirts en coton bio"}}`;

/**
 * Classify a user message into an intent using Claude Haiku
 * @param {string} message - The user message to classify
 * @param {Array} conversationHistory - Last few messages for context
 * @returns {Promise<{intent: string, confidence: number, entities: object}>}
 */
export async function classifyIntent(message, conversationHistory = []) {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.warn('[INTENT-CLASSIFIER] No API key, falling back to regex');
      return null;
    }

    const anthropic = new Anthropic({ apiKey });

    // Build context from last 3 messages
    const contextMessages = conversationHistory
      .slice(-3)
      .map(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${m.role}: ${content.substring(0, 200)}`;
      })
      .join('\n');

    const userPrompt = contextMessages
      ? `Contexte de la conversation :\n${contextMessages}\n\nMessage à classifier : "${message}"`
      : `Message à classifier : "${message}"`;

    console.log('[INTENT-CLASSIFIER] Classifying message with Claude Haiku');

    const response = await anthropic.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 200,
      system: CLASSIFICATION_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0]?.text?.trim();
    if (!responseText) {
      console.warn('[INTENT-CLASSIFIER] Empty response from classifier');
      return null;
    }

    // Parse JSON response, handling potential markdown wrapping
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const result = JSON.parse(jsonStr);

    console.log(`[INTENT-CLASSIFIER] Result: intent="${result.intent}", confidence=${result.confidence}`);
    if (result.entities && Object.keys(result.entities).length > 0) {
      console.log('[INTENT-CLASSIFIER] Entities:', JSON.stringify(result.entities));
    }

    return {
      intent: result.intent || 'unknown',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      entities: result.entities || {}
    };
  } catch (error) {
    console.error('[INTENT-CLASSIFIER] Classification failed, falling back to regex:', error.message);
    return null;
  }
}

export { CONFIDENCE_THRESHOLD_HIGH, CONFIDENCE_THRESHOLD_MEDIUM };
