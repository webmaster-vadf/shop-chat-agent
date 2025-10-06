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

## Architecture Overview

This is a **Shopify embedded app** that provides an AI-powered chat widget for storefronts. The app uses Claude AI with the Model Context Protocol (MCP) to enable natural language product search, cart management, order tracking, and customer account operations.

### Tech Stack
- **Framework**: Remix (React-based full-stack framework)
- **AI**: Claude by Anthropic (Sonnet 4)
- **Database**: SQLite with Prisma ORM
- **Shopify Integration**: `@shopify/shopify-app-remix`, MCP protocol
- **Deployment**: Fly.io (with Litestream for SQLite replication)

### Core Components

#### 1. MCP Client (`app/mcp-client.js`)
Implements the Model Context Protocol client that connects to two Shopify MCP servers:
- **Storefront MCP**: Product catalog search, cart operations, shop policies
- **Customer Account MCP**: Order history, order status, returns (requires authentication)

The client handles:
- JSON-RPC communication with MCP endpoints
- Tool discovery and invocation
- Customer authentication flow
- Dynamic endpoint resolution via `.well-known/shopify/customer-account`

#### 2. Chat Endpoint (`app/routes/chat.jsx`)
Main API route handling chat interactions via Server-Sent Events (SSE):
- **GET with `Accept: text/event-stream`**: Streaming chat responses
- **GET with `?history&conversation_id=X`**: Fetch conversation history
- **POST**: Same as streaming GET

Request body format:
```json
{
  "message": "user message text",
  "conversation_id": "optional-existing-id",
  "prompt_type": "vadfAssistant" // or other prompt type from prompts.json
}
```

The endpoint supports two modes:
- **Standard Claude mode**: Uses Claude API with MCP tools for Shopify operations
- **VADF mode** (`promptType: 'vadfAssistant'`): Custom intent-based responses for specific business logic (professional account management, password reset, etc.)

**Session Flow:**
1. Extract user message and conversation ID from request
2. Initialize MCP client and connect to Storefront + Customer MCP servers
3. Load conversation history from database
4. If VADF mode: detect intent → return templated response OR fallback to Claude
5. If Claude mode: stream conversation with tool use support
6. Save all messages to database for history persistence

#### 3. Services Layer

**Claude Service** (`app/services/claude.server.js`):
- Wraps Anthropic SDK
- Manages streaming conversations
- Handles system prompt injection based on `promptType` and language
- Processes tool use requests

**Tool Service** (`app/services/tool.server.js`):
- Handles MCP tool responses
- Manages tool errors (including auth_required for customer tools)
- Extracts and formats product data for display

**Streaming Service** (`app/services/streaming.server.js`):
- Creates SSE streams compatible with Remix
- Sends structured events: `chunk`, `message_complete`, `tool_use`, `product_results`, `end_turn`, etc.

**VADF Services** (custom business logic):
- **Intent matcher** (`app/services/vadf-intent-matcher.js`): Detects user intents using regex patterns (account activation, password reset, support escalation)
- **Response manager** (`app/services/vadf-response-manager.js`): Generates templated responses from `app/prompts/vadf_reponses.json` based on detected intent
- **Customer account checker** (`app/services/vadf-customer-account.server.js`): Validates professional customer status via Shopify Customer API

#### 4. Database Schema (`prisma/schema.prisma`)

Key models:
- **Session**: Shopify app session storage
- **Conversation/Message**: Chat history persistence
- **CustomerToken**: OAuth tokens for Customer Account API access (with expiry)
- **CodeVerifier**: PKCE flow state management
- **CustomerAccountUrl**: Cached customer account URLs per conversation

#### 5. Chat Widget Extension (`extensions/chat-bubble/`)
Shopify theme app extension providing the customer-facing UI:
- Renders as a chat bubble on storefront
- Communicates with backend via SSE
- Displays products, handles cart updates, shows auth prompts

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

**App Config** (`app/services/config.server.js`):
- Default model: `claude-sonnet-4-20250514`
- Max tokens: 2000
- Default prompt type: `vadfAssistant`
- Tool names and display limits

**System Prompts** (`app/prompts/prompts.json`):
- Define assistant behavior per `promptType`
- Support for multiple languages (fr, en)

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

**Tool Call Flow:**
1. Claude decides to use a tool during response generation
2. `onToolUse` handler in `app/routes/chat.jsx` receives tool request
3. `mcpClient.callTool()` dispatches to appropriate MCP server
4. Tool result returned to Claude for next turn
5. If 401 error, auth flow triggered and user prompted to login

MCP endpoints are hit directly via `fetch()` with JSON-RPC payloads (see `_makeJsonRpcRequest` in `app/mcp-client.js`).

### VADF Custom Mode

