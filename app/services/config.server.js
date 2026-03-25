/**
 * Configuration Service
 * Centralizes all configuration values for the chat service
 */

/** @type {boolean} */
export const DEBUG = process.env.DEBUG === 'true';

export const AppConfig = {
  // API Configuration
  api: {
    defaultModel: 'claude-sonnet-4-20250514',
    maxTokens: 2000,
    defaultPromptType: 'vadfAssistant',
    maxMessageLength: 4000,  // ~1000 tokens
  },

  // Error Message Templates
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported: "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Claude API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    messageTooLong: "Message too long (max 4000 characters)",
    genericError: "Failed to get response from Claude"
  },

  // Tool Configuration
  tools: {
    productSearchName: "search_shop_catalog",
    maxProductsToDisplay: 3
  }
};

export default AppConfig;
