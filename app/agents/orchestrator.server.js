/**
 * AgentOrchestrator - Hybrid routing with composite scoring
 * Routes messages to SalesAgent, SupportAgent, or OrderAgent
 * by evaluating all signals (intent, keywords, context) simultaneously
 * and computing a composite score per agent. Zero additional LLM calls.
 */
import { SalesAgent } from "./sales-agent.server.js";
import { SupportAgent } from "./support-agent.server.js";
import { OrderAgent } from "./order-agent.server.js";

// --- Signal weights ---
const WEIGHTS = {
  intent: 0.55,
  keyword: 0.30,
  context: 0.15,
};

// Ambiguity threshold: if gap between top 2 agents is below this,
// the result is considered ambiguous and context/default fallback applies
const AMBIGUITY_THRESHOLD = 0.10;

// Intent-based mapping
const INTENT_TO_AGENT = {
  // → SalesAgent (13 intents)
  decouvrir_produits: 'sales',
  commander_produits: 'sales',
  stock_indisponible: 'sales',
  reliquat: 'sales',
  devis: 'sales',
  tarifs: 'sales',
  photos_produits: 'sales',
  fiches_techniques: 'sales',
  origine_produit: 'sales',
  fabrication: 'sales',
  materiaux: 'sales',
  personnalisation: 'sales',
  b2b_only: 'sales',
  // → SupportAgent (7 intents)
  creation_compte: 'support',
  activation_compte: 'support',
  mot_de_passe_oublie: 'support',
  mise_a_jour_infos_entreprise: 'support',
  escalade_support: 'support',
  erreur_generique: 'support',
  faq: 'support'
};

// Keyword sets per agent with specificity weights
const KEYWORD_SETS = {
  order: [
    { kw: 'ajouter au panier', weight: 1.0 },
    { kw: 'retirer du panier', weight: 1.0 },
    { kw: 'statut commande', weight: 1.0 },
    { kw: 'annuler commande', weight: 1.0 },
    { kw: 'modifier commande', weight: 1.0 },
    { kw: 'numéro de suivi', weight: 0.9 },
    { kw: 'où est ma', weight: 0.9 },
    { kw: 'ma commande', weight: 0.9 },
    { kw: 'panier', weight: 0.7 },
    { kw: 'cart', weight: 0.7 },
    { kw: 'commande', weight: 0.6 },
    { kw: 'suivi', weight: 0.6 },
    { kw: 'colis', weight: 0.7 },
    { kw: 'tracking', weight: 0.7 },
    { kw: 'livraison', weight: 0.6 },
    { kw: 'expédition', weight: 0.6 },
  ],
  sales: [
    { kw: 'fiche technique', weight: 1.0 },
    { kw: 'catalogue', weight: 0.9 },
    { kw: 'collection', weight: 0.8 },
    { kw: 'disponible', weight: 0.7 },
    { kw: 'produit', weight: 0.6 },
    { kw: 'cherche', weight: 0.6 },
    { kw: 'prix', weight: 0.7 },
    { kw: 'stock', weight: 0.7 },
    { kw: 'taille', weight: 0.5 },
    { kw: 'couleur', weight: 0.5 },
    { kw: 'modèle', weight: 0.6 },
    { kw: 'gamme', weight: 0.7 },
    { kw: 'devis', weight: 0.8 },
    { kw: 'acheter', weight: 0.7 },
    { kw: 'combien', weight: 0.6 },
  ],
  support: [
    { kw: 'mot de passe', weight: 1.0 },
    { kw: 'inscription', weight: 0.9 },
    { kw: 'compte', weight: 0.7 },
    { kw: 'support', weight: 0.8 },
    { kw: 'aide', weight: 0.5 },
    { kw: 'contact', weight: 0.6 },
    { kw: 'connecter', weight: 0.8 },
    { kw: 'activer', weight: 0.7 },
  ],
};

const AGENT_TYPES = ['sales', 'support', 'order'];

