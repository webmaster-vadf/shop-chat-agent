# Plan d'Amelioration — Backlog + Tickets + Prisma (Markdown)

## Backlog priorise (S/M/L)

### Foundation
- [x] **S** Centraliser la gestion du contexte (`ContextManager`)
- [x] **M** Ajouter memoire long-terme (facts + resume)
- [x] **S** Etendre `scripts/test-100-conversations.js` (routing/outcomes/tools)

### Orchestration
- [x] **S** Log de la raison de routage + confiance
- [x] **M** Routage hybride (intent + keywords + fallback) avec score

### Learning
- [x] **M** Systeme de feedback (UI + stockage + analytics)
- [x] **M** A/B testing (assignation stable + exposure events)
- [x] **M** Rapport de patterns (script + export)

### Advanced
- [x] **M** Prediction conversion (heuristique)
- [x] **S** Dashboard analytics enrichi (A/B + feedback + agents)

---

## Tickets detailles

### 1- ContextManager centralise ✅
- **Taille**: S
- **Objectif**: unifier la logique de contexte (load/merge/save/TTL)
- **Fichiers**: `app/services/context-manager.server.js`, `app/routes/chat.jsx`, `app/services/claude.server.js`, `app/db.server.js`
- **AC**: 1 appel unique pour charger/mettre a jour le contexte; aucune regression sur la route chat

### 2- Memoire long-terme (facts + resume) ✅
- **Taille**: M
- **Objectif**: persister les faits utiles + resume conversation
- **Fichiers**: `app/services/context-manager.server.js`, `app/routes/chat.jsx`, `app/services/claude.server.js`, `app/db.server.js`, `prisma/schema.prisma`
- **AC**: facts persistants recuperes et injectes dans le system prompt; resume auto mis a jour toutes les N interactions

### 3- Tests 100 conversations etendus ✅
- **Taille**: S
- **Objectif**: couvrir routing + outcomes + tool usage
- **Fichiers**: `scripts/test-100-conversations.js`
- **AC**: >= 10 tests par agent + validation `routingReason` et `tool_used`

### 4- Log routage + confiance ✅
- **Taille**: S
- **Objectif**: stocker `routingReason` et score confiance
- **Fichiers**: `app/agents/orchestrator.server.js`, `app/services/analytics.server.js`, `app/routes/chat.jsx`
- **AC**: event `routing_selected` enregistre pour chaque tour

### 5- Routage hybride avec score ✅
- **Taille**: M
- **Objectif**: score composite (intent/keywords/context)
- **Fichiers**: `app/agents/orchestrator.server.js`
- **AC**: cas ambigus -> fallback logique; score expose dans analytics

### 6- Feedback utilisateur (UI + API + DB) ✅
- **Taille**: M
- **Objectif**: thumbs up/down + commentaire optionnel
- **Fichiers**: `extensions/chat-bubble/assets/chat.js`, `extensions/chat-bubble/assets/chat.css`, `app/routes/api.feedback.jsx`, `app/db.server.js`, `prisma/schema.prisma`
- **AC**: feedback lie a `messageId` et `conversationId`, exportable
- **Implementation**: boutons thumbs up/down SVG dans le widget chat, endpoint POST `/api/feedback`, modele Feedback avec indexes (conversationId, rating, shopId, createdAt)

### 7- A/B testing (assignation stable) ✅
- **Taille**: M
- **Objectif**: assignation par conversationId + exposure events + configs variant
- **Fichiers**: `app/services/experiments.server.js`, `app/routes/chat.jsx`, `app/services/analytics.server.js`, `prisma/schema.prisma`
- **AC**: variante deterministe, logs `experiment_exposure`
- **Implementation**: hash djb2 deterministe, selection ponderee par bucket, assignation idempotente (@@unique), tracking `experiment_exposure` dans analytics, 3 modeles Prisma (Experiment, ExperimentVariant, ExperimentAssignment)

