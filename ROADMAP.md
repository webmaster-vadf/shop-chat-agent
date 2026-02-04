# Plan d'Amelioration — Backlog + Tickets + Prisma (Markdown)

## Backlog priorise (S/M/L)

### Foundation
- **S** Centraliser la gestion du contexte (`ContextManager`)
- **M** Ajouter memoire long-terme (facts + resume)
- **S** Etendre `scripts/test-100-conversations.js` (routing/outcomes/tools)

### Orchestration
- **S** Log de la raison de routage + confiance
- **M** Routage hybride (intent + keywords + fallback) avec score

### Learning
- **M** Systeme de feedback (UI + stockage + analytics)
- **M** A/B testing (assignation stable + exposure events)
- **M** Rapport de patterns (script + export)

### Advanced
- **M** Prediction conversion (heuristique)
- **S** Dashboard analytics enrichi (A/B + feedback + agents)

---

## Tickets detailles

### 1- ContextManager centralise
- **Taille**: S
- **Objectif**: unifier la logique de contexte (load/merge/save/TTL)
- **Implementation**: service dedie + integration chat
- **Fichiers**: `app/services/context-manager.server.js`, `app/routes/chat.jsx`, `app/services/claude.server.js`, `app/db.server.js`
- **AC**: 1 appel unique pour charger/mettre a jour le contexte; aucune regression sur la route chat

### 2- Memoire long-terme (facts + resume)
- **Taille**: M
- **Objectif**: persister les faits utiles + resume conversation
- **Fichiers**: `app/services/context-manager.server.js`, `app/routes/chat.jsx`, `app/services/claude.server.js`, `app/db.server.js`, `prisma/schema.prisma`
- **AC**: facts persistants recuperes et injectes dans le system prompt; resume auto mis a jour toutes les N interactions

### 3- Tests 100 conversations etendus
- **Taille**: S
- **Objectif**: couvrir routing + outcomes + tool usage
- **Fichiers**: `scripts/test-100-conversations.js`
- **AC**: >= 10 tests par agent + validation `routingReason` et `tool_used`

### 4- Log routage + confiance
- **Taille**: S
- **Objectif**: stocker `routingReason` et score confiance
- **Fichiers**: `app/agents/orchestrator.server.js`, `app/services/analytics.server.js`, `app/routes/chat.jsx`
- **AC**: event `routing_selected` enregistre pour chaque tour

### 5- Routage hybride avec score
- **Taille**: M
- **Objectif**: score composite (intent/keywords/context)
- **Fichiers**: `app/agents/orchestrator.server.js`
- **AC**: cas ambigus -> fallback logique; score expose dans analytics

### 6- Feedback utilisateur (UI + API + DB)
- **Taille**: M
- **Objectif**: thumbs up/down + commentaire optionnel
- **Fichiers**: `extensions/chat-bubble/...`, `app/routes/feedback.jsx`, `app/services/analytics.server.js`, `app/db.server.js`, `prisma/schema.prisma`
- **AC**: feedback lie a `messageId` et `conversationId`, exportable

### 7- A/B testing (assignation stable)
- **Taille**: M
- **Objectif**: assignation par conversationId + exposure events + configs variant
- **Fichiers**: `app/services/experiments.server.js`, `app/routes/chat.jsx`, `app/services/analytics.server.js`, `prisma/schema.prisma`
- **AC**: variante deterministe, logs `experiment_exposure`

### 8- Reporting de patterns
- **Taille**: M
- **Objectif**: rapport hebdo (intents, erreurs, echecs outils)
- **Fichiers**: `app/services/analytics.server.js`, `scripts/generate-weekly-report.js`
- **AC**: export JSON/CSV + top 5 problemes

### 9- Prediction conversion (heuristique)
- **Taille**: M
- **Objectif**: score conversion base sur events (devis, panier, checkout)
- **Fichiers**: `app/services/analytics.server.js`, `app/routes/chat.jsx`, `prisma/schema.prisma`
- **AC**: score persistant dans `ConversationOutcome`

### 10- Dashboard enrichi (A/B + feedback + agents)
- **Taille**: S
- **Objectif**: A/B, feedback rate, performance agents
- **Fichiers**: `app/routes/app.dashboard.jsx`, `app/services/analytics.server.js`
- **AC**: sections visibles + export CSV

---

## Changements Prisma (proposes)

```prisma
model MemoryFact {
  id             String   @id @default(cuid())
  conversationId String
  shopId         String?
  key            String
  value          String
  confidence     Float?
  source         String?  // "user" | "tool" | "inference"
  lastSeenAt     DateTime @default(now())

  @@index([conversationId])
  @@index([key])
}

model ConversationSummary {
  id             String   @id @default(cuid())
  conversationId String   @unique
  summary        String
  tokenCount     Int?
  updatedAt      DateTime @updatedAt
}

model Feedback {
  id             String   @id @default(cuid())
  conversationId String
  messageId      String?
  shopId         String?
  rating         String   // "up" | "down"
  comment        String?
  createdAt      DateTime @default(now())

  @@index([conversationId])
}

model Experiment {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  status      String   // "draft" | "running" | "paused" | "ended"
  description String?
  startAt     DateTime?
  endAt       DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model ExperimentVariant {
  id           String   @id @default(cuid())
  experimentId String
  key          String
  name         String
  weight       Float    @default(0.5)
  configJson   String?

  @@index([experimentId])
}

model ExperimentAssignment {
  id             String   @id @default(cuid())
  experimentId   String
  variantId      String
  conversationId String
  shopId         String?
  assignedAt     DateTime @default(now())

  @@unique([experimentId, conversationId])
}
```
