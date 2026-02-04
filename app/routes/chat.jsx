/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 */
import { json } from "@remix-run/node";
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrl, getCustomerAccountUrl, trackEvent, upsertConversationOutcome } from "../db.server";
import { loadContext, mergeContext, extractAndSaveFacts, updateSummaryIfNeeded } from "../services/context-manager.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { createToolService } from "../services/tool.server";
import { unauthenticated } from "../shopify.server";
import { getVadfManager } from "../services/vadf-response-manager.js";
import { checkVadfCustomerAccount } from "../services/vadf-customer-account.server.js";
import { checkRateLimit } from "../services/rate-limiter.server.js";
import { analyzeSentimentAsync } from "../services/sentiment.server.js";


/**
 * Remix loader function for handling GET requests
 */
export async function loader({ request }) {
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request)
    });
  }

  const url = new URL(request.url);

  // Handle history fetch requests - matches /chat?history=true&conversation_id=XYZ
  if (url.searchParams.has('history') && url.searchParams.has('conversation_id')) {
    return handleHistoryRequest(request, url.searchParams.get('conversation_id'));
  }

  // Handle SSE requests
  if (!url.searchParams.has('history') && request.headers.get("Accept") === "text/event-stream") {
    return handleChatRequest(request);
  }

  // API-only: reject all other requests
  return json(
    { error: AppConfig.errorMessages.apiUnsupported },
    { status: 400, headers: getCorsHeaders(request) }
  );
}

/**
 * Remix action function for handling POST requests
 */
export async function action({ request }) {
  return handleChatRequest(request);
}

/**
 * Handle history fetch requests
 * @param {Request} request - The request object
 * @param {string} conversationId - The conversation ID
 * @returns {Response} JSON response with chat history
 */
async function handleHistoryRequest(request, conversationId) {
  const messages = await getConversationHistory(conversationId);

  return json(
    { messages },
    { headers: getCorsHeaders(request) }
  );
}

/**
 * Handle chat requests (both GET and POST)
 * @param {Request} request - The request object
 * @returns {Response} Server-sent events stream
 */
