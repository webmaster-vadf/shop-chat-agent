import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

/**
 * Store a code verifier for PKCE authentication
 * @param {string} state - The state parameter used in OAuth flow
 * @param {string} verifier - The code verifier to store
 * @returns {Promise<Object>} - The saved code verifier object
 */
export async function storeCodeVerifier(state, verifier) {
  // Calculate expiration date (10 minutes from now)
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);

  try {
    return await prisma.codeVerifier.create({
      data: {
        id: `cv_${Date.now()}`,
        state,
        verifier,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Error storing code verifier:', error);
    throw error;
  }
}

/**
 * Get a code verifier by state parameter
 * @param {string} state - The state parameter used in OAuth flow
 * @returns {Promise<Object|null>} - The code verifier object or null if not found
 */
export async function getCodeVerifier(state) {
  try {
    const verifier = await prisma.codeVerifier.findFirst({
      where: {
        state,
        expiresAt: {
          gt: new Date()
        }
      }
    });

    if (verifier) {
      // Delete it after retrieval to prevent reuse
      await prisma.codeVerifier.delete({
        where: {
          id: verifier.id
        }
      });
    }

    return verifier;
  } catch (error) {
    console.error('Error retrieving code verifier:', error);
    return null;
  }
}

/**
 * Store a customer access token in the database
 * @param {string} conversationId - The conversation ID to associate with the token
 * @param {string} accessToken - The access token to store
 * @param {Date} expiresAt - When the token expires
 * @returns {Promise<Object>} - The saved customer token
 */
export async function storeCustomerToken(conversationId, accessToken, expiresAt) {
  try {
    // Check if a token already exists for this conversation
    const existingToken = await prisma.customerToken.findFirst({
      where: { conversationId }
    });

    if (existingToken) {
      // Update existing token
      return await prisma.customerToken.update({
        where: { id: existingToken.id },
        data: {
          accessToken,
          expiresAt,
          updatedAt: new Date()
        }
      });
    }

    // Create a new token record
    return await prisma.customerToken.create({
      data: {
        id: `ct_${Date.now()}`,
        conversationId,
        accessToken,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer token:', error);
    throw error;
  }
}

/**
 * Get a customer access token by conversation ID
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object|null>} - The customer token or null if not found/expired
 */
export async function getCustomerToken(conversationId) {
  try {
    const token = await prisma.customerToken.findFirst({
      where: {
        conversationId,
        expiresAt: {
          gt: new Date() // Only return non-expired tokens
        }
      }
    });

    return token;
  } catch (error) {
    console.error('Error retrieving customer token:', error);
    return null;
  }
}

/**
 * Create or update a conversation in the database
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Object>} - The created or updated conversation
 */
export async function createOrUpdateConversation(conversationId) {
  try {
    const existingConversation = await prisma.conversation.findUnique({
      where: { id: conversationId }
    });

    if (existingConversation) {
      return await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date()
        }
      });
    }

    return await prisma.conversation.create({
      data: {
        id: conversationId
      }
    });
  } catch (error) {
    console.error('Error creating/updating conversation:', error);
    throw error;
  }
}

/**
 * Save a message to the database
 * @param {string} conversationId - The conversation ID
 * @param {string} role - The message role (user or assistant)
 * @param {string} content - The message content
 * @returns {Promise<Object>} - The saved message
 */
export async function saveMessage(conversationId, role, content) {
  try {
    // Ensure the conversation exists
    await createOrUpdateConversation(conversationId);

    // Create the message
    return await prisma.message.create({
      data: {
        conversationId,
        role,
        content
      }
    });
  } catch (error) {
    console.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} - Array of messages in the conversation
 */
export async function getConversationHistory(conversationId) {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' }
    });

    return messages;
  } catch (error) {
    console.error('Error retrieving conversation history:', error);
    return [];
  }
}

/**
 * Store customer account URL for a conversation
 * @param {string} conversationId - The conversation ID
 * @param {string} url - The customer account URL
 * @returns {Promise<Object>} - The saved URL object
 */
