# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev              # Start Shopify app dev server with tunneling
npm run build            # Build Remix app for production
npm start               # Start production server
```

### Database Management
```bash
npm run setup           # Run Prisma generate and migrations (for deployment)
npx prisma generate     # Generate Prisma client
npx prisma migrate dev  # Create and apply migrations in development
npx prisma studio       # Open Prisma Studio GUI
```

### Shopify CLI
```bash
npm run deploy          # Deploy app to production (shopify app deploy)
npm run generate        # Generate extensions/code scaffolding
npm run config:link     # Link to existing app configuration
npm run config:use      # Switch between app configurations
npm run env             # Manage environment variables
```

### Code Quality
```bash
npm run lint            # Run ESLint
```

### Testing
```bash
node scripts/test-100-conversations.js  # Run 100-conversation regression test suite (requires dev server running)
```

## Architecture Overview

This is a **Shopify embedded app** that provides an AI-powered B2B chat agent for storefronts. The app uses Claude AI with the Model Context Protocol (MCP) and a multi-agent orchestration system to enable natural language product search, cart management, order tracking, quote generation, and customer account operations.

### Tech Stack
- **Framework**: Remix (React-based full-stack framework)
- **AI**: Claude by Anthropic (Sonnet 4 for conversations, Haiku 3.5 for intent classification and sentiment)
- **Database**: SQLite with Prisma ORM
- **Shopify Integration**: `@shopify/shopify-app-remix`, MCP protocol
- **Deployment**: Fly.io (with Litestream for SQLite replication)

### Core Components

#### 1. Multi-Agent Orchestration (`app/agents/`)

The chat system uses a multi-agent architecture where messages are routed to specialized agents based on intent, keywords, and conversation context.

**AgentOrchestrator** (`app/agents/orchestrator.server.js`):
Routes messages to the appropriate agent using a 4-step strategy (zero additional LLM calls):
1. **Intent mapping**: Maps 20 VADF intents to agent types
2. **Keyword matching**: Matches message keywords to agents (panier/commande → Order, produit/prix → Sales, compte/support → Support)
3. **Context continuation**: Reuses the same agent from the previous turn (`lastAgentType` in ConversationContext)
4. **Default**: Falls back to SalesAgent

**BaseAgent** (`app/agents/base-agent.server.js`):
Abstract base class containing the conversation while-loop (extracted from chat.jsx). All agents inherit `run()` which handles:
- Tool filtering (each agent only sees its allowed tools)
- Claude streaming with custom system prompts (`_customSystemPrompt`)
- Turn management (max 5 turns, 30s timeout)
- Error recovery with graceful degradation
- Message persistence and analytics tracking

**3 Specialized Agents:**

| Agent | File | Tools | Responsibility |
|-------|------|-------|----------------|
| **SalesAgent** | `sales-agent.server.js` | `search_shop_catalog`, `generate_quote`, `check_stock_availability`, `search_shop_policies_and_faqs` | Product discovery, quotes, pricing, stock |
| **SupportAgent** | `support-agent.server.js` | `schedule_callback`, `request_order_modification`, `search_shop_policies_and_faqs` + customer MCP tools | Account management, escalation, FAQ |
| **OrderAgent** | `order-agent.server.js` | `get_cart`, `update_cart`, `get_most_recent_order_status`, `get_order_status`, `request_order_modification` | Cart operations, order tracking, modifications |

**Agent Prompts** (`app/agents/agent-prompts.json`):
Each agent has a specialized system prompt with role-specific instructions, workflows, and communication style.

#### 2. MCP Client (`app/mcp-client.js`)
Implements the Model Context Protocol client that connects to two Shopify MCP servers:
- **Storefront MCP**: Product catalog search, cart operations, shop policies
- **Customer Account MCP**: Order history, order status, returns (requires authentication)

The client also handles:
- JSON-RPC communication with MCP endpoints (with retry + exponential backoff, 10s timeout)
- Tool discovery with caching (5min TTL via `cache.server.js`)
- Custom tool routing (4 custom tools: `generate_quote`, `request_order_modification`, `check_stock_availability`, `schedule_callback`)
- Customer authentication flow

#### 3. Chat Endpoint (`app/routes/chat.jsx`)
Main API route handling chat interactions via Server-Sent Events (SSE):
- **GET with `Accept: text/event-stream`**: Streaming chat responses
- **GET with `?history&conversation_id=X`**: Fetch conversation history
- **POST**: Same as streaming GET

Request body format:
```json
{
  "message": "user message text",
  "conversation_id": "optional-existing-id",
  "prompt_type": "vadfAssistant"
}
```

**Session Flow:**
1. Rate limiting check (per-shop 100/min, per-conversation 10/min)
2. Extract user message, initialize MCP client, connect to Storefront + Customer MCP servers
3. Load conversation history + conversation context (memory layer) + previous quotes
4. Async sentiment analysis (fire-and-forget via Claude Haiku)
5. **VADF Intent Detection** (hybrid: regex fast-path + Claude Haiku AI classification):
   - High-confidence VADF intent → deterministic templated response (22 intents)
   - Low-confidence / unknown / generic → falls through to orchestrator
6. **Multi-Agent Orchestration**: `AgentOrchestrator.route()` selects the best agent, then `agent.run()` executes the conversation loop with filtered tools
7. Save messages to database, track analytics events

#### 4. Services Layer

**Claude Service** (`app/services/claude.server.js`):
- Wraps Anthropic SDK
- Manages streaming conversations
- Handles system prompt injection: supports `promptType` (from prompts.json), language override, and `_customSystemPrompt` (agent override)
- Enriches system prompt with conversation context (memory layer: customer name, company, email, account status, previous quotes)
- Processes tool use requests

**Intent Classifier** (`app/services/intent-classifier.server.js`):
- Uses Claude Haiku for AI-powered intent classification
- Returns `{ intent, confidence, entities: { email, companyName, productName } }`
- Confidence thresholds: >= 0.7 high, >= 0.4 medium

**Custom Tools** (`app/services/custom-tools.server.js`):
- `generate_quote`: Creates B2B quotes (stored in Quote model, 30-day validity)
- `request_order_modification`: Logs modification requests with reference IDs
- `check_stock_availability`: Stock check with MCP integration guidance
- `schedule_callback`: Schedules customer callbacks

**Rate Limiter** (`app/services/rate-limiter.server.js`):
- In-memory sliding window: 100 req/min per shop, 10 req/min per conversation
- Auto-cleanup every 5 minutes

**Cache** (`app/services/cache.server.js`):
- In-memory TTL cache with LRU eviction (max 1000 entries)
- TTLs: tools/list 5min, product search 2min, classification 1min

**Analytics** (`app/services/analytics.server.js`):
- `trackEvent()` fire-and-forget at ~10 points in the chat flow
- `getAnalyticsSummary()`, `getConversationMetrics()`, `getIntentDistribution()`, `getSentimentTrend()`, `getConversionFunnel()`

**Sentiment** (`app/services/sentiment.server.js`):
- Async sentiment analysis via Claude Haiku (positive/neutral/negative + score)

**Tool Service** (`app/services/tool.server.js`):
- Handles MCP tool responses
- Manages tool errors (including auth_required for customer tools)
- Extracts and formats product data for display

**Streaming Service** (`app/services/streaming.server.js`):
- Creates SSE streams compatible with Remix
- Sends structured events: `chunk`, `message_complete`, `tool_use`, `product_results`, `end_turn`, etc.

**VADF Services** (deterministic business logic):
- **Response manager** (`app/services/vadf-response-manager.js`): Hybrid intent detection (regex fast-path + `classifyWithAI()` AI fallback) and templated response generation from `app/prompts/vadf_reponses.json`
- **Customer account checker** (`app/services/vadf-customer-account.server.js`): Validates professional customer status via Shopify Customer API

**Proactive Engine** (`app/services/proactive-engine.server.js`):
- Schedules proactive messages triggered by webhooks (cart abandonment, welcome, order updates)
- Processes pending messages via cron endpoint

#### 5. Database Schema (`prisma/schema.prisma`)

Key models:
- **Session**: Shopify app session storage
- **Conversation/Message**: Chat history persistence
- **CustomerToken**: OAuth tokens for Customer Account API access (with expiry)
- **CodeVerifier**: PKCE flow state management
- **CustomerAccountUrl**: Cached customer account URLs per conversation
- **ConversationContext**: Memory layer (email, name, company, account status, last intent, last agent type, extracted entities, message count)
- **Quote**: B2B quotes with items (JSON), amount, status (draft/sent/accepted/expired), validity
- **AnalyticsEvent**: Event tracking (conversationId, shopId, eventType, eventData)
- **ConversationOutcome**: Conversation results (outcome, sentiment, resolution time, tools used)
- **ProactiveMessage**: Scheduled proactive messages (trigger type, content, status, scheduled time)
- **ProactiveTemplate**: Message templates for proactive triggers

#### 6. Chat Widget Extension (`extensions/chat-bubble/`)
Shopify theme app extension providing the customer-facing UI:
- Renders as a chat bubble on storefront
- Communicates with backend via SSE
- Displays products, handles cart updates, shows auth prompts
- Proactive message polling (every 60s) with notification badge

#### 7. Admin Dashboard (`app/routes/app.dashboard.jsx`)
Polaris-based analytics dashboard with:
- KPI header (conversations, resolution rate, response time, sentiment, conversion)
- Tabs: Overview (intent distribution, sentiment trend), Conversations (list with badges), AI Performance (accuracy, tools, fallback rate), Export (CSV)

### Authentication Flow

Customer Account API operations require OAuth with PKCE (Proof Key for Code Exchange):

**Initial Auth Request:**
1. Customer tool requires auth → MCP client receives 401 error
2. `generateAuthUrl()` in `app/auth.server.js` creates PKCE verifier and challenge
3. Code verifier stored in database with state parameter (format: `{conversationId}-{shopId}`)
4. Auth URL returned to frontend with customer account OAuth endpoint

**OAuth Callback** (`app/routes/auth.callback.jsx`):
1. Customer authorizes and Shopify redirects to `/auth/callback?code=...&state=...`
2. Extract state to retrieve conversation ID and code verifier from database
3. Exchange authorization code for access token using code verifier
4. Store access token in `CustomerToken` table with expiry
5. Token automatically used for subsequent customer tool calls

**Token Management:**
- Tokens stored per conversation ID
- Expired tokens filtered out on retrieval
- Customer MCP endpoint discovered via `/.well-known/oauth-authorization-server`

See [app/auth.server.js](app/auth.server.js) and [app/routes/auth.callback.jsx](app/routes/auth.callback.jsx).

### Configuration

**Environment Variables** (`.env`):
- `CLAUDE_API_KEY`: Anthropic API key (required)
- `SHOPIFY_API_KEY`: App client ID (in `shopify.app.toml`)
- `REDIRECT_URL`: OAuth callback URL
- `CLAUDE_HAIKU_MODEL`: Model for intent classification and sentiment (default: `claude-haiku-3-5`)
- `RATE_LIMIT_PER_SHOP`: Requests per minute per shop (default: 100)
- `RATE_LIMIT_PER_CONVERSATION`: Requests per minute per conversation (default: 10)
- `PROACTIVE_PROCESSOR_SECRET`: Secret for proactive message processor endpoint

**App Config** (`app/services/config.server.js`):
- Default model: `claude-sonnet-4-20250514`
- Max tokens: 2000
- Default prompt type: `vadfAssistant`
- Tool names and display limits

**System Prompts** (`app/prompts/prompts.json`):
- `vadfAssistant`: Main VADF B2B assistant prompt
- `vadfAutonomousAgent`: Autonomous agent prompt with decision framework and tool orchestration
- `standardAssistant`: Generic shop assistant prompt
- Support for multiple languages (fr, en)

**Agent Prompts** (`app/agents/agent-prompts.json`):
- `sales`: Product discovery, quotes, cross-sell, VADF commercial workflow
- `support`: Problem resolution, empathy, escalation rules, account procedures
- `order`: Cart operations, order tracking, modification workflow

### MCP Tool Integration

The app uses JSON-RPC to communicate with Shopify's MCP servers. Available tools are discovered dynamically on each chat session via the `tools/list` method.

**Storefront MCP Endpoint:** `{shopDomain}/api/mcp`
- `search_shop_catalog`: Search products by natural language query
- `get_cart`: Retrieve current cart contents
- `update_cart`: Add/remove items from cart
- `search_shop_policies_and_faqs`: Query store policies and FAQs

**Customer Account MCP Endpoint:** `{customerAccountUrl}/customer/api/mcp`
- `get_most_recent_order_status`: Get latest order details
- `get_order_status`: Query specific order by ID
- Other customer-scoped operations (require OAuth)

**Custom Tools** (local, no MCP):
- `generate_quote`: Generate B2B quote with products, quantities, prices
- `request_order_modification`: Create order modification request
- `check_stock_availability`: Check product stock availability
- `schedule_callback`: Schedule customer callback

**Tool Call Flow:**
1. Agent selects tools based on its `toolFilter` (each agent only sees its allowed tools)
2. Claude decides to use a tool during response generation
3. `onToolUse` handler in `BaseAgent.run()` receives tool request
4. `mcpClient.callTool()` dispatches to appropriate MCP server or custom tool handler
5. Tool result returned to Claude for next turn
6. If 401 error, auth flow triggered and user prompted to login

MCP endpoints are hit directly via `fetch()` with JSON-RPC payloads (see `_makeJsonRpcRequest` in `app/mcp-client.js`).

### VADF Custom Mode

When `promptType: 'vadfAssistant'` or `'vadfAutonomousAgent'`, the system uses hybrid intent detection:

**Intent Classification (2-tier):**
1. **Regex fast-path** (`vadf-response-manager.js`): Keyword matching for exact hits (high speed, ~0ms)
2. **AI classification** (`intent-classifier.server.js`): Claude Haiku for ambiguous messages (~100ms, ~$0.001/call)
3. Confidence routing: high (>= 0.7) → VADF deterministic, medium (>= 0.4) → VADF flagged, low → Claude + MCP via agent orchestrator

**VADF-specific intents** (22 intents, handled by rule-based system):
- Account management (4): `creation_compte`, `activation_compte`, `mot_de_passe_oublie`, `mise_a_jour_infos_entreprise`
- Support (3): `escalade_support`, `erreur_generique`, `faq`
- Product info (12): `origine_produit`, `materiaux`, `fabrication`, `personnalisation`, `b2b_only`, `decouvrir_produits`, `commander_produits`, `reliquat`, `stock_indisponible`, `devis`, `tarifs`, `fiches_techniques`
- General (3): `salutation`, `remerciement`, `au_revoir`

**MCP fallback → Agent Orchestration:**
When intent is unknown, generic, or low-confidence, the message is routed to the AgentOrchestrator which selects the best specialized agent (Sales, Support, or Order) based on intent mapping, keyword matching, and conversation context.

**Response Selection:**
- Responses in `vadf_reponses.json` support conditional logic via `conditions` array
- Variable replacement with `{{variable}}` syntax (e.g., `{{email}}`, `{{nom_entreprise}}`)
- Context enrichment from customer account checks
- Override mechanism: `accountCheckResult.message` can override JSON responses if needed

### Webhooks

Configured webhook subscriptions (`shopify.app.toml`):
- `app/uninstalled`: App lifecycle
- `checkouts/create`, `checkouts/update`: Cart abandonment detection
- `customers/create`: Welcome message trigger
- `orders/fulfilled`, `orders/cancelled`: Order status notifications

Webhook handler: `app/routes/api.webhooks.jsx` → triggers proactive messages via `proactive-engine.server.js`

### Deployment

The app is configured for Fly.io deployment:
- `Dockerfile`: Multi-stage Node.js build
- `shopify.app.toml`: App configuration with scopes and redirect URLs
- Litestream: SQLite replication for production persistence
- `npm run docker-start`: Runs setup (migrations) then starts server

Deploy commands:
```bash
npx shopify app deploy --force  # Deploy Shopify app config + extensions
fly deploy                       # Deploy to Fly.io
```

Ensure the `application_url` in `shopify.app.toml` matches your production domain.

## Development Workflow

1. Clone repo and install dependencies: `npm install`
2. Set up environment variables (copy `.env.example` to `.env`)
3. Generate Prisma client: `npx prisma generate`
4. Start dev server: `npm run dev` (includes tunneling and hot reload)
5. Install app on development store via preview URL
6. Test chat widget on storefront
7. Run regression tests: `node scripts/test-100-conversations.js` (with dev server running)

## Important Patterns

**Multi-Agent Architecture:**
- Messages flow through VADF intent detection first (22 deterministic intents)
- When intent is unknown/generic/low-confidence, `AgentOrchestrator.route()` selects a specialized agent
- Each agent has its own system prompt and filtered tool set
- `BaseAgent.run()` contains the shared conversation loop (max 5 turns, 30s timeout)
- Agent type persisted in `ConversationContext.lastAgentType` for context continuation
- `claude.server.js` accepts `_customSystemPrompt` to override the default prompt per agent

**Message Storage:**
- User and assistant messages stored as JSON strings in database
- Content can be string or array of content blocks (text, tool_use, tool_result)
- Conversation history loaded and parsed on each request

**Memory Layer:**
- `ConversationContext` stores customer info across turns (email, name, company, account status)
- Extracted entities from AI classification are persisted
- Previous quotes loaded and injected into system prompt
- `lastAgentType` enables context-based agent continuation

**Error Handling:**
- Tool errors (especially `auth_required`) handled in `tool.server.js`
- MCP 401 errors trigger OAuth flow with auth URL returned to frontend
- SSE streams include error events for client handling
- Turn-level try/catch with graceful degradation (rate limit → retry message, server error → contact support)
- MCP requests retry with exponential backoff (1s, 2s, 4s) on 5xx/429 errors

**Prompt Management:**
- System prompts selected by `promptType` from `app/prompts/prompts.json`
- Agent-specific prompts in `app/agents/agent-prompts.json` (override via `_customSystemPrompt`)
- Language-specific instructions appended dynamically in `claude.server.js`
- Conversation context (memory layer) appended to system prompt

**Headers & CORS:**
- Chat endpoint requires `X-Shopify-Shop-Id` and `Origin` headers
- CORS configured to allow storefront domains
- SSE requires specific headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`

