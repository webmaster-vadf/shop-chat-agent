/**
 * Rate Limiter Service
 * In-memory sliding window rate limiter per shop and per conversation
 */

const SHOP_LIMIT = parseInt(process.env.RATE_LIMIT_PER_SHOP || '100', 10);     // requests per minute per shop
const CONVERSATION_LIMIT = parseInt(process.env.RATE_LIMIT_PER_CONVERSATION || '10', 10); // requests per minute per conversation
const WINDOW_MS = 60 * 1000; // 1 minute window

// In-memory stores
const shopRequests = new Map();     // shopId -> [timestamps]
const conversationRequests = new Map(); // conversationId -> [timestamps]

/**
 * Clean expired entries from a request log
 * @param {Array} timestamps - Array of request timestamps
 * @returns {Array} Filtered timestamps within the window
 */
function cleanExpired(timestamps) {
  const cutoff = Date.now() - WINDOW_MS;
  return timestamps.filter(ts => ts > cutoff);
}

/**
 * Check if a request is allowed under rate limits
 * @param {string} shopId - The shop identifier
 * @param {string} conversationId - The conversation identifier
 * @returns {{ allowed: boolean, retryAfter?: number, reason?: string }}
 */
export function checkRateLimit(shopId, conversationId) {
  const now = Date.now();

  // Check shop-level rate limit
  if (shopId) {
    let shopLog = shopRequests.get(shopId) || [];
    shopLog = cleanExpired(shopLog);

    if (shopLog.length >= SHOP_LIMIT) {
      const oldestInWindow = shopLog[0];
      const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfter, reason: 'shop_limit' };
    }

    shopLog.push(now);
    shopRequests.set(shopId, shopLog);
  }

  // Check conversation-level rate limit
  if (conversationId) {
    let convLog = conversationRequests.get(conversationId) || [];
    convLog = cleanExpired(convLog);

    if (convLog.length >= CONVERSATION_LIMIT) {
      const oldestInWindow = convLog[0];
      const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfter, reason: 'conversation_limit' };
    }

    convLog.push(now);
    conversationRequests.set(conversationId, convLog);
  }

  return { allowed: true };
}

/**
 * Periodically clean up stale entries to prevent memory leaks
 * Runs every 5 minutes
 */
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;

  for (const [key, timestamps] of shopRequests.entries()) {
    const filtered = timestamps.filter(ts => ts > cutoff);
    if (filtered.length === 0) {
      shopRequests.delete(key);
    } else {
      shopRequests.set(key, filtered);
    }
  }

  for (const [key, timestamps] of conversationRequests.entries()) {
    const filtered = timestamps.filter(ts => ts > cutoff);
    if (filtered.length === 0) {
      conversationRequests.delete(key);
    } else {
      conversationRequests.set(key, filtered);
    }
  }
}, 5 * 60 * 1000);
