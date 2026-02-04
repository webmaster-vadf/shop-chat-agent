-- CreateIndex
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "Feedback_shopId_idx" ON "Feedback"("shopId");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryFact_conversationId_key_key" ON "MemoryFact"("conversationId", "key");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