**MCP Client Architecture:**
- Single client manages both Storefront and Customer MCP connections
- Tools separated into `storefrontTools`, `customerTools`, and custom tools
- Tool routing based on tool name when `callTool()` invoked
- Custom tools executed locally via `executeCustomTool()` (no MCP)
- Customer tools require access token from database (conversation-scoped)
- Tools list cached for 5 minutes per endpoint

**Logging & Debugging:**
- Comprehensive console logs throughout the chat flow with emoji prefixes for easy filtering
- VADF mode logs: `[VADF]`, `[CHAT]` for intent detection and response generation
- Agent logs: `[AGENT:sales]`, `[AGENT:support]`, `[AGENT:order]` for agent-specific execution
- Orchestrator logs: `[ORCHESTRATOR]` for routing decisions
- MCP fallback logs: `[CHAT]` when no VADF intent matches and agent searches shop data
- Service logs: `[CLAUDE-SERVICE]`, `[TOOL]`, `[SSE]` for streaming and tool usage
- Session logs: `[SESSION]` for request handling
- MCP client logs: `[MCP-CLIENT]` for Storefront/Customer tool execution
- Intent classifier logs: `[INTENT-CLASSIFIER]` for AI classification results
- Custom tools logs: `[CUSTOM-TOOLS]` for quote/modification/callback execution
- Use grep to filter specific flows: `npm run dev | grep "\[ORCHESTRATOR\]"`

