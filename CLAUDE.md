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

The endpoint supports two modes:
- **Standard Claude mode**: Uses Claude API with MCP tools for Shopify operations
- **VADF mode** (`promptType: 'vadfAssistant'`): Custom intent-based responses for specific business logic (professional account management, password reset, etc.)

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
- Intent matcher: Detects user intents (account activation, password reset, support escalation)
- Response manager: Generates templated responses based on detected intent
- Customer account checker: Validates professional customer status

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

Customer Account API operations require OAuth:
1. Tool use triggers 401 → Backend generates auth URL with PKCE
2. Customer redirects to Shopify OAuth consent screen
3. Callback handler exchanges code for access token
4. Token stored in database, associated with conversation ID
5. Subsequent tool calls use stored token

See `app/auth.server.js` and `app/routes/auth.callback.jsx`.

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

Available tools are discovered dynamically on each chat session:
- **Storefront tools**: `search_shop_catalog`, `get_cart`, `update_cart`, `search_shop_policies_and_faqs`
- **Customer tools**: `get_most_recent_order_status`, `get_order_status`, etc.

Tools are invoked during Claude's response generation when needed to answer user queries.

### VADF Custom Mode

When `promptType: 'vadfAssistant'`, the system bypasses Claude and uses rule-based intent detection:
- Detects intents like "activation_compte", "mot_de_passe_oublie", "mise_a_jour_infos_entreprise"
- Checks customer account status via custom logic
- Returns templated responses from `app/prompts/vadf_reponses.json`
- Triggers support escalation for non-professional accounts

This mode is for specialized business workflows requiring deterministic responses.

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

## Key Files to Understand

- **[app/routes/chat.jsx](app/routes/chat.jsx)**: Main chat logic and session orchestration
- **[app/mcp-client.js](app/mcp-client.js)**: MCP protocol implementation
- **[app/services/claude.server.js](app/services/claude.server.js)**: Claude API integration
- **[app/db.server.js](app/db.server.js)**: Database operations
- **[prisma/schema.prisma](prisma/schema.prisma)**: Data model
- **[shopify.app.toml](shopify.app.toml)**: App configuration and scopes
