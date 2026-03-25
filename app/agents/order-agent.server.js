/**
 * OrderAgent - Specialized agent for cart operations, order tracking, and modifications
 */
import { BaseAgent } from "./base-agent.server.js";
import agentPrompts from "./agent-prompts.json";

const ORDER_TOOLS = [
  'get_cart',
  'update_cart',
  'get_most_recent_order_status',
  'get_order_status',
  'request_order_modification'
];

export class OrderAgent extends BaseAgent {
  constructor() {
    super('order', agentPrompts.order.systemPrompt, ORDER_TOOLS);
  }
}
