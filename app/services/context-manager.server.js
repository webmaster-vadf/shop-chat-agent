/**
 * ContextManager — Centralized conversation context service
 * Unifies load/merge/save/TTL operations in a single service.
 * Includes long-term memory: facts persistence + conversation summaries.
 */
import {
  getConversationContext,
  updateConversationContext,
  saveConversationContext,
  getQuotesByConversation,
  getMemoryFacts,
  saveMemoryFacts,
  getConversationSummary,
  upsertConversationSummary,
} from "../db.server";

// TTL for context entries (default: 24 hours)
const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

// Summary is regenerated every N user messages
const SUMMARY_INTERVAL = 5;

/**
 * Load full conversation context in a single call.
 * Fetches context + quotes + memory facts + summary and merges them together.
 *
 * @param {string} conversationId
 * @returns {Promise<object|null>} Enriched context with all memory layers
 */
export async function loadContext(conversationId) {
  const [context, quotes, facts, summary] = await Promise.all([
    getConversationContext(conversationId),
    getQuotesByConversation(conversationId),
    getMemoryFacts(conversationId),
    getConversationSummary(conversationId),
  ]);

  if (!context) {
    // No existing context — return a minimal object if we have any data
    if (quotes.length > 0 || facts.length > 0 || summary) {
      return {
        previousQuotes: quotes,
        memoryFacts: facts,
        conversationSummary: summary?.summary || null,
      };
    }
    return null;
  }

  // Attach all memory layers to context
  context.previousQuotes = quotes;
  context.memoryFacts = facts;
  context.conversationSummary = summary?.summary || null;

  // Parse extractedEntities from JSON string if present
  if (context.extractedEntities && typeof context.extractedEntities === "string") {
    try {
      context._parsedEntities = JSON.parse(context.extractedEntities);
    } catch {
      context._parsedEntities = {};
    }
  }

  return context;
}

/**
 * Update conversation context with partial data (merge strategy).
 *
 * @param {string} conversationId
 * @param {object} updates - Fields to update
 * @returns {Promise<object>}
 */
export async function mergeContext(conversationId, updates) {
  return updateConversationContext(conversationId, updates);
}

/**
 * Initialize or ensure a conversation context exists.
 *
 * @param {string} conversationId
 * @param {object} [defaults={}] - Default values for new context
 * @returns {Promise<object>}
 */
export async function ensureContext(conversationId, defaults = {}) {
  const existing = await getConversationContext(conversationId);
  if (existing) return existing;
  return saveConversationContext(conversationId, {
    messageCount: 0,
    ...defaults,
  });
}

/**
 * Extract and persist facts from a conversation turn.
 * Uses pattern matching to detect key information from user messages
 * and tool results (product interests, preferences, etc.).
 *
 * @param {string} conversationId
 * @param {string} userMessage - The user's message
 * @param {object|null} conversationContext - Existing context
 * @param {string} [shopId]
 * @returns {Promise<Array>} Saved facts
 */
export async function extractAndSaveFacts(conversationId, userMessage, conversationContext, shopId) {
  const facts = [];
  const msg = userMessage.toLowerCase();

  // Extract product interests
  const productPatterns = [
    { pattern: /(?:cherche|besoin|voudrais|intéress|recherche)\s+(?:des?\s+)?(.{3,40})/i, key: 'product_interest' },
    { pattern: /(?:combien|quel\s+prix|tarif)\s+(?:pour\s+|de\s+|du\s+)?(.{3,40})/i, key: 'price_inquiry' },
  ];

  for (const { pattern, key } of productPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      facts.push({
        key,
        value: match[1].trim().replace(/[?.!,;]+$/, ''),
        confidence: 0.7,
        source: 'user',
      });
    }
  }

  // Extract quantities
  const qtyMatch = userMessage.match(/(\d+)\s*(?:pièces?|unités?|lots?|cartons?|palettes?)/i);
  if (qtyMatch) {
    facts.push({
      key: 'quantity_interest',
      value: qtyMatch[0].trim(),
      confidence: 0.9,
      source: 'user',
    });
  }

  // Extract preferred contact method
  if (msg.includes('rappel') || msg.includes('téléphone') || msg.includes('appel')) {
    facts.push({ key: 'preferred_contact', value: 'téléphone', confidence: 0.8, source: 'user' });
  } else if (msg.includes('email') || msg.includes('mail') || msg.includes('courriel')) {
    facts.push({ key: 'preferred_contact', value: 'email', confidence: 0.8, source: 'user' });
  }

  // Extract urgency signals
  if (msg.includes('urgent') || msg.includes('rapidement') || msg.includes('vite') || msg.includes('pressé')) {
    facts.push({ key: 'urgency', value: 'high', confidence: 0.8, source: 'user' });
  }

  // Extract budget signals
  const budgetMatch = userMessage.match(/budget\s+(?:de\s+)?(\d[\d\s.,]*\s*(?:€|euros?)?)/i);
  if (budgetMatch) {
    facts.push({ key: 'budget', value: budgetMatch[1].trim(), confidence: 0.9, source: 'user' });
  }

  // Extract delivery preferences
  if (msg.includes('livraison') || msg.includes('délai') || msg.includes('expédition')) {
    const deliveryMatch = userMessage.match(/(?:livraison|délai|expédition)\s+(.{3,30})/i);
    if (deliveryMatch) {
      facts.push({ key: 'delivery_preference', value: deliveryMatch[1].trim().replace(/[?.!,;]+$/, ''), confidence: 0.7, source: 'user' });
    }
  }

  if (facts.length === 0) return [];

  try {
    const saved = await saveMemoryFacts(conversationId, facts, shopId);
    console.log(`[MEMORY] Extracted and saved ${saved.length} facts for conversation ${conversationId}`);
    return saved;
  } catch (error) {
    console.error('[MEMORY] Error saving facts:', error.message);
    return [];
  }
}

