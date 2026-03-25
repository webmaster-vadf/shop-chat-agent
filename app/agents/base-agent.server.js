/**
 * BaseAgent - Abstract base class for all specialized agents
 * Extracts the conversation while-loop from chat.jsx into a reusable method
 */
import { saveMessage } from "../db.server";
import { trackEvent } from "../db.server";
import { AppConfig, DEBUG } from "../services/config.server";

export class BaseAgent {
  /**
   * @param {string} name - Agent identifier ("sales", "support", "order")
   * @param {string} systemPrompt - Agent-specific system prompt
   * @param {string[]|null} toolFilter - Array of allowed tool names, null = all tools
   */
  constructor(name, systemPrompt, toolFilter = null) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.toolFilter = toolFilter;
  }

  /**
   * Filter available tools to only those this agent is allowed to use
   * @param {Array} allTools - All available tools from MCP client
   * @returns {Array} Filtered tools for this agent
   */
  getFilteredTools(allTools) {
    if (!this.toolFilter || this.toolFilter.length === 0) return allTools;
    return allTools.filter(t => this.toolFilter.includes(t.name));
  }

  /**
   * Run the agent conversation loop
   * @param {Object} params
   * @param {Object} params.claudeService - Claude API service
   * @param {Object} params.mcpClient - MCP client with tools
   * @param {Object} params.toolService - Tool result handler service
   * @param {Array} params.conversationHistory - Conversation messages array
   * @param {Object} params.stream - SSE stream manager
   * @param {Object} params.conversationContext - Memory layer context
   * @param {string} params.conversationId - Conversation ID
   * @param {string} params.shopId - Shop ID
   * @returns {Promise<{productsToDisplay: Array, turnCount: number}>}
   */
  async run({ claudeService, mcpClient, toolService, conversationHistory,
              stream, conversationContext, conversationId, shopId }) {
    const agentTools = this.getFilteredTools(mcpClient.tools);

    if (DEBUG) console.log(`\n[AGENT:${this.name}] Starting with ${agentTools.length} tools`);
    if (DEBUG) console.log(`[AGENT:${this.name}] Tools: ${agentTools.map(t => t.name).join(', ')}`);

    let finalMessage = { role: 'user' };
    let turnCount = 0;
    const MAX_TURNS = AppConfig.api.maxAgentTurns;
    const SESSION_TIMEOUT = AppConfig.api.agentSessionTimeoutMs;
    const sessionStart = Date.now();
    let productsToDisplay = [];

    while (finalMessage.stop_reason !== "end_turn" && turnCount < MAX_TURNS) {
      // Check session timeout
      if (Date.now() - sessionStart > SESSION_TIMEOUT) {
        console.warn(`[AGENT:${this.name}] Session timeout reached`);
        stream.sendMessage({
          type: 'chunk',
          chunk: '\n\n_La session a mis trop de temps. Veuillez reformuler votre question._'
        });
        break;
      }

      turnCount++;
      if (DEBUG) console.log(`[AGENT:${this.name}] Turn ${turnCount}/${MAX_TURNS}`);

      try {
        finalMessage = await claudeService.streamConversation(
          {
            messages: conversationHistory,
            tools: agentTools,
            conversationContext,
            _customSystemPrompt: this.systemPrompt
          },
          {
            onText: (textDelta) => {
              stream.sendMessage({ type: 'chunk', chunk: textDelta });
            },
            onMessage: (message) => {
              conversationHistory.push({
                role: message.role,
                content: message.content
              });

              saveMessage(conversationId, message.role, JSON.stringify(message.content))
                .catch((error) => {
                  console.error(`[AGENT:${this.name}] Error saving message:`, error);
                });

              stream.sendMessage({ type: 'message_complete' });
            },
            onToolUse: async (content) => {
              const toolName = content.name;
              const toolArgs = content.input;
              const toolUseId = content.id;

              // Validate tool name is in the known tools list.
              // Note: by the time onToolUse fires, onMessage has already pushed the
              // assistant message (containing this tool_use block) to conversationHistory.
              // Adding a tool_result here is a valid response to that tool_use.
              const knownToolNames = agentTools.map(t => t.name);
              if (!knownToolNames.includes(toolName)) {
                console.warn(`[AGENT:${this.name}] Unknown tool requested: ${toolName}`);
                conversationHistory.push({
                  role: 'user',
                  content: [{
                    type: 'tool_result',
                    tool_use_id: toolUseId,
                    content: `Error: tool "${toolName}" is not available.`,
                    is_error: true
                  }]
                });
                stream.sendMessage({ type: 'end_turn' });
                return;
              }

              // Track tool usage
              trackEvent(conversationId, shopId, 'tool_used', {
                toolName,
                agentType: this.name,
                argsPreview: JSON.stringify(toolArgs).substring(0, 200)
              });

              if (DEBUG) console.log(`[AGENT:${this.name}] Tool call: ${toolName}`);

              stream.sendMessage({
                type: 'tool_use',
                tool_use_message: `Calling tool: ${toolName} with arguments: ${JSON.stringify(toolArgs)}`
              });

              const toolUseResponse = await mcpClient.callTool(toolName, toolArgs);

              if (toolUseResponse.error) {
                await toolService.handleToolError(
                  toolUseResponse, toolName, toolUseId,
                  conversationHistory, stream.sendMessage, conversationId
                );
              } else {
                await toolService.handleToolSuccess(
                  toolUseResponse, toolName, toolUseId,
                  conversationHistory, productsToDisplay, conversationId
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

        if (DEBUG) console.log(`[AGENT:${this.name}] Turn ${turnCount} complete, stop_reason: ${finalMessage.stop_reason}`);
      } catch (turnError) {
        console.error(`[AGENT:${this.name}] Error in turn ${turnCount}:`, turnError.message);
        trackEvent(conversationId, shopId, 'turn_error', {
          turn: turnCount,
          agentType: this.name,
          error: turnError.message
        });

        if (turnError.status === 429 || turnError.status === 529) {
          stream.sendMessage({
            type: 'chunk',
            chunk: '\n\n_Le service est temporairement surchargé. Veuillez réessayer dans quelques instants._'
          });
        } else {
          stream.sendMessage({
            type: 'chunk',
            chunk: '\n\n_Une erreur est survenue. Veuillez reformuler votre question ou contacter support@vadf.fr._'
          });
        }
        break;
      }
    }

    if (DEBUG) console.log(`[AGENT:${this.name}] Complete: ${turnCount} turns, ${productsToDisplay.length} products`);

    return { productsToDisplay, turnCount };
  }
}
