/**
 * SalesAgent - Specialized agent for product discovery, quotes, and pricing
 */
import { BaseAgent } from "./base-agent.server.js";
import agentPrompts from "./agent-prompts.json";

const SALES_TOOLS = [
  'search_shop_catalog',
  'generate_quote',
  'check_stock_availability',
  'search_shop_policies_and_faqs'
];

export class SalesAgent extends BaseAgent {
  constructor() {
    super('sales', agentPrompts.sales.systemPrompt, SALES_TOOLS);
  }
}