async function handleChatRequest(request) {
  try {
    // Get message data from request body
    const body = await request.json();
    console.log('📨 [CHAT] Received request body:', JSON.stringify(body));

    const userMessage = body.message;
    console.log('💬 [CHAT] User message:', userMessage);

    // Validate required message
    if (!userMessage) {
      console.log('❌ [CHAT] Missing message in request');
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;
    const shopId = request.headers.get("X-Shopify-Shop-Id");

    // Rate limiting check
    const rateLimitResult = checkRateLimit(shopId, conversationId);
    if (!rateLimitResult.allowed) {
      console.log(`[CHAT] Rate limit exceeded: ${rateLimitResult.reason}, retry after ${rateLimitResult.retryAfter}s`);
      return new Response(
        JSON.stringify({
          error: AppConfig.errorMessages.rateLimitExceeded,
          details: AppConfig.errorMessages.rateLimitDetails,
          retryAfter: rateLimitResult.retryAfter
        }),
        {
          status: 429,
          headers: {
            ...getCorsHeaders(request),
            'Retry-After': String(rateLimitResult.retryAfter)
          }
        }
      );
    }

    console.log('🆔 [CHAT] Conversation ID:', conversationId);
    console.log('⚙️ [CHAT] Prompt type:', promptType);
    console.log('🔐 [CHAT] Shop ID:', shopId);
    console.log('🌐 [CHAT] Origin:', request.headers.get("Origin"));

    // Create a stream for the response
    const responseStream = createSseStream(async (stream) => {
      await handleChatSession({
        request,
        userMessage,
        conversationId,
        promptType,
        stream
      });
    });

    return new Response(responseStream, {
      headers: getSseHeaders(request)
    });
  } catch (error) {
    console.error('Error in chat request handler:', error);
    return json({ error: error.message }, {
      status: 500,
      headers: getCorsHeaders(request)
    });
  }
}

/**
 * Handle a complete chat session
 * @param {Object} params - Session parameters
 * @param {Request} params.request - The request object
 * @param {string} params.userMessage - The user's message
 * @param {string} params.conversationId - The conversation ID
 * @param {string} params.promptType - The prompt type
 * @param {Object} params.stream - Stream manager for sending responses
 */
async function handleChatSession({
  request,
  userMessage,
  conversationId,
  promptType,
  stream
}) {
  console.log('🚀 [SESSION] Starting chat session');
  console.log('🆔 [SESSION] Conversation ID:', conversationId);
  console.log('💬 [SESSION] User message:', userMessage);
  console.log('⚙️ [SESSION] Prompt type:', promptType);

  // Initialize services
  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");
  console.log('🏪 [SESSION] Shop domain:', shopDomain);
  console.log('🔑 [SESSION] Shop ID:', shopId);

  const customerMcpEndpoint = await getCustomerMcpEndpoint(shopDomain, conversationId);
  console.log('🔗 [SESSION] Customer MCP endpoint:', customerMcpEndpoint);

  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    customerMcpEndpoint
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });
    console.log('📤 [SESSION] Sent conversation ID to client');

    // Connect to MCP servers and get available tools
    let storefrontMcpTools = [], customerMcpTools = [];
    try {
      storefrontMcpTools = await mcpClient.connectToStorefrontServer();
      customerMcpTools = await mcpClient.connectToCustomerServer();
      console.log(`Connected to MCP with ${storefrontMcpTools.length} tools`);
      console.log(`Connected to customer MCP with ${customerMcpTools.length} tools`);
    } catch (error) {
      console.warn('Failed to connect to MCP servers, continuing without tools:', error.message);
    }

    // Préparer l'état de la conversation
    let conversationHistory = [];

    // Track session start event (fire-and-forget)
    trackEvent(conversationId, shopId, 'chat_session_started', { promptType });

    // Sauvegarder le message utilisateur
    console.log('💾 [SESSION] Saving user message to database');
    await saveMessage(conversationId, 'user', userMessage);

    // Track user message event
    trackEvent(conversationId, shopId, 'user_message_received', {
      messageLength: userMessage.length
    });

    // Analyze sentiment (non-blocking, fire-and-forget)
    analyzeSentimentAsync(userMessage, conversationId, shopId);

    // Extract and persist memory facts from user message (non-blocking)
    extractAndSaveFacts(conversationId, userMessage, null, shopId)
      .catch(e => console.warn('[MEMORY] Fact extraction failed:', e.message));

    console.log('📚 [SESSION] Loading conversation history from database');
    const dbMessages = await getConversationHistory(conversationId);
    console.log('📊 [SESSION] Total messages in history:', dbMessages.length);

    conversationHistory = dbMessages.map(dbMessage => {
      let content;
      try {
        content = JSON.parse(dbMessage.content);
      } catch (e) {
        content = dbMessage.content;
      }
      return {
        role: dbMessage.role,
        content
      };
    });

    // Load full conversation context (context + quotes) in a single call
    const conversationContext = await loadContext(conversationId);
    if (conversationContext) {
      console.log('📋 [SESSION] Loaded conversation context:', {
        email: conversationContext.customerEmail,
        name: conversationContext.customerName,
        company: conversationContext.companyName,
        messageCount: conversationContext.messageCount,
        quotes: conversationContext.previousQuotes?.length || 0
      });
    }

    console.log('📝 [SESSION] Parsed conversation history:', conversationHistory.length, 'messages');
    if (conversationHistory.length > 0) {
      console.log('📜 [SESSION] Last 3 messages:', JSON.stringify(conversationHistory.slice(-3).map(m => ({
        role: m.role,
        contentPreview: typeof m.content === 'string' ? m.content.substring(0, 100) : '[Object]'
      }))));
    }

    // --- INTÉGRATION VADF AVEC FALLBACK MCP ---
    let vadfIntent = undefined; // hoisted for orchestrator access
    if (promptType === 'vadfAssistant' || promptType === 'vadfAutonomousAgent') {
      console.log('\n\n════════════════════════════════════════════════════════');
      console.log('🚀🚀🚀 [CHAT] VADF MODE ACTIVATED 🚀🚀🚀');
      console.log('📝 [CHAT] User message:', userMessage);
      console.log('📝 [CHAT] Message length:', userMessage?.length);
      console.log('════════════════════════════════════════════════════════\n');

      // Utilisation du gestionnaire VADF asynchrone
      const vadfManager = await getVadfManager();
      console.log('✅ [CHAT] VADF Manager loaded');

      // Classification IA avec fallback regex
      const classification = await vadfManager.classifyWithAI(userMessage, conversationHistory);
      vadfIntent = classification.intent;
      const confidence = classification.confidence;
      const extractedEntities = classification.entities || {};

      // Track intent detection event
      trackEvent(conversationId, shopId, 'intent_detected', {
        intent: vadfIntent,
        confidence,
        source: classification.source,
        entities: extractedEntities
      });

      // Update conversation context with extracted entities
      mergeContext(conversationId, {
        lastIntent: vadfIntent,
        customerEmail: extractedEntities.email || conversationContext?.customerEmail || undefined,
        customerName: extractedEntities.companyName || conversationContext?.customerName || undefined,
        companyName: extractedEntities.companyName || conversationContext?.companyName || undefined,
        extractedEntities: JSON.stringify(extractedEntities)
      }).catch(e => console.warn('[SESSION] Context update failed:', e.message));

      console.log('\n🔍🔍🔍 [CHAT] ===== INTENT DETECTION RESULT ===== 🔍🔍🔍');
      console.log('🔍 [CHAT] Detected intent:', vadfIntent);
      console.log('🔍 [CHAT] Confidence:', confidence);
      console.log('🔍 [CHAT] Source:', classification.source);
      console.log('🔍 [CHAT] Entities:', JSON.stringify(extractedEntities));
      console.log('════════════════════════════════════════════════════════\n');

      // Routing basé sur la confiance et le type d'intent
      const shouldUseMcp = !vadfIntent
        || vadfIntent === 'unknown'
        || classification.source === 'ai_fallback'
        || classification.source === 'ai_generic'
        || (confidence < 0.5);

      if (shouldUseMcp) {
        console.log('\n⚠️⚠️⚠️ [CHAT] ===== MCP FALLBACK TRIGGERED ===== ⚠️⚠️⚠️');
        console.log('🔄 [CHAT] Routing to Claude + Shopify MCP');
        console.log('🔄 [CHAT] Reason:', classification.source || 'low_confidence');
        console.log('🛍️ [CHAT] Available Storefront MCP tools:', storefrontMcpTools.length);
        console.log('👤 [CHAT] Available Customer MCP tools:', customerMcpTools.length);
        console.log('📝 [CHAT] Claude will search shop data for: "' + userMessage + '"');
        console.log('════════════════════════════════════════════════════════\n');
        // Ne pas retourner ici, laisser continuer vers le flux Claude
      } else {
        // Intent VADF spécifique détecté, traiter avec le système VADF
        console.log('✅ [CHAT] VADF-specific intent detected:', vadfIntent, '(confidence:', confidence, ')');
        console.log('════════════════════════════════════════════════════════');

        let vadfContext = vadfManager.enrichContext({
          isFirstMessage: conversationHistory.length <= 1
        });
        console.log('📋 [CHAT] Initial context:', vadfContext);

        // Utiliser les entités extraites par l'IA (email, companyName, etc.)
        const email = extractedEntities.email || undefined;

        // Vérification du compte client si l'intention concerne le compte
        let accountCheckResult = null;
        if (["mot_de_passe_oublie", "mise_a_jour_infos_entreprise"].includes(vadfIntent)) {
          console.log('👤 [CHAT] Account-related intent detected:', vadfIntent);

          if (email) {
            console.log('📧 [CHAT] Email extracted by AI classifier:', email);
            accountCheckResult = await checkVadfCustomerAccount({ email });
            console.log('✅ [CHAT] Account check result:', JSON.stringify(accountCheckResult, null, 2));
          } else {
            console.log('⚠️ [CHAT] No email found, skipping account check');
          }

          // Adapter le contexte selon le statut du compte
          if (accountCheckResult && accountCheckResult.status === "active") {
            vadfContext = { ...vadfContext, compte_actif: true };
          } else if (accountCheckResult && accountCheckResult.status === "inactive") {
            vadfContext = { ...vadfContext, compte_actif: false };
          }
        } else if (vadfIntent === 'activation_compte') {
          console.log('👤 [CHAT] activation_compte intent - using default VADF response');
        }

        // Enrichir le contexte avec les entités IA et le résultat du check
        if (accountCheckResult) {
          vadfContext = {
            ...vadfContext,
            email: email,
            nom: accountCheckResult.nom || undefined,
            statut_pro: accountCheckResult.status || undefined,
            telephone: accountCheckResult.telephone || undefined
          };
        }
        // Ajouter les entités IA au contexte même sans account check
        if (extractedEntities.companyName) {
          vadfContext.nom_entreprise = extractedEntities.companyName;
        }
        if (email && !vadfContext.email) {
          vadfContext.email = email;
        }

        let vadfResponse = vadfManager.getResponse(vadfIntent, vadfContext);
        console.log('📤 [CHAT] VADF response: type=', vadfResponse.type, ', text length=', vadfResponse.text?.length);

        // Override si le check de compte a un message spécifique
        const shouldUseAccountMessage = accountCheckResult && accountCheckResult.message
          && !(vadfIntent === 'activation_compte' && accountCheckResult.status === 'not_found');

        if (shouldUseAccountMessage) {
          console.log('⚠️ [CHAT] OVERRIDE: Using account check message');
          vadfResponse = { ...vadfResponse, text: accountCheckResult.message };
        }

        stream.sendMessage({
          type: 'vadf_response',
          text: vadfResponse.text,
          vadf_intent: vadfIntent,
          vadf_type: vadfResponse.type,
          vadf_confidence: confidence
        });

        // Track VADF response event
        trackEvent(conversationId, shopId, 'vadf_response_sent', {
          intent: vadfIntent,
          responseType: vadfResponse.type,
          confidence
        });

        // Save assistant response to DB
        saveMessage(conversationId, 'assistant', vadfResponse.text)
          .catch(e => console.error('[CHAT] Error saving VADF response:', e));

        // Escalade automatique si utilisateur non pro
        if (accountCheckResult && accountCheckResult.status === 'not_pro') {
          stream.sendMessage({
            type: 'escalade',
            contact: accountCheckResult.contact,
            message: 'Escalade automatique : utilisateur non professionnel.'
          });
          trackEvent(conversationId, shopId, 'escalation_triggered', { reason: 'not_pro' });
          upsertConversationOutcome(conversationId, { outcome: 'escalated', shopId });
        }
        // Escalade intelligente
        if (vadfIntent === 'escalade_support' || vadfResponse.type === 'error') {
          stream.sendMessage({
            type: 'escalade',
            contact: 'contact@vadf.fr',
            message: vadfManager.getCommonPhrase('contact_support')
          });
          trackEvent(conversationId, shopId, 'escalation_triggered', { reason: vadfIntent });
          upsertConversationOutcome(conversationId, { outcome: 'escalated', shopId });
        }

        // Track outcome for goodbye/thanks -> resolved
        if (['au_revoir', 'remerciement'].includes(vadfIntent)) {
          upsertConversationOutcome(conversationId, { outcome: 'resolved', shopId });
        }

        console.log('✅ [CHAT] VADF response complete, sending end_turn');
        stream.sendMessage({ type: 'end_turn' });
        return;
      }
    }
    // --- FIN INTÉGRATION VADF ---

    // --- ORCHESTRATION MULTI-AGENTS ---
    const { AgentOrchestrator } = await import('../agents/orchestrator.server.js');
    const orchestrator = new AgentOrchestrator();

    const { agent, routingReason, routingConfidence, routingMethod } = orchestrator.route(userMessage, vadfIntent, conversationContext);

    console.log('\n\n════════════════════════════════════════════════════════');
    console.log(`🤖 [AGENT] Routed to: ${agent.name} (reason: ${routingReason}, confidence: ${routingConfidence}, method: ${routingMethod})`);
    console.log('📊 [AGENT] Conversation history length:', conversationHistory.length);
    console.log('🛠️ [AGENT] Total tools available:', mcpClient.tools?.length || 0);
    console.log('════════════════════════════════════════════════════════\n');

    // Track routing decision with confidence
    trackEvent(conversationId, shopId, 'routing_selected', {
      agentType: agent.name,
      routingReason,
      routingConfidence,
      routingMethod
    });

    // Update context with agent type
    mergeContext(conversationId, {
      lastAgentType: agent.name
    }).catch(e => console.warn('[SESSION] Agent type update failed:', e.message));

    const { productsToDisplay, turnCount } = await agent.run({
      claudeService, mcpClient, toolService,
      conversationHistory, stream, conversationContext,
      conversationId, shopId
    });

    console.log('\n════════════════════════════════════════════════════════');
    console.log(`🏁 [AGENT:${agent.name}] Conversation complete`);
    console.log('   - Total turns:', turnCount);
    console.log('   - Products to display:', productsToDisplay.length);
    console.log('════════════════════════════════════════════════════════\n');

    stream.sendMessage({ type: 'end_turn' });

    // Update conversation summary if threshold reached (non-blocking)
    const currentMsgCount = conversationContext?.messageCount || conversationHistory.length;
    updateSummaryIfNeeded(conversationId, conversationHistory, currentMsgCount)
      .catch(e => console.warn('[MEMORY] Summary update failed:', e.message));

    // Track conversation turn completion
    trackEvent(conversationId, shopId, 'conversation_turn_complete', {
      turnCount,
      agentType: agent.name
    });

    if (productsToDisplay.length > 0) {
      console.log(`🛍️ [AGENT:${agent.name}] Sending product results:`, productsToDisplay.length, 'products');
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
      });

      trackEvent(conversationId, shopId, 'products_displayed', {
        count: productsToDisplay.length,
        products: productsToDisplay.map(p => p.title)
      });
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Get the customer MCP endpoint for a shop
 * @param {string} shopDomain - The shop domain
 * @param {string} conversationId - The conversation ID
 * @returns {string} The customer MCP endpoint
 */