export class AgentOrchestrator {
  /**
   * Route a message using hybrid composite scoring.
   * Evaluates intent, keywords, and context signals for ALL agents
   * then picks the highest composite score.
   *
   * @param {string} message - User message
   * @param {string} intent - Detected intent (from VADF classifier)
   * @param {Object|null} conversationContext - Conversation memory context
   * @param {number} [intentConfidence] - Confidence from the VADF classifier (0-1)
   * @returns {{ agent, routingReason, routingConfidence, routingMethod, scoreBreakdown }}
   */
  route(message, intent, conversationContext, intentConfidence) {
    const msg = message.toLowerCase();
    const scores = {};
    const breakdowns = {};

    for (const agentType of AGENT_TYPES) {
      const breakdown = {
        intentScore: 0,
        keywordScore: 0,
        keywordMatches: [],
        contextScore: 0,
      };

      // --- Intent signal ---
      if (intent && INTENT_TO_AGENT[intent] === agentType) {
        breakdown.intentScore = intentConfidence != null ? intentConfidence : 1.0;
      }

      // --- Keyword signal ---
      const kwSet = KEYWORD_SETS[agentType] || [];
      for (const { kw, weight } of kwSet) {
        if (msg.includes(kw)) {
          breakdown.keywordMatches.push(kw);
          // Take the max keyword weight (best match) plus a small bonus per extra match
          if (weight > breakdown.keywordScore) {
            breakdown.keywordScore = weight;
          } else {
            breakdown.keywordScore = Math.min(1.0, breakdown.keywordScore + 0.05);
          }
        }
      }

      // --- Context signal ---
      if (conversationContext?.lastAgentType === agentType) {
        breakdown.contextScore = 1.0;
      }

      // --- Composite score ---
      const composite =
        WEIGHTS.intent * breakdown.intentScore +
        WEIGHTS.keyword * breakdown.keywordScore +
        WEIGHTS.context * breakdown.contextScore;

      scores[agentType] = Math.round(composite * 1000) / 1000;
      breakdowns[agentType] = breakdown;
    }

    // Sort agents by score descending
    const ranked = AGENT_TYPES
      .map(a => ({ type: a, score: scores[a] }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const runnerUp = ranked[1];
    const gap = best.score - runnerUp.score;
    const isAmbiguous = best.score > 0 && gap < AMBIGUITY_THRESHOLD;

    // Determine winning agent and method
    let winner = best.type;
    let method = 'composite';
    let reason;

    if (best.score === 0) {
      // No signal at all → default
      winner = 'sales';
      method = 'default';
      reason = 'default';
    } else if (isAmbiguous) {
      // Ambiguous: prefer context continuation, then default to best
      if (conversationContext?.lastAgentType &&
          (conversationContext.lastAgentType === best.type || conversationContext.lastAgentType === runnerUp.type)) {
        winner = conversationContext.lastAgentType;
        method = 'composite+context_tiebreak';
        reason = `ambiguous(gap=${gap.toFixed(3)}),tiebreak:context:${winner}`;
      } else {
        reason = `ambiguous(gap=${gap.toFixed(3)}),best:${winner}`;
        method = 'composite+ambiguous';
      }
    } else {
      // Clear winner
      const bd = breakdowns[winner];
      if (bd.intentScore > 0 && bd.intentScore >= bd.keywordScore) {
        reason = `intent:${intent}`;
      } else if (bd.keywordMatches.length > 0) {
        reason = `keywords:${bd.keywordMatches.join(',')}`;
      } else if (bd.contextScore > 0) {
        reason = `context:${winner}`;
      } else {
        reason = `composite:${winner}`;
      }
    }

    const finalConfidence = best.score === 0 ? 0.3 : Math.min(1.0, best.score / 0.55);

    console.log(`[ORCHESTRATOR] Scores: sales=${scores.sales} support=${scores.support} order=${scores.order}`);
    console.log(`[ORCHESTRATOR] Winner: ${winner} (method: ${method}, confidence: ${finalConfidence.toFixed(2)}, reason: ${reason})`);
    if (isAmbiguous) {
      console.log(`[ORCHESTRATOR] ⚠ Ambiguous routing: gap=${gap.toFixed(3)} between ${best.type}(${best.score}) and ${runnerUp.type}(${runnerUp.score})`);
    }

    return {
      agent: this._createAgent(winner),
      routingReason: reason,
      routingConfidence: Math.round(finalConfidence * 100) / 100,
      routingMethod: method,
      scoreBreakdown: {
        scores,
        winner,
        runnerUp: runnerUp.type,
        gap: Math.round(gap * 1000) / 1000,
        isAmbiguous,
        details: breakdowns,
      },
    };
  }

  /**
   * Create an agent instance by type
   * @param {string} type - Agent type ("sales", "support", "order")
   * @returns {BaseAgent}
   */
  _createAgent(type) {
    switch (type) {
      case 'sales': return new SalesAgent();
      case 'support': return new SupportAgent();
      case 'order': return new OrderAgent();
      default: return new SalesAgent();
    }
  }
}
