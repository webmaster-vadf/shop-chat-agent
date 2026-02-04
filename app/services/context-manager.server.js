/**
 * ContextManager — Centralized conversation context service
 * Unifies load/merge/save/TTL operations in a single service.
 *
 * Replaces scattered calls to getConversationContext, updateConversationContext,
 * getQuotesByConversation across chat.jsx and claude.server.js.
 */
import {
  getConversationContext,
  updateConversationContext,
  saveConversationContext,
  getQuotesByConversation,
} from "../db.server";

// TTL for context entries (default: 24 hours)
const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Load full conversation context in a single call.
 * Fetches context + quotes and merges them together.
 *
 * @param {string} conversationId
 * @returns {Promise<object|null>} Enriched context with previousQuotes attached
 */
export async function loadContext(conversationId) {
  const [context, quotes] = await Promise.all([
    getConversationContext(conversationId),
    getQuotesByConversation(conversationId),
  ]);

  if (!context) {
    // No existing context — return a minimal object with quotes if any
    if (quotes.length > 0) {
      return { previousQuotes: quotes };
    }
    return null;
  }

  // Attach quotes to context
  context.previousQuotes = quotes;

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
 * Delegates to the existing updateConversationContext which handles
 * entity merging and messageCount increment.
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
 * Creates one with defaults if it does not exist yet.
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
 * Enrich a system prompt with conversation context fields.
 * Extracted from claude.server.js to centralize context formatting.
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
  enrichPromptWithContext,
  isContextExpired,
};
