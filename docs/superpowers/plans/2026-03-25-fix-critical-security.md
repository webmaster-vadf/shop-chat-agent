# Fix Critical Security Issues - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger les 4 problèmes de sécurité critiques identifiés lors de l'audit de l'application shop-chat-agent.

**Architecture:** Modifications ciblées sur la route `/chat` (CORS + validation + rate limiting) et création d'un fichier `.env.example` pour documenter les variables d'environnement. Pas de refactoring global — corrections minimales et précises.

**Tech Stack:** Remix v2, Node.js, in-memory rate limiting (pas de dépendance externe)

---

## Fichiers modifiés / créés

| Action | Fichier | Raison |
|--------|---------|--------|
| Modify | `app/routes/chat.jsx` | Fix CORS, ajout validation messages, ajout rate limiting |
| Create | `.env.example` | Template des variables d'environnement |

---

### Task 1 : Créer `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1 : Créer le fichier `.env.example`**

```bash
# API Keys - Anthropic/Claude
ANTHROPIC_API_KEY=sk-ant-api03-XXXXX

# OAuth et Redirects
REDIRECT_URL=https://localhost:3458/auth/callback

# Configuration Shopify App
SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_CLIENT_ID=your_shopify_client_id_here
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_API_SECRET=your_api_secret_here

# Tokens d'accès Shopify
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your_storefront_token_here
SHOPIFY_ACCESS_TOKEN=your_admin_access_token_here

# Scopes
SHOPIFY_SCOPES=customer_read_customers,customer_read_orders,customer_read_store_credit_account_transactions,customer_read_store_credit_accounts,unauthenticated_read_product_listings
SHOPIFY_CHAT_BUBBLE_ID=your_chat_bubble_extension_id
```

- [ ] **Step 2 : Vérifier que `.env` est dans `.gitignore`**

```bash
grep "^\.env$" .gitignore
```
Expected: `.env`

- [ ] **Step 3 : Commit**

```bash
git add .env.example
git commit -m "docs: add .env.example template"
```

---

### Task 2 : Fix CORS — supprimer le wildcard avec credentials

**Files:**
- Modify: `app/routes/chat.jsx:340-370`

**Contexte :** `getCorsHeaders()` et `getSseHeaders()` retournent `"*"` quand pas d'Origin header, puis l'associent à `Access-Control-Allow-Credentials: true`. C'est une violation des specs CORS — les navigateurs refusent cette combinaison. En plus, cela permet à n'importe quel domaine d'envoyer des requêtes avec credentials.

**Fix :** Définir une liste de domaines autorisés via variable d'environnement (`ALLOWED_ORIGINS`). Si l'origin de la requête n'est pas dans la liste, ne pas retourner le header `Access-Control-Allow-Credentials`.

- [ ] **Step 1 : Lire la fonction `getCorsHeaders` et `getSseHeaders` actuelles**

Lire `app/routes/chat.jsx` lignes 340-370 pour confirmer le code.

- [ ] **Step 2 : Remplacer `getCorsHeaders`**

Remplacer (lignes 340-351) :
```js
function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}
```

Par :
```js
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

function getAllowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  // In development with no ALLOWED_ORIGINS configured, allow all origins
  // In production, only allow explicitly listed origins
  if (ALLOWED_ORIGINS.length === 0) {
    return process.env.NODE_ENV === "development" ? origin : null;
  }
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function getCorsHeaders(request) {
  const allowedOrigin = getAllowedOrigin(request);
  const requestHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type, Accept";

  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders,
    "Access-Control-Max-Age": "86400"
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  }

  return headers;
}
```

- [ ] **Step 3 : Remplacer `getSseHeaders`**

Remplacer (lignes 358-370) :
```js
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
```

Par :
```js
function getSseHeaders(request) {
  const allowedOrigin = getAllowedOrigin(request);

  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
    "Access-Control-Allow-Headers": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  }

  return headers;
}
```

- [ ] **Step 4 : Ajouter `ALLOWED_ORIGINS` dans `.env.example`**

Ajouter à la fin de `.env.example` :
```
# CORS - liste des origines autorisées (séparées par des virgules)
# Laisser vide en dev pour autoriser toutes les origines
ALLOWED_ORIGINS=https://your-store.myshopify.com
```

- [ ] **Step 5 : Commit**

```bash
git add app/routes/chat.jsx .env.example
git commit -m "fix: correct CORS configuration to prevent wildcard+credentials violation"
```