## Key Files to Understand

**Multi-Agent System:**
- [app/agents/orchestrator.server.js](app/agents/orchestrator.server.js): Agent routing (intent → keyword → context → default)
- [app/agents/base-agent.server.js](app/agents/base-agent.server.js): Shared conversation loop with tool filtering
- [app/agents/sales-agent.server.js](app/agents/sales-agent.server.js): Product/quote agent
- [app/agents/support-agent.server.js](app/agents/support-agent.server.js): Account/support agent
- [app/agents/order-agent.server.js](app/agents/order-agent.server.js): Cart/order agent
- [app/agents/agent-prompts.json](app/agents/agent-prompts.json): Agent-specific system prompts

**Core Chat Flow:**
- [app/routes/chat.jsx](app/routes/chat.jsx): Main chat logic, VADF intent detection, orchestrator integration
- [app/mcp-client.js](app/mcp-client.js): MCP protocol implementation (JSON-RPC over HTTP) + custom tool routing
- [app/services/claude.server.js](app/services/claude.server.js): Claude API integration, streaming, `_customSystemPrompt` support
- [app/services/streaming.server.js](app/services/streaming.server.js): SSE stream creation
- [app/services/tool.server.js](app/services/tool.server.js): Tool result handling

**Intelligence Layer:**
- [app/services/intent-classifier.server.js](app/services/intent-classifier.server.js): AI intent classification (Claude Haiku)
- [app/services/vadf-response-manager.js](app/services/vadf-response-manager.js): Hybrid intent detection (regex + AI) and response generation
- [app/services/custom-tools.server.js](app/services/custom-tools.server.js): Quote generation, order modification, stock check, callback scheduling
- [app/services/sentiment.server.js](app/services/sentiment.server.js): Async sentiment analysis