async function getCustomerMcpEndpoint(shopDomain, conversationId) {
  try {
    // Check if shopDomain is provided
    if (!shopDomain) {
      console.warn('No shop domain provided, skipping customer MCP endpoint setup');
      return null;
    }

    // Check if the customer account URL exists in the DB
    const existingUrl = await getCustomerAccountUrl(conversationId);

    // If URL exists, return early with the MCP endpoint
    if (existingUrl) {
      return `${existingUrl}/customer/api/mcp`;
    }

    // If not, query for it from the Shopify API
    const { hostname } = new URL(shopDomain);
    const { storefront } = await unauthenticated.storefront(
      hostname
    );

    const response = await storefront.graphql(
      `#graphql
      query shop {
        shop {
          customerAccountsV2 {
            url
          }
        }
      }`,
    );

    const body = await response.json();
    const customerAccountUrl = body.data.shop.customerAccountsV2.url;

    // Store the customer account URL with conversation ID in the DB
    await storeCustomerAccountUrl(conversationId, customerAccountUrl);

    return `${customerAccountUrl}/customer/api/mcp`;
  } catch (error) {
    console.error("Error getting customer MCP endpoint:", error);
    return null;
  }
}

/**
 * Gets CORS headers for the response
 * @param {Request} request - The request object
 * @returns {Object} CORS headers object
 */
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400" // 24 hours
  };
}

/**
 * Get SSE headers for the response
 * @param {Request} request - The request object
 * @returns {Object} SSE headers object
 */
function getSseHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };
}
