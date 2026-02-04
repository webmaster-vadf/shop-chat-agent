/**
 * AgentOrchestrator - Automatic routing to specialized agents
 * Routes messages to SalesAgent, SupportAgent, or OrderAgent
 * using a 4-step strategy with zero additional LLM calls
 */
import { SalesAgent } from "./sales-agent.server.js";
import { SupportAgent } from "./support-agent.server.js";
import { OrderAgent } from "./order-agent.server.js";

// Step 1: Intent-based mapping (highest priority)
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

// Step 2: Keyword-based routing (fallback)
const KEYWORD_ROUTING = [
  {
    agent: 'order',
    keywords: [
      'panier', 'cart', 'ajouter au panier', 'retirer du panier',
      'commande', 'ma commande', 'suivi', 'colis', 'tracking',
      'livraison', 'expédition', 'numéro de suivi', 'où est ma',
      'statut commande', 'annuler commande', 'modifier commande'
    ]
  },
  {
    agent: 'sales',
    keywords: [
      'produit', 'cherche', 'prix', 'catalogue', 'stock',
      'taille', 'couleur', 'modèle', 'collection', 'gamme',
      'devis', 'acheter', 'disponible', 'combien'
    ]
  },
  {
    agent: 'support',
    keywords: [
      'compte', 'mot de passe', 'support', 'aide',
      'contact', 'connecter', 'inscription', 'activer'
    ]
  }
];

export class AgentOrchestrator {
  /**
   * Route a message to the appropriate specialized agent
   * @param {string} message - User message
   * @param {string} intent - Detected intent (from VADF classifier)
   * @param {Object|null} conversationContext - Conversation memory context
   * @returns {{ agent: BaseAgent, routingReason: string, routingConfidence: number, routingMethod: string }}
   */
  route(message, intent, conversationContext) {
    // Step 1: Intent-based mapping (highest confidence)
    if (intent && INTENT_TO_AGENT[intent]) {
      const agentType = INTENT_TO_AGENT[intent];
      console.log(`[ORCHESTRATOR] Route by intent: "${intent}" → ${agentType} (confidence: 1.0)`);
      return {
        agent: this._createAgent(agentType),
        routingReason: `intent:${intent}`,
        routingConfidence: 1.0,
        routingMethod: 'intent'
      };
    }

    // Step 2: Keyword-based matching
    const msg = message.toLowerCase();
    for (const rule of KEYWORD_ROUTING) {
      const matchedKeyword = rule.keywords.find(k => msg.includes(k));
      if (matchedKeyword) {
        // Longer keyword matches are more specific → higher confidence
        const keywordConfidence = matchedKeyword.length > 8 ? 0.8 : 0.65;
        console.log(`[ORCHESTRATOR] Route by keyword: "${matchedKeyword}" → ${rule.agent} (confidence: ${keywordConfidence})`);
        return {
          agent: this._createAgent(rule.agent),
          routingReason: `keyword:${matchedKeyword}`,
          routingConfidence: keywordConfidence,
          routingMethod: 'keyword'
        };
      }
    }

    // Step 3: Context-based continuation
    if (conversationContext?.lastAgentType) {
      const agentType = conversationContext.lastAgentType;
      console.log(`[ORCHESTRATOR] Route by context continuation → ${agentType} (confidence: 0.5)`);
      return {
        agent: this._createAgent(agentType),
        routingReason: `context:${agentType}`,
        routingConfidence: 0.5,
        routingMethod: 'context'
      };
    }

    // Step 4: Default to SalesAgent
    console.log('[ORCHESTRATOR] Route by default → sales (confidence: 0.3)');
    return {
      agent: this._createAgent('sales'),
      routingReason: 'default',
      routingConfidence: 0.3,
      routingMethod: 'default'
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