**Infrastructure:**
- [app/services/rate-limiter.server.js](app/services/rate-limiter.server.js): Sliding window rate limiting
- [app/services/cache.server.js](app/services/cache.server.js): TTL cache with LRU eviction
- [app/services/analytics.server.js](app/services/analytics.server.js): Event tracking and metrics

**Data Layer:**
- [app/db.server.js](app/db.server.js): Database operations (conversations, context, quotes, tokens, analytics)
- [prisma/schema.prisma](prisma/schema.prisma): Data model (11 models)

**Authentication:**
- [app/auth.server.js](app/auth.server.js): PKCE flow implementation
- [app/routes/auth.callback.jsx](app/routes/auth.callback.jsx): OAuth callback handler

**Configuration:**
- [shopify.app.toml](shopify.app.toml): App configuration, scopes, webhooks, redirect URLs
- [app/services/config.server.js](app/services/config.server.js): Runtime configuration
- [app/prompts/prompts.json](app/prompts/prompts.json): System prompts by type

**VADF Custom Logic:**
- [app/services/vadf-response-manager.js](app/services/vadf-response-manager.js): Intent detection and response generation
- [app/services/vadf-customer-account.server.js](app/services/vadf-customer-account.server.js): Customer account validation
- [app/prompts/vadf_reponses.json](app/prompts/vadf_reponses.json): Templated responses (22 intents)

