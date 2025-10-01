/**
 * Chat API Route
 * Handles chat interactions with Claude API and tools
 */
import { json } from "@remix-run/node";
import MCPClient from "../mcp-client";
import { saveMessage, getConversationHistory, storeCustomerAccountUrl, getCustomerAccountUrl } from "../db.server";
import AppConfig from "../services/config.server";
import { createSseStream } from "../services/streaming.server";
import { createClaudeService } from "../services/claude.server";
import { getVadfManager } from "../services/vadf-response-manager";
import { checkVadfCustomerAccount } from "../services/vadf-customer-account.server";
import { createToolService } from "../services/tool.server";
import { unauthenticated } from "../shopify.server";


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
    const userMessage = body.message;

    // Validate required message
    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: AppConfig.errorMessages.missingMessage }),
        { status: 400, headers: getSseHeaders(request) }
      );
    }

    // Generate or use existing conversation ID
    const conversationId = body.conversation_id || Date.now().toString();
    const promptType = body.prompt_type || AppConfig.api.defaultPromptType;

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
  // Initialize services
  const claudeService = createClaudeService();
  const toolService = createToolService();

  // Initialize MCP client
  const shopId = request.headers.get("X-Shopify-Shop-Id");
  const shopDomain = request.headers.get("Origin");
  const customerMcpEndpoint = await getCustomerMcpEndpoint(shopDomain, conversationId);
  const mcpClient = new MCPClient(
    shopDomain,
    conversationId,
    shopId,
    customerMcpEndpoint
  );

  try {
    // Send conversation ID to client
    stream.sendMessage({ type: 'id', conversation_id: conversationId });

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
    let productsToDisplay = [];

    // Sauvegarder le message utilisateur
    await saveMessage(conversationId, 'user', userMessage);
    const dbMessages = await getConversationHistory(conversationId);
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

    // --- INTÉGRATION VADF ---
    if (promptType === 'vadfAssistant') {
      // Utilisation du gestionnaire VADF asynchrone
      const vadfManager = await getVadfManager();
      const vadfIntent = vadfManager.detectIntent(userMessage);
      let vadfContext = vadfManager.enrichContext({
        isFirstMessage: conversationHistory.length <= 1
      });

      // Vérification du compte client si l'intention concerne le compte
      let accountCheckResult = null;
      if (["activation_compte", "mot_de_passe_oublie", "mise_a_jour_infos_entreprise"].includes(vadfIntent)) {
        // Extraction naïve de l'email depuis le message utilisateur (améliorable)
        const emailMatch = userMessage.match(/[\w.-]+@[\w.-]+\.[A-Za-z]{2,}/);
        const email = emailMatch ? emailMatch[0] : undefined;
        accountCheckResult = await checkVadfCustomerAccount({ email });
        // Adapter le contexte selon le statut du compte
        if (accountCheckResult.status === "active") {
          vadfContext = { ...vadfContext, compte_actif: true };
        } else if (accountCheckResult.status === "inactive") {
          vadfContext = { ...vadfContext, compte_actif: false };
        }
      }

      let vadfResponse = vadfManager.getResponse(vadfIntent, vadfContext);

      // Si la vérification de compte a un message spécifique, on le priorise
      if (accountCheckResult && accountCheckResult.message) {
        vadfResponse = { ...vadfResponse, text: accountCheckResult.message };
      }

      stream.sendMessage({
        type: 'vadf_response',
        text: vadfResponse.text,
        vadf_intent: vadfIntent,
        vadf_type: vadfResponse.type
      });

      // Escalade automatique si utilisateur non pro
      if (accountCheckResult && accountCheckResult.status === 'not_pro') {
        stream.sendMessage({
          type: 'escalade',
          contact: accountCheckResult.contact,
          message: 'Escalade automatique : utilisateur non professionnel.'
        });
      }
      // Escalade intelligente : si besoin, notifier contact@vadf.fr
      if (vadfIntent === 'escalade_support' || vadfResponse.type === 'error') {
        stream.sendMessage({
          type: 'escalade',
          contact: 'contact@vadf.fr',
          message: vadfManager.getCommonPhrase('contact_support')
        });
      }
      stream.sendMessage({ type: 'end_turn' });
      return;
    }
    // --- FIN INTÉGRATION VADF ---

    // Sinon, flux Claude classique
    let finalMessage = { role: 'user', content: userMessage };
    while (finalMessage.stop_reason !== "end_turn") {
      finalMessage = await claudeService.streamConversation(
        {
          messages: conversationHistory,
          promptType,
          tools: mcpClient.tools
        },
        {
          onText: (textDelta) => {
            stream.sendMessage({
              type: 'chunk',
              chunk: textDelta
            });
          },
          onMessage: (message) => {
            conversationHistory.push({
              role: message.role,
              content: message.content
            });
            saveMessage(conversationId, message.role, JSON.stringify(message.content))
              .catch((error) => {
                console.error("Error saving message to database:", error);
              });
            stream.sendMessage({ type: 'message_complete' });
          },
          onToolUse: async (content) => {
            const toolName = content.name;
            const toolArgs = content.input;
            const toolUseId = content.id;
            const toolUseMessage = `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`;
            stream.sendMessage({
              type: 'tool_use',
              tool_use_message: toolUseMessage
            });
            const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);
            if (toolUseResponse.error) {
              await toolService.handleToolError(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                stream.sendMessage,
                conversationId
              );
            } else {
              await toolService.handleToolSuccess(
                toolUseResponse,
                toolName,
                toolUseId,
                conversationHistory,
                productsToDisplay,
                conversationId
              );
            }
            stream.sendMessage({ type: 'new_message' });
          },
          onContentBlock: (contentBlock) => {
            if (contentBlock.type === 'text') {
              stream.sendMessage({
                type: 'content_block_complete',
                content_block: contentBlock
              });
            }
          }
        }
      );
    }
    stream.sendMessage({ type: 'end_turn' });
    if (productsToDisplay.length > 0) {
      stream.sendMessage({
        type: 'product_results',
        products: productsToDisplay
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
          url
        }
      }`,
    );

    const body = await response.json();
    const shopUrl = body.data.shop.url;

    // Store the shop URL with conversation ID in the DB
    await storeCustomerAccountUrl(conversationId, shopUrl);

    return `${shopUrl}/customer/api/mcp`;
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