/**
 * Generate or update a conversation summary.
 * Called every N user interactions to keep the summary current.
 * Uses a lightweight heuristic approach (no extra LLM call).
 *
 * @param {string} conversationId
 * @param {Array} conversationHistory - Full conversation history
 * @param {number} messageCount - Current message count
 * @returns {Promise<string|null>} The summary or null if not yet due
 */
export async function updateSummaryIfNeeded(conversationId, conversationHistory, messageCount) {
  // Only generate/update summary every N messages
  if (!messageCount || messageCount % SUMMARY_INTERVAL !== 0) return null;

  // Build summary from conversation history
  const userMessages = conversationHistory
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

  const assistantMessages = conversationHistory
    .filter(m => m.role === 'assistant')
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      // Extract text blocks from content array
      if (Array.isArray(m.content)) {
        return m.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join(' ');
      }
      return '';
    });

  // Build a condensed summary
  const summaryParts = [];

  // Topics discussed (from user messages)
  const topics = userMessages.slice(-SUMMARY_INTERVAL).map(msg => {
    // Take first 60 chars as topic indicator
    const clean = msg.replace(/\n/g, ' ').trim();
    return clean.length > 60 ? clean.substring(0, 60) + '...' : clean;
  });

  if (topics.length > 0) {
    summaryParts.push(`Sujets abordés : ${topics.join(' | ')}`);
  }

  // Key actions from assistant (look for tool usage patterns)
  const actions = [];
  for (const msg of conversationHistory.slice(-SUMMARY_INTERVAL * 2)) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          actions.push(block.name);
        }
      }
    }
  }

  if (actions.length > 0) {
    const uniqueActions = [...new Set(actions)];
    summaryParts.push(`Outils utilisés : ${uniqueActions.join(', ')}`);
  }

  // Conversation length
  summaryParts.push(`Total échanges : ${conversationHistory.length} messages`);

  const summary = summaryParts.join('\n');
  const tokenCount = Math.ceil(summary.length / 4); // rough estimate

  try {
    await upsertConversationSummary(conversationId, summary, tokenCount);
    console.log(`[MEMORY] Summary updated for conversation ${conversationId} (${tokenCount} tokens)`);
    return summary;
  } catch (error) {
    console.error('[MEMORY] Error updating summary:', error.message);
    return null;
  }
}

/**
 * Enrich a system prompt with conversation context fields,
 * memory facts, and conversation summary.
 *
 * @param {string} basePrompt - The base system prompt
 * @param {object|null} context - Conversation context from loadContext()
 * @returns {string} Enriched system prompt
 */
export function enrichPromptWithContext(basePrompt, context) {
  if (!context) return basePrompt;

  const parts = [];

  if (context.customerName) parts.push(`Nom du client : ${context.customerName}`);
  if (context.companyName) parts.push(`Entreprise : ${context.companyName}`);
  if (context.customerEmail) parts.push(`Email : ${context.customerEmail}`);

  if (context.accountStatus && context.accountStatus !== "unknown") {
    parts.push(
      `Statut compte : ${context.accountStatus === "pro" ? "Professionnel vérifié" : "Non-professionnel"}`
    );
  }

  if (context.lastIntent) parts.push(`Dernière intention détectée : ${context.lastIntent}`);
  if (context.messageCount > 1) parts.push(`Messages échangés dans cette conversation : ${context.messageCount}`);

  if (context.previousQuotes && context.previousQuotes.length > 0) {
    const quotesSummary = context.previousQuotes
      .map(
        (q) =>
          `Devis #${q.id.slice(-6)} (${q.status}) - ${q.totalAmount}${q.currency || "€"} - ${new Date(q.createdAt).toLocaleDateString("fr-FR")}`
      )
      .join("; ");
    parts.push(`Devis précédents : ${quotesSummary}`);
  }

  // Inject memory facts
  if (context.memoryFacts && context.memoryFacts.length > 0) {
    const factsFormatted = context.memoryFacts
      .map((f) => `- ${f.key}: ${f.value}`)
      .join("\n");
    parts.push(`\nFaits mémorisés :\n${factsFormatted}`);
  }

  // Inject conversation summary
  if (context.conversationSummary) {
    parts.push(`\nRésumé de la conversation :\n${context.conversationSummary}`);
  }

  if (parts.length === 0) return basePrompt;

  return `${basePrompt}\n\n--- CONTEXTE CLIENT (mémoire de conversation) ---\n${parts.join("\n")}`;
}

/**
 * Check if a context entry has expired based on TTL.
 *
 * @param {object} context - Context object with updatedAt field
 * @param {number} [ttlMs=CONTEXT_TTL_MS] - TTL in milliseconds
 * @returns {boolean} true if the context has expired
 */
export function isContextExpired(context, ttlMs = CONTEXT_TTL_MS) {
  if (!context || !context.updatedAt) return true;
  const age = Date.now() - new Date(context.updatedAt).getTime();
  return age > ttlMs;
}

export default {
  loadContext,
  mergeContext,
  ensureContext,
  extractAndSaveFacts,
  updateSummaryIfNeeded,
  enrichPromptWithContext,
  isContextExpired,
};