When `promptType: 'vadfAssistant'`, the system uses hybrid intent detection with MCP fallback:
- **VADF-specific intents** (handled by rule-based system):
  - Account management: `activation_compte`, `mot_de_passe_oublie`, `mise_a_jour_infos_entreprise`
  - Support: `escalade_support`
  - Product info: `origine_produit`, `personnalisation`, `b2b_only`
  - Checks customer account status via `vadf-customer-account.server.js`
  - Returns templated responses from `app/prompts/vadf_reponses.json`
  - Triggers support escalation for non-professional accounts

- **MCP fallback** (product search, cart, orders):
  - Generic queries: `unknown`, `salutation`, `remerciement`, `au_revoir`
  - Product keywords: "produit", "cherche", "prix", "stock", "commander", "panier"
  - Automatically switches to Claude + MCP Storefront tools
  - Uses system prompt from `prompts.json` with VADF branding

**Intent Detection Flow:**
1. Check if message contains product keywords → MCP
2. Check for VADF-specific account/support keywords → VADF responses
3. Check for generic greetings/thanks → MCP
4. Default → MCP

This hybrid mode provides deterministic responses for account management while leveraging AI for product discovery.

### Deployment

The app is configured for Fly.io deployment:
- `Dockerfile`: Multi-stage Node.js build
- `shopify.app.toml`: App configuration with scopes and redirect URLs
- Litestream: SQLite replication for production persistence
- `npm run docker-start`: Runs setup (migrations) then starts server

Ensure the `application_url` in `shopify.app.toml` matches your production domain.

## Development Workflow

1. Clone repo and install dependencies: `npm install`
2. Set up environment variables (copy `.env.example` to `.env`)
3. Generate Prisma client: `npx prisma generate`
4. Start dev server: `npm run dev` (includes tunneling and hot reload)
5. Install app on development store via preview URL
6. Test chat widget on storefront

## Important Patterns

**Message Storage:**
- User and assistant messages stored as JSON strings in database
- Content can be string or array of content blocks (text, tool_use, tool_result)
- Conversation history loaded and parsed on each request

**Error Handling:**
- Tool errors (especially `auth_required`) handled in `tool.server.js`
- MCP 401 errors trigger OAuth flow with auth URL returned to frontend
- SSE streams include error events for client handling

**Prompt Management:**
- System prompts selected by `promptType` parameter from `app/prompts/prompts.json`
- Language-specific instructions appended dynamically in `claude.server.js`
- VADF mode uses hybrid approach: intent detection → custom response OR Claude fallback

**Headers & CORS:**
- Chat endpoint requires `X-Shopify-Shop-Id` and `Origin` headers
- CORS configured to allow storefront domains
- SSE requires specific headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`

**MCP Client Architecture:**
- Single client manages both Storefront and Customer MCP connections
- Tools separated into `storefrontTools` and `customerTools` arrays
- Tool routing based on tool name when `callTool()` invoked
- Customer tools require access token from database (conversation-scoped)

## Key Files to Understand

**Core Chat Flow:**
- [app/routes/chat.jsx](app/routes/chat.jsx): Main chat logic and session orchestration
- [app/mcp-client.js](app/mcp-client.js): MCP protocol implementation (JSON-RPC over HTTP)
- [app/services/claude.server.js](app/services/claude.server.js): Claude API integration and streaming
- [app/services/streaming.server.js](app/services/streaming.server.js): SSE stream creation
- [app/services/tool.server.js](app/services/tool.server.js): Tool result handling

**Data Layer:**
- [app/db.server.js](app/db.server.js): Database operations (conversation history, tokens, code verifiers)
- [prisma/schema.prisma](prisma/schema.prisma): Data model with Prisma ORM

**Authentication:**
- [app/auth.server.js](app/auth.server.js): PKCE flow implementation
- [app/routes/auth.callback.jsx](app/routes/auth.callback.jsx): OAuth callback handler

**Configuration:**
- [shopify.app.toml](shopify.app.toml): App configuration, scopes, and redirect URLs
- [app/services/config.server.js](app/services/config.server.js): Runtime configuration
- [app/prompts/prompts.json](app/prompts/prompts.json): System prompts by type

**VADF Custom Logic:**
- [app/services/vadf-intent-matcher.js](app/services/vadf-intent-matcher.js): Intent detection with regex
- [app/services/vadf-response-manager.js](app/services/vadf-response-manager.js): Response generation
- [app/prompts/vadf_reponses.json](app/prompts/vadf_reponses.json): Templated responses

**Storefront UI:**
- [extensions/chat-bubble/blocks/chat-interface.liquid](extensions/chat-bubble/blocks/chat-interface.liquid): Theme extension UI
- [extensions/chat-bubble/assets/chat.js](extensions/chat-bubble/assets/chat.js): Frontend logic