### 8- Reporting de patterns ✅
- **Taille**: M
- **Objectif**: rapport hebdo (intents, erreurs, echecs outils)
- **Fichiers**: `app/services/analytics.server.js`, `scripts/generate-weekly-report.js`
- **AC**: export JSON/CSV + top 5 problemes
- **Implementation**: `getWeeklyReport()` dans analytics.server.js, script CLI standalone (ESM) avec args `--days`, `--shop`, `--format`, detection automatique de 6 types de problemes avec severite (high/medium/low), export dans `reports/`

### 9- Prediction conversion (heuristique) ✅
- **Taille**: M
- **Objectif**: score conversion base sur events (devis, panier, checkout)
- **Fichiers**: `app/services/analytics.server.js`, `app/routes/chat.jsx`, `app/db.server.js`, `prisma/schema.prisma`
- **AC**: score persistant dans `ConversationOutcome`
- **Implementation**: `computeConversionScore()` heuristique 0.0-1.0 (product search +0.10, cart +0.25, devis +0.20, tarifs +0.10, commander +0.15), calcul non-bloquant apres chaque tour, champ `conversionScore` dans ConversationOutcome

### 10- Dashboard enrichi (A/B + feedback + agents) ✅
- **Taille**: S
- **Objectif**: A/B, feedback rate, performance agents
- **Fichiers**: `app/routes/app.dashboard.jsx`, `app/services/analytics.server.js`
- **AC**: sections visibles + export CSV
- **Implementation**: KPI header etendu a 5 (+ score conversion), section Feedback dans Vue d'ensemble (satisfaction, positifs/negatifs, commentaires negatifs recents), section Performance agents dans Performance IA (routages, confiance, ambiguite, ecart, distribution par agent/methode), section A/B Testing (expositions par variante et experience)

---

## Changements Prisma (implementes)

Tous les modeles ci-dessous sont implementes dans `prisma/schema.prisma` avec les relations et indexes optimises.

### Modeles ajoutes (Tickets 2, 6, 7, 9)

| Modele | Ticket | Champs cles | Indexes |
|--------|--------|-------------|---------|
| **MemoryFact** | T2 | conversationId, key, value, confidence, source | `@@unique([conversationId, key])`, conversationId, key |
| **ConversationSummary** | T2 | conversationId (unique), summary, tokenCount | conversationId (unique) |
| **Feedback** | T6 | conversationId, messageId, shopId, rating, comment | conversationId, rating, shopId, createdAt |
| **Experiment** | T7 | key (unique), name, status, startAt, endAt | key (unique), relations → variants, assignments |
| **ExperimentVariant** | T7 | experimentId, key, name, weight, configJson | experimentId, relation → Experiment (cascade) |
| **ExperimentAssignment** | T7 | experimentId, variantId, conversationId, shopId | `@@unique([experimentId, conversationId])`, conversationId, variantId |

### Champs ajoutes (Tickets 4, 9)

| Modele | Champ | Ticket | Description |
|--------|-------|--------|-------------|
| **ConversationOutcome** | `aiConfidence Float?` | T4 | Confiance du routage |
| **ConversationOutcome** | `conversionScore Float?` | T9 | Score heuristique 0.0-1.0 |

### Indexes ajoutes (optimisation)

| Modele | Index | Raison |
|--------|-------|--------|
| **Conversation** | `@@index([createdAt])` | Requetes analytics par date |
| **Conversation** | `@@index([updatedAt])` | orderBy dans getRecentConversations |
| **Message** | `@@index([createdAt])` | Requetes analytics par date |
| **Feedback** | `@@index([shopId])` | Filtrage par shop dans getFeedbackSummary |
| **Feedback** | `@@index([createdAt])` | Filtrage par date dans analytics |
| **MemoryFact** | `@@unique([conversationId, key])` | Upsert atomique, prevention doublons |

### Migrations

```
20260203_add_memory_models          # MemoryFact + ConversationSummary
20260203_add_feedback               # Feedback
20260204_add_experiments            # Experiment + ExperimentVariant + ExperimentAssignment
20260204_add_conversion_score       # ConversationOutcome.conversionScore
20260204_improve_indexes            # Indexes sur Conversation, Message, Feedback, MemoryFact
```
