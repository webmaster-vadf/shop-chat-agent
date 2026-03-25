/**
 * SupportAgent - Specialized agent for account management, escalation, and FAQ
 */
import { BaseAgent } from "./base-agent.server.js";
import agentPrompts from "./agent-prompts.json";

const SUPPORT_TOOLS = [
  'schedule_callback',
  'request_order_modification',
  'search_shop_policies_and_faqs'
];

export class SupportAgent extends BaseAgent {
  /**
   * SupportAgent includes Customer MCP tools dynamically
   * since account-related queries may need customer data access
   */
  getFilteredTools(allTools) {
    const baseFiltered = super.getFilteredTools(allTools);
    // Also include any customer MCP tools (they start with "get_" for customer operations)
    const customerTools = allTools.filter(t =>
      !baseFiltered.includes(t) && (
        t.name.includes('customer') ||
        t.name === 'get_most_recent_order_status' ||
        t.name === 'get_order_status'
      )
    );
    return [...baseFiltered, ...customerTools];
  }

  constructor() {
    super('support', agentPrompts.support.systemPrompt, SUPPORT_TOOLS);
  }
}
