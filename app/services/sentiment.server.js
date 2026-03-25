/**
 * Sentiment Analysis Service
 * Uses Claude Haiku for fast, non-blocking sentiment analysis
 */
import { Anthropic } from "@anthropic-ai/sdk";
import { upsertConversationOutcome } from "../db.server";

const CLASSIFIER_MODEL = process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";

const SENTIMENT_PROMPT = `Tu es un analyseur de sentiment pour un chat B2B.
Analyse le message utilisateur et retourne un JSON avec :
- "sentiment": "positive", "neutral" ou "negative"
- "score": un score entre -1 (très négatif) et 1 (très positif)
- "reason": une courte explication (10 mots max)

Contexte : chat d'un site B2B de vêtements professionnels (VADF).
Les clients sont des professionnels du textile.

Exemples :
- "Merci beaucoup, c'est parfait !" → {"sentiment":"positive","score":0.9,"reason":"Remerciement enthousiaste"}
- "Où puis-je trouver les prix ?" → {"sentiment":"neutral","score":0.0,"reason":"Question factuelle neutre"}
- "C'est inacceptable, ça fait 3 jours" → {"sentiment":"negative","score":-0.7,"reason":"Frustration et impatience"}
- "Bonjour" → {"sentiment":"neutral","score":0.1,"reason":"Salutation standard"}

Réponds UNIQUEMENT avec le JSON, rien d'autre.`;

/**
 * Analyze sentiment of a user message (non-blocking)
 * @param {string} message - User message to analyze
 * @param {string} conversationId - Conversation ID for outcome tracking
 * @param {string} shopId - Shop ID
 * @returns {Promise<{sentiment: string, score: number, reason: string}|null>}
 */
export async function analyzeSentiment(message, conversationId, shopId) {
  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `${SENTIMENT_PROMPT}\n\nMessage à analyser: "${message}"`
        }
      ]
    });

    const responseText = response.content?.[0]?.text;
    if (!responseText) return null;

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);

    // Validate result structure
    if (!result.sentiment || result.score === undefined) return null;

    // Normalize
    const sentiment = ['positive', 'neutral', 'negative'].includes(result.sentiment)
      ? result.sentiment
      : 'neutral';
    const score = Math.max(-1, Math.min(1, Number(result.score) || 0));

    console.log(`[SENTIMENT] ${sentiment} (${score}) for message: "${message.substring(0, 50)}..."`);

    // Update conversation outcome with sentiment (fire-and-forget)
    upsertConversationOutcome(conversationId, {
      shopId,
      sentiment,
      sentimentScore: score
    }).catch(e => console.warn('[SENTIMENT] Failed to update outcome:', e.message));

    return { sentiment, score, reason: result.reason || '' };
  } catch (error) {
    console.warn('[SENTIMENT] Analysis failed:', error.message);
    return null;
  }
}

/**
 * Analyze sentiment non-blocking (fire-and-forget)
 * @param {string} message - User message
 * @param {string} conversationId - Conversation ID
 * @param {string} shopId - Shop ID
 */
export function analyzeSentimentAsync(message, conversationId, shopId) {
  // Fire and forget - don't await
  analyzeSentiment(message, conversationId, shopId).catch(() => {});
}