export async function storeCustomerAccountUrl(conversationId, url) {
  try {
    return await prisma.customerAccountUrl.upsert({
      where: { conversationId },
      update: {
        url,
        updatedAt: new Date()
      },
      create: {
        conversationId,
        url,
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error storing customer account URL:', error);
    throw error;
  }
}

/**
 * Get customer account URL for a conversation
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string|null>} - The customer account URL or null if not found
 */
export async function getCustomerAccountUrl(conversationId) {
  try {
    const record = await prisma.customerAccountUrl.findUnique({
      where: { conversationId }
    });

    return record?.url || null;
  } catch (error) {
    console.error('Error retrieving customer account URL:', error);
    return null;
  }
}

/**
 * Get chat statistics for reporting
 * @param {Date} startDate - Start date for the report
 * @param {Date} endDate - End date for the report
 * @returns {Promise<Object>} - Statistics object
 */
export async function getChatStats(startDate, endDate) {
  try {
    // Total conversations in period
    const conversations = await prisma.conversation.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        messages: true
      }
    });

    // Total messages
    const totalMessages = await prisma.message.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    // User messages only
    const userMessages = await prisma.message.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        role: 'user'
      }
    });

    // Get all user messages for analysis
    const allUserMessages = await prisma.message.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        role: 'user'
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      totalConversations: conversations.length,
      totalMessages,
      userMessages,
      assistantMessages: totalMessages - userMessages,
      conversations,
      allUserMessages
    };
  } catch (error) {
    console.error('Error getting chat stats:', error);
    return {
      totalConversations: 0,
      totalMessages: 0,
      userMessages: 0,
      assistantMessages: 0,
      conversations: [],
      allUserMessages: []
    };
  }
}

/**
 * Get recent conversations with messages
 * @param {number} limit - Number of conversations to retrieve
 * @returns {Promise<Array>} - Array of conversations with messages
 */
export async function getRecentConversations(limit = 50) {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    return conversations;
  } catch (error) {
    console.error('Error getting recent conversations:', error);
    return [];
  }
}

// ============================================================
// Phase 1D: Conversation Context & Quote Management
// ============================================================

/**
 * Save or update conversation context
 * @param {string} conversationId
 * @param {object} contextData - Partial context data to upsert
 * @returns {Promise<object>}
 */
export async function saveConversationContext(conversationId, contextData) {
  try {
    return await prisma.conversationContext.upsert({
      where: { conversationId },
      update: {
        ...contextData,
        updatedAt: new Date()
      },
      create: {
        conversationId,
        ...contextData
      }
    });
  } catch (error) {
    console.error('Error saving conversation context:', error);
    throw error;
  }
}

/**
 * Get conversation context
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
export async function getConversationContext(conversationId) {
  try {
    return await prisma.conversationContext.findUnique({
      where: { conversationId }
    });
  } catch (error) {
    console.error('Error getting conversation context:', error);
    return null;
  }
}

/**
 * Update conversation context partially (merge with existing)
 * @param {string} conversationId
 * @param {object} updates - Fields to update
 * @returns {Promise<object>}
 */
export async function updateConversationContext(conversationId, updates) {
  try {
    const existing = await prisma.conversationContext.findUnique({
      where: { conversationId }
    });

    if (!existing) {
      return await saveConversationContext(conversationId, updates);
    }

    // Merge extracted entities
    if (updates.extractedEntities && existing.extractedEntities) {
      try {
        const existingEntities = JSON.parse(existing.extractedEntities);
        const newEntities = typeof updates.extractedEntities === 'string'
          ? JSON.parse(updates.extractedEntities)
          : updates.extractedEntities;
        updates.extractedEntities = JSON.stringify({ ...existingEntities, ...newEntities });
      } catch (e) {
        // If parse fails, use the new value as-is
      }
    }

    return await prisma.conversationContext.update({
      where: { conversationId },
      data: {
        ...updates,
        messageCount: { increment: 1 },
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error updating conversation context:', error);
    throw error;
  }
}

/**
 * Create a new quote
 * @param {object} quoteData
 * @returns {Promise<object>}
 */
export async function createQuote(quoteData) {
  try {
    return await prisma.quote.create({
      data: quoteData
    });
  } catch (error) {
    console.error('Error creating quote:', error);
    throw error;
  }
}

/**
 * Get quotes by conversation ID
 * @param {string} conversationId
 * @returns {Promise<Array>}
 */
export async function getQuotesByConversation(conversationId) {
  try {
    return await prisma.quote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error('Error getting quotes:', error);
    return [];
  }
}

/**
 * Get quotes by customer email
 * @param {string} email
 * @returns {Promise<Array>}
 */
export async function getQuotesByEmail(email) {
  try {
    return await prisma.quote.findMany({
      where: { customerEmail: email },
      orderBy: { createdAt: 'desc' }
    });
  } catch (error) {
    console.error('Error getting quotes by email:', error);
    return [];
  }
}

// ============================================================
// Phase 2: Analytics
// ============================================================

/**
 * Track an analytics event (fire-and-forget)
 * @param {string} conversationId
 * @param {string} shopId
 * @param {string} eventType
 * @param {object} eventData
 */
export async function trackEvent(conversationId, shopId, eventType, eventData = null) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        conversationId,
        shopId,
        eventType,
        eventData: eventData ? JSON.stringify(eventData) : null
      }
    });
  } catch (error) {
    // Non-blocking: just log the error
    console.error('Error tracking event:', error.message);
  }
}

