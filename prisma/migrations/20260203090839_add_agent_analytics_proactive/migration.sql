-- CreateTable
CREATE TABLE "ConversationContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "companyName" TEXT,
    "accountStatus" TEXT,
    "lastIntent" TEXT,
    "extractedEntities" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "shopId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConversationOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "shopId" TEXT,
    "outcome" TEXT NOT NULL,
    "sentiment" TEXT,
    "sentimentScore" REAL,
    "resolutionTime" INTEGER,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "toolsUsed" TEXT,
    "intentsDetected" TEXT,
    "aiConfidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProactiveMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "customerEmail" TEXT,
    "conversationId" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerData" TEXT,
    "messageContent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledFor" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProactiveTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "triggerType" TEXT NOT NULL,
    "templateText" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationContext_conversationId_key" ON "ConversationContext"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationContext_conversationId_idx" ON "ConversationContext"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationContext_customerEmail_idx" ON "ConversationContext"("customerEmail");

-- CreateIndex
CREATE INDEX "Quote_conversationId_idx" ON "Quote"("conversationId");

-- CreateIndex
CREATE INDEX "Quote_customerEmail_idx" ON "Quote"("customerEmail");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_conversationId_idx" ON "AnalyticsEvent"("conversationId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_idx" ON "AnalyticsEvent"("eventType");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shopId_idx" ON "AnalyticsEvent"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationOutcome_conversationId_key" ON "ConversationOutcome"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationOutcome_conversationId_idx" ON "ConversationOutcome"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationOutcome_outcome_idx" ON "ConversationOutcome"("outcome");

-- CreateIndex
CREATE INDEX "ConversationOutcome_sentiment_idx" ON "ConversationOutcome"("sentiment");

-- CreateIndex
CREATE INDEX "ConversationOutcome_createdAt_idx" ON "ConversationOutcome"("createdAt");

-- CreateIndex
CREATE INDEX "ConversationOutcome_shopId_idx" ON "ConversationOutcome"("shopId");

-- CreateIndex
CREATE INDEX "ProactiveMessage_shopId_idx" ON "ProactiveMessage"("shopId");

-- CreateIndex
CREATE INDEX "ProactiveMessage_status_idx" ON "ProactiveMessage"("status");

-- CreateIndex
CREATE INDEX "ProactiveMessage_scheduledFor_idx" ON "ProactiveMessage"("scheduledFor");

-- CreateIndex
CREATE INDEX "ProactiveMessage_customerEmail_idx" ON "ProactiveMessage"("customerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "ProactiveTemplate_triggerType_key" ON "ProactiveTemplate"("triggerType");