---

### Task 3 : Ajouter validation des messages

**Files:**
- Modify: `app/routes/chat.jsx:73-112` (fonction `handleChatRequest`)

**Contexte :** Les messages utilisateurs ne sont pas validés en taille. Un message de 10MB serait envoyé directement à Claude, ce qui est coûteux et potentiellement dangereux.

- [ ] **Step 1 : Ajouter les constantes dans `config.server.js`**

Dans `app/services/config.server.js`, modifier la section `api` pour ajouter `maxMessageLength` :

```js
  api: {
    defaultModel: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    defaultPromptType: 'standardAssistant',
    maxMessageLength: 4000,  // ~1000 tokens
  },
```

Et dans `errorMessages`, ajouter `messageTooLong` après `rateLimitDetails` :

```js
  errorMessages: {
    missingMessage: "Message is required",
    apiUnsupported: "This endpoint only supports server-sent events (SSE) requests or history requests.",
    authFailed: "Authentication failed with Claude API",
    apiKeyError: "Please check your API key in environment variables",
    rateLimitExceeded: "Rate limit exceeded",
    rateLimitDetails: "Please try again later",
    messageTooLong: "Message too long (max 4000 characters)",
    genericError: "Failed to get response from Claude"
  },
```

- [ ] **Step 2 : Ajouter la validation dans `handleChatRequest`**

Dans `app/routes/chat.jsx`, après le check `if (!userMessage)` (ligne 80), ajouter :

```js
// Validate message length
if (typeof userMessage !== 'string' || userMessage.length > AppConfig.api.maxMessageLength) {
  return new Response(
    JSON.stringify({ error: AppConfig.errorMessages.messageTooLong }),
    { status: 400, headers: getSseHeaders(request) }
  );
}
```

- [ ] **Step 3 : Commit**

```bash
git add app/routes/chat.jsx app/services/config.server.js
git commit -m "fix: add message length validation to prevent oversized payloads"
```

---

### Task 4 : Ajouter rate limiting in-memory

**Files:**
- Modify: `app/routes/chat.jsx` (ajouter en haut du fichier + dans `handleChatRequest`)

**Contexte :** L'endpoint `/chat` n'a aucune protection contre les requêtes abusives. Un attaquant peut envoyer des milliers de requêtes simultanées, engendrant des coûts Claude API massifs.

**Approche :** Rate limiter simple en mémoire (Map) — 20 requêtes par minute par IP. Pas de dépendance externe, adapté pour un serveur Node.js single-instance.

- [ ] **Step 1 : Ajouter le rate limiter en haut de `chat.jsx`**

Ajouter après les imports (ligne ~13), avant la fonction `loader` :

```js
// In-memory rate limiter: max 20 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}
```

- [ ] **Step 2 : Appliquer le rate limit dans `handleChatRequest`**

Dans `handleChatRequest`, au début de la fonction (avant le `body = await request.json()`), ajouter :

```js
// Rate limiting check
const clientIp = getClientIp(request);
if (!checkRateLimit(clientIp)) {
  return new Response(
    JSON.stringify({ error: AppConfig.errorMessages.rateLimitExceeded }),
    { status: 429, headers: { ...getSseHeaders(request), "Retry-After": "60" } }
  );
}
```

- [ ] **Step 3 : Ajouter le nettoyage périodique de la Map** (évite les memory leaks)

Ajouter après la définition du `rateLimitMap` :

```js
// Clean up old entries every 5 minutes to prevent memory leak.
// Guard against duplicate intervals during Remix hot-reload in development.
if (typeof globalThis.__rateLimitCleanupRegistered === 'undefined') {
  globalThis.__rateLimitCleanupRegistered = true;
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
}
```

- [ ] **Step 4 : Tester manuellement**

Démarrer l'app en dev (`npm run dev`) et vérifier que :
- Les requêtes normales passent (status 200)
- Après 20 requêtes rapides, la 21ème retourne 429
- Le header `Retry-After: 60` est présent

- [ ] **Step 5 : Commit**

```bash
git add app/routes/chat.jsx
git commit -m "fix: add in-memory rate limiting (20 req/min per IP) on chat endpoint"
```

---

## Récapitulatif des commits

```
docs: add .env.example template
fix: correct CORS configuration to prevent wildcard+credentials violation
fix: add message length validation to prevent oversized payloads
fix: add in-memory rate limiting (20 req/min per IP) on chat endpoint
```