/**
 * Update or create conversation outcome
 * @param {string} conversationId
 * @param {object} outcomeData
 */
export async function upsertConversationOutcome(conversationId, outcomeData) {
  try {
    return await prisma.conversationOutcome.upsert({
      where: { conversationId },
      update: { ...outcomeData, updatedAt: new Date() },
      create: { conversationId, ...outcomeData }
    });
  } catch (error) {
    console.error('Error upserting conversation outcome:', error.message);
  }
}

/**
 * Get analytics summary for a date range
 * @param {string} shopId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<object>}
 */
export async function getAnalyticsSummary(shopId, startDate, endDate) {
  try {
    const dateFilter = {
      createdAt: { gte: startDate, lte: endDate },
      ...(shopId ? { shopId } : {})
    };

    const [totalEvents, outcomes, conversations] = await Promise.all([
      prisma.analyticsEvent.count({ where: dateFilter }),
      prisma.conversationOutcome.findMany({
        where: {
          ...dateFilter,
          conversationId: { not: undefined }
        }
      }),
      prisma.conversation.count({
        where: {
          createdAt: { gte: startDate, lte: endDate }
        }
      })
    ]);

    // Calculate outcome distribution
    const outcomeDistribution = {};
    const sentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
    let totalSentimentScore = 0;
    let sentimentCount = 0;

    outcomes.forEach(o => {
      outcomeDistribution[o.outcome] = (outcomeDistribution[o.outcome] || 0) + 1;
      if (o.sentiment) {
        sentimentDistribution[o.sentiment] = (sentimentDistribution[o.sentiment] || 0) + 1;
      }
      if (o.sentimentScore != null) {
        totalSentimentScore += o.sentimentScore;
        sentimentCount++;
      }
    });

    return {
      totalConversations: conversations,
      totalEvents,
      outcomeDistribution,
      sentimentDistribution,
      avgSentiment: sentimentCount > 0 ? totalSentimentScore / sentimentCount : null,
      resolutionRate: outcomes.length > 0
        ? (outcomeDistribution.resolved || 0) / outcomes.length
        : null,
      escalationRate: outcomes.length > 0
        ? (outcomeDistribution.escalated || 0) / outcomes.length
        : null
    };
  } catch (error) {
    console.error('Error getting analytics summary:', error);
    return null;
  }
}

/**
 * Get intent distribution for analytics
 * @param {string} shopId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<object>}
 */
export async function getIntentDistribution(shopId, startDate, endDate) {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        eventType: 'intent_detected',
        createdAt: { gte: startDate, lte: endDate },
        ...(shopId ? { shopId } : {})
      }
    });

    const distribution = {};
    events.forEach(e => {
      try {
        const data = JSON.parse(e.eventData);
        const intent = data.intent || 'unknown';
        distribution[intent] = (distribution[intent] || 0) + 1;
      } catch (err) {
        // skip malformed events
      }
    });

    return distribution;
  } catch (error) {
    console.error('Error getting intent distribution:', error);
    return {};
  }
}