**Proactive Messaging:**
- [app/services/proactive-engine.server.js](app/services/proactive-engine.server.js): Message scheduling and processing
- [app/routes/api.webhooks.jsx](app/routes/api.webhooks.jsx): Webhook handlers triggering proactive messages
- [app/routes/api.process-proactive.jsx](app/routes/api.process-proactive.jsx): Cron endpoint for processing scheduled messages

**Admin UI:**
- [app/routes/app.dashboard.jsx](app/routes/app.dashboard.jsx): Analytics dashboard (KPIs, conversations, AI performance, export)
- [app/routes/app.proactive.jsx](app/routes/app.proactive.jsx): Proactive messaging admin
- [app/routes/api.analytics-export.jsx](app/routes/api.analytics-export.jsx): CSV export endpoint

**Storefront UI:**
- [extensions/chat-bubble/blocks/chat-interface.liquid](extensions/chat-bubble/blocks/chat-interface.liquid): Theme extension UI
- [extensions/chat-bubble/assets/chat.js](extensions/chat-bubble/assets/chat.js): Frontend logic + proactive polling
- [extensions/chat-bubble/assets/chat.css](extensions/chat-bubble/assets/chat.css): Styling

**Testing:**
- [scripts/test-100-conversations.js](scripts/test-100-conversations.js): 100-conversation regression test suite (11 categories)

**Frontend SSE Event Types:**
The frontend (`chat.js`) handles the following Server-Sent Event types from the backend:
- `id`: Initial conversation ID
- `chunk`: Text delta for streaming responses
- `content_block_delta`: Alternative streaming format with `delta.text`
- `message_complete`: Message finished streaming
- `message_stop`: Alternative message completion event
- `tool_use`: Tool invocation notification (for debugging)
- `vadf_response`: VADF intent-based response with `text`, `vadf_intent`, and `vadf_type`
- `product_results`: Array of products to display with `products[]` containing `{title, price, url, image}`
- `auth_required`: Customer authentication needed with `auth_url` and `message`
- `escalade`: Support escalation notification with `contact` and `message`
- `end_turn`: Conversation turn complete
- `[DONE]`: Stream termination signal
