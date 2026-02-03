/**
 * Cache Service
 * In-memory TTL cache with LRU eviction
 * Used for MCP tool lists, product searches, and intent classifications
 */

const MAX_ENTRIES = 1000;

class TTLCache {
  constructor(maxEntries = MAX_ENTRIES) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  set(key, value, ttlMs) {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Check if a key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear the entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {{ size: number, maxEntries: number }}
   */
  stats() {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries
    };
  }
}

// Singleton cache instance
const appCache = new TTLCache();

// TTL presets (in milliseconds)
export const CacheTTL = {
  TOOLS_LIST: 5 * 60 * 1000,       // 5 minutes
  PRODUCT_SEARCH: 2 * 60 * 1000,   // 2 minutes
  INTENT_CLASSIFICATION: 60 * 1000, // 1 minute
  CUSTOMER_ACCOUNT_URL: 30 * 60 * 1000 // 30 minutes
};

/**
 * Generate a cache key for MCP tools list
 * @param {string} endpoint - MCP endpoint URL
 * @returns {string}
 */
export function toolsListKey(endpoint) {
  return `tools_list:${endpoint}`;
}

/**
 * Generate a cache key for product search
 * @param {string} query - Search query
 * @returns {string}
 */
export function productSearchKey(query) {
  return `product_search:${query.toLowerCase().trim()}`;
}

/**
 * Generate a cache key for intent classification
 * @param {string} message - User message
 * @returns {string}
 */
export function intentClassificationKey(message) {
  return `intent:${message.toLowerCase().trim().substring(0, 200)}`;
}

export default appCache;
