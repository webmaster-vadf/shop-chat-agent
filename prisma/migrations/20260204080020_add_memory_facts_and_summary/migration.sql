-- CreateTable
CREATE TABLE "MemoryFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "shopId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL,
    "source" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MemoryFact_conversationId_idx" ON "MemoryFact"("conversationId");

-- CreateIndex
CREATE INDEX "MemoryFact_key_idx" ON "MemoryFact"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSummary_conversationId_key" ON "ConversationSummary"("conversationId");
