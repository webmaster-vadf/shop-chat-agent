/**
 * Claude Service
 * Manages interactions with the Claude API
 */
import { Anthropic } from "@anthropic-ai/sdk";
import AppConfig from "./config.server";
import systemPrompts from "../prompts/prompts.json";

/**
 * Creates a Claude service instance
 * @param {string} apiKey - Claude API key
 * @returns {Object} Claude service with methods for interacting with Claude API
 */
export function createClaudeService(apiKey = process.env.CLAUDE_API_KEY) {
  // Initialize Claude client
  const anthropic = new Anthropic({ apiKey });

  /**
   * Streams a conversation with Claude
   * @param {Object} params - Stream parameters
   * @param {Array} params.messages - Conversation history
   * @param {string} params.promptType - The type of system prompt to use
   * @param {string} params.language - Language code (fr, en, etc.)
   * @param {Array} params.tools - Available tools for Claude
   * @param {Object} streamHandlers - Stream event handlers
   * @param {Function} streamHandlers.onText - Handles text chunks
   * @param {Function} streamHandlers.onMessage - Handles complete messages
   * @param {Function} streamHandlers.onToolUse - Handles tool use requests
   * @returns {Promise<Object>} The final message
   */
  const streamConversation = async ({
    messages,
    promptType = AppConfig.api.defaultPromptType,
    language = 'fr',
    tools,
    conversationContext
  }, streamHandlers) => {
    console.log('\n🔵 [CLAUDE-SERVICE] streamConversation called');
    console.log('   - Prompt type:', promptType);
    console.log('   - Language:', language);
    console.log('   - Messages count:', messages?.length || 0);
    console.log('   - Tools count:', tools?.length || 0);
    console.log('   - Model:', AppConfig.api.defaultModel);
    console.log('   - Max tokens:', AppConfig.api.maxTokens);

    // Get system prompt from configuration or use default
    let systemInstruction = getSystemPrompt(promptType, language);

    // Enrich system prompt with conversation context (memory layer)
    if (conversationContext) {
      const ctxParts = [];
      if (conversationContext.customerName) ctxParts.push(`Nom du client : ${conversationContext.customerName}`);
      if (conversationContext.companyName) ctxParts.push(`Entreprise : ${conversationContext.companyName}`);
      if (conversationContext.customerEmail) ctxParts.push(`Email : ${conversationContext.customerEmail}`);
      if (conversationContext.accountStatus && conversationContext.accountStatus !== 'unknown') {
        ctxParts.push(`Statut compte : ${conversationContext.accountStatus === 'pro' ? 'Professionnel vérifié' : 'Non-professionnel'}`);
      }
      if (conversationContext.lastIntent) ctxParts.push(`Dernière intention détectée : ${conversationContext.lastIntent}`);
      if (conversationContext.messageCount > 1) ctxParts.push(`Messages échangés dans cette conversation : ${conversationContext.messageCount}`);
      if (conversationContext.previousQuotes && conversationContext.previousQuotes.length > 0) {
        const quotesSummary = conversationContext.previousQuotes.map(q =>
          `Devis #${q.id.slice(-6)} (${q.status}) - ${q.totalAmount}${q.currency || '€'} - ${new Date(q.createdAt).toLocaleDateString('fr-FR')}`
        ).join('; ');
        ctxParts.push(`Devis précédents : ${quotesSummary}`);
      }
      if (ctxParts.length > 0) {
        systemInstruction += `\n\n--- CONTEXTE CLIENT (mémoire de conversation) ---\n${ctxParts.join('\n')}`;
        console.log('   - Context enrichment added:', ctxParts.length, 'fields');
      }
    }

    console.log('   - System prompt length:', systemInstruction?.length || 0);
    console.log('   - System prompt preview:', systemInstruction?.substring(0, 100) + '...');

    // Log last user message
    const lastMessage = messages?.[messages.length - 1];
    if (lastMessage) {
      console.log('   - Last message role:', lastMessage.role);
      const contentPreview = typeof lastMessage.content === 'string'
        ? lastMessage.content.substring(0, 100)
        : JSON.stringify(lastMessage.content).substring(0, 100);
      console.log('   - Last message preview:', contentPreview + '...');
    }

    console.log('🚀 [CLAUDE-SERVICE] Creating message stream...');

    // Create stream
    const stream = await anthropic.messages.stream({
      model: AppConfig.api.defaultModel,
      max_tokens: AppConfig.api.maxTokens,
      system: systemInstruction,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined
    });

    console.log('✅ [CLAUDE-SERVICE] Stream created successfully');

    // Set up event handlers
    if (streamHandlers.onText) {
      stream.on('text', streamHandlers.onText);
      console.log('   - onText handler registered');
    }

    if (streamHandlers.onMessage) {
      stream.on('message', streamHandlers.onMessage);
      console.log('   - onMessage handler registered');
    }

    if (streamHandlers.onContentBlock) {
      stream.on('contentBlock', streamHandlers.onContentBlock);
      console.log('   - onContentBlock handler registered');
    }

    console.log('⏳ [CLAUDE-SERVICE] Waiting for final message...');

    // Wait for final message
    const finalMessage = await stream.finalMessage();

    console.log('✅ [CLAUDE-SERVICE] Final message received');
    console.log('   - Stop reason:', finalMessage.stop_reason);
    console.log('   - Content blocks:', finalMessage.content?.length || 0);
    finalMessage.content?.forEach((block, idx) => {
      console.log(`   - Block[${idx}]:`, block.type);
    });

    // Process tool use requests
    if (streamHandlers.onToolUse && finalMessage.content) {
      console.log('🔍 [CLAUDE-SERVICE] Checking for tool use in final message');
      let toolUseCount = 0;
      for (const content of finalMessage.content) {
        if (content.type === "tool_use") {
          toolUseCount++;
          console.log(`🔧 [CLAUDE-SERVICE] Processing tool use ${toolUseCount}:`, content.name);
          await streamHandlers.onToolUse(content);
        }
      }
      if (toolUseCount === 0) {
        console.log('   - No tool use found in final message');
      }
    }

    console.log('🔵 [CLAUDE-SERVICE] streamConversation completed\n');

    return finalMessage;
  };

  /**
   * Gets the system prompt content for a given prompt type and language
   * @param {string} promptType - The prompt type to retrieve
   * @param {string} language - Language code (fr, en, etc.)
   * @returns {string} The system prompt content
   */
  const getSystemPrompt = (promptType, language = 'fr') => {
    let basePrompt = systemPrompts.systemPrompts[promptType]?.content ||
      systemPrompts.systemPrompts[AppConfig.api.defaultPromptType].content;

    // Add language-specific instructions
    if (language === 'fr') {
      basePrompt += '\n\nIMPORTANT : Répondez EXCLUSIVEMENT en français, même si la question est posée dans une autre langue. Utilisez un français naturel et professionnel.';
    } else if (language === 'en') {
      basePrompt += '\n\nIMPORTANT: Always respond in English, regardless of the customer\'s question language. Use natural and fluent English.';
    }

    return basePrompt;
  };

  return {
    streamConversation,
    getSystemPrompt
  };
}

export default {
  createClaudeService
};