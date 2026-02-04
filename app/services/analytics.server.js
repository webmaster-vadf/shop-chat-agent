/**
 * Analytics Service
 * Centralized analytics queries for dashboard and export
 */
import prisma from "../db.server";
import { getFeedbackSummary } from "../db.server";

/**
 * Get comprehensive analytics summary for dashboard
 * @param {string} shopId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<object>}
 */
export async function getDashboardAnalytics(shopId, startDate, endDate) {
  const dateFilter = {
    createdAt: { gte: startDate, lte: endDate }
  };
  const shopFilter = shopId ? { shopId } : {};

  const [
    totalConversations,
    totalMessages,
    userMessageCount,
    outcomes,
    events,
    recentConversations,
    feedbackStats
  ] = await Promise.all([
    prisma.conversation.count({ where: dateFilter }),
    prisma.message.count({ where: dateFilter }),
    prisma.message.count({ where: { ...dateFilter, role: 'user' } }),
    prisma.conversationOutcome.findMany({
      where: { ...dateFilter, ...shopFilter }
    }),
    prisma.analyticsEvent.findMany({
      where: { ...dateFilter, ...shopFilter }
    }),
    prisma.conversation.findMany({
      where: dateFilter,
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    }),
    getFeedbackSummary(shopId, startDate, endDate)
  ]);

  // Outcome distribution
  const outcomeDistribution = {};
  const sentimentDistribution = { positive: 0, neutral: 0, negative: 0 };
  let totalSentimentScore = 0;
  let sentimentCount = 0;
  let totalResolutionTime = 0;
  let resolutionTimeCount = 0;

  outcomes.forEach(o => {
    outcomeDistribution[o.outcome] = (outcomeDistribution[o.outcome] || 0) + 1;
    if (o.sentiment) {
      sentimentDistribution[o.sentiment] = (sentimentDistribution[o.sentiment] || 0) + 1;
    }
    if (o.sentimentScore != null) {
      totalSentimentScore += o.sentimentScore;
      sentimentCount++;
    }
    if (o.resolutionTime != null) {
      totalResolutionTime += o.resolutionTime;
      resolutionTimeCount++;
    }
  });

  // Intent distribution from events
  const intentDistribution = {};
  const toolUsage = {};
  let vadfResponseCount = 0;
  let mcpFallbackCount = 0;
  let errorCount = 0;

  // Routing analytics
  const routingByAgent = {};
  const routingByMethod = {};
  let totalRoutingConfidence = 0;
  let routingCount = 0;
  let ambiguousCount = 0;
  let totalScoreGap = 0;
  let scoreGapCount = 0;

  // Experiment analytics
  const experimentExposures = {};

  events.forEach(e => {
    try {
      const data = e.eventData ? JSON.parse(e.eventData) : {};
      if (e.eventType === 'intent_detected') {
        const intent = data.intent || 'unknown';
        intentDistribution[intent] = (intentDistribution[intent] || 0) + 1;
        if (data.source?.startsWith('ai_') || data.source === 'regex') {
          vadfResponseCount++;
        }
        if (data.source === 'ai_fallback' || data.source === 'ai_generic') {
          mcpFallbackCount++;
        }
      }
      if (e.eventType === 'tool_used') {
        const tool = data.toolName || 'unknown';
        toolUsage[tool] = (toolUsage[tool] || 0) + 1;
      }
      if (e.eventType === 'turn_error') {
        errorCount++;
      }
      if (e.eventType === 'routing_selected') {
        const agent = data.agentType || 'unknown';
        const method = data.routingMethod || 'unknown';
        routingByAgent[agent] = (routingByAgent[agent] || 0) + 1;
        routingByMethod[method] = (routingByMethod[method] || 0) + 1;
        if (data.routingConfidence != null) {
          totalRoutingConfidence += data.routingConfidence;
          routingCount++;
        }
        if (data.isAmbiguous) {
          ambiguousCount++;
        }
        if (data.scoreGap != null) {
          totalScoreGap += data.scoreGap;
          scoreGapCount++;
        }
      }
      if (e.eventType === 'experiment_exposure') {
        const expKey = data.experimentKey || 'unknown';
        const varKey = data.variantKey || 'unknown';
        if (!experimentExposures[expKey]) experimentExposures[expKey] = {};
        experimentExposures[expKey][varKey] = (experimentExposures[expKey][varKey] || 0) + 1;
      }
    } catch (err) {
      // skip malformed events
    }
  });

  // Conversion funnel
  const totalOutcomes = outcomes.length;
  const resolved = outcomeDistribution.resolved || 0;
  const escalated = outcomeDistribution.escalated || 0;
  const converted = outcomeDistribution.converted || 0;
  const abandoned = outcomeDistribution.abandoned || 0;

  return {
    // KPIs
    kpis: {
      totalConversations,
      totalMessages,
      userMessages: userMessageCount,
      assistantMessages: totalMessages - userMessageCount,
      resolutionRate: totalOutcomes > 0 ? resolved / totalOutcomes : null,
      escalationRate: totalOutcomes > 0 ? escalated / totalOutcomes : null,
      conversionRate: totalOutcomes > 0 ? converted / totalOutcomes : null,
      avgSentiment: sentimentCount > 0 ? totalSentimentScore / sentimentCount : null,
      avgResolutionTime: resolutionTimeCount > 0
        ? Math.round(totalResolutionTime / resolutionTimeCount)
        : null
    },

    // Distributions
    outcomeDistribution,
    sentimentDistribution,
    intentDistribution,

    // AI performance
    aiPerformance: {
      vadfResponseCount,
      mcpFallbackCount,
      errorCount,
      totalClassifications: vadfResponseCount + mcpFallbackCount,
      vadfAccuracy: (vadfResponseCount + mcpFallbackCount) > 0
        ? vadfResponseCount / (vadfResponseCount + mcpFallbackCount)
        : null,
      toolUsage
    },

    // Agent routing analytics
    routing: {
      byAgent: routingByAgent,
      byMethod: routingByMethod,
      totalRoutings: routingCount,
      avgConfidence: routingCount > 0 ? totalRoutingConfidence / routingCount : null,
      ambiguousCount,
      ambiguousRate: routingCount > 0 ? ambiguousCount / routingCount : null,
      avgScoreGap: scoreGapCount > 0 ? totalScoreGap / scoreGapCount : null
    },

    // Conversion funnel
    funnel: {
      total: totalConversations,
      engaged: totalOutcomes,
      resolved,
      escalated,
      converted,
      abandoned
    },

    // User feedback
    feedback: feedbackStats,

    // Experiments
    experiments: {
      exposures: experimentExposures
    },

    // Recent conversations
    recentConversations: recentConversations.map(formatConversationForDashboard)
  };
}

/**
 * Get daily conversation trends for a date range
 * @param {string} shopId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
export async function getDailyTrends(shopId, startDate, endDate) {
  const conversations = await prisma.conversation.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate }
    },
    select: { createdAt: true }
  });

  const outcomes = await prisma.conversationOutcome.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      ...(shopId ? { shopId } : {})
    },
    select: { createdAt: true, outcome: true, sentiment: true }
  });

  // Group by day
  const dailyMap = {};
  conversations.forEach(c => {
    const day = c.createdAt.toISOString().split('T')[0];
    if (!dailyMap[day]) dailyMap[day] = { conversations: 0, resolved: 0, escalated: 0, positive: 0, negative: 0 };
    dailyMap[day].conversations++;
  });

  outcomes.forEach(o => {
    const day = o.createdAt.toISOString().split('T')[0];
    if (!dailyMap[day]) dailyMap[day] = { conversations: 0, resolved: 0, escalated: 0, positive: 0, negative: 0 };
    if (o.outcome === 'resolved') dailyMap[day].resolved++;
    if (o.outcome === 'escalated') dailyMap[day].escalated++;
    if (o.sentiment === 'positive') dailyMap[day].positive++;
    if (o.sentiment === 'negative') dailyMap[day].negative++;
  });

  return Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

/**
 * Get analytics data formatted for CSV export
 * @param {string} shopId
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
export async function getExportData(shopId, startDate, endDate) {
  const dateFilter = {
    createdAt: { gte: startDate, lte: endDate }
  };

  const [messages, outcomes, events] = await Promise.all([
    prisma.message.findMany({
      where: dateFilter,
      orderBy: { createdAt: 'asc' },
      select: {
        conversationId: true,
        role: true,
        content: true,
        createdAt: true
      }
    }),
    prisma.conversationOutcome.findMany({
      where: { ...dateFilter, ...(shopId ? { shopId } : {}) }
    }),
    prisma.analyticsEvent.findMany({
      where: {
        ...dateFilter,
        ...(shopId ? { shopId } : {}),
        eventType: { in: ['intent_detected', 'tool_used'] }
      },
      select: {
        conversationId: true,
        eventType: true,
        eventData: true
      }
    })
  ]);

  // Index outcomes by conversationId
  const outcomeMap = {};
  outcomes.forEach(o => { outcomeMap[o.conversationId] = o; });

  // Index intents and tools by conversationId
  const intentMap = {};
  const toolsMap = {};
  events.forEach(e => {
    try {
      const data = e.eventData ? JSON.parse(e.eventData) : {};
      if (e.eventType === 'intent_detected') {
        if (!intentMap[e.conversationId]) intentMap[e.conversationId] = [];
        intentMap[e.conversationId].push(data.intent);
      }
      if (e.eventType === 'tool_used') {
        if (!toolsMap[e.conversationId]) toolsMap[e.conversationId] = [];
        toolsMap[e.conversationId].push(data.toolName);
      }
    } catch (err) { /* skip */ }
  });

  // Build export rows
  return messages.map(msg => {
    const outcome = outcomeMap[msg.conversationId];
    const intents = intentMap[msg.conversationId] || [];
    const tools = toolsMap[msg.conversationId] || [];

    let contentText = msg.content;
    try {
      const parsed = JSON.parse(msg.content);
      if (Array.isArray(parsed)) {
        contentText = parsed.filter(b => b.type === 'text').map(b => b.text).join(' ');
      }
    } catch { /* use raw */ }

    return {
      date: msg.createdAt.toISOString(),
      conversationId: msg.conversationId,
      role: msg.role,
      message: contentText?.substring(0, 500) || '',
      intent: intents.join(', '),
      sentiment: outcome?.sentiment || '',
      sentimentScore: outcome?.sentimentScore ?? '',
      outcome: outcome?.outcome || '',
      toolsUsed: tools.join(', ')
    };
  });
}

/**
 * Get weekly pattern report for a date range
 * Identifies top intents, errors, tool failures, and problematic patterns
 * @param {string} [shopId]
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<object>}
 */
export async function getWeeklyReport(shopId, startDate, endDate) {
  const dateFilter = { createdAt: { gte: startDate, lte: endDate } };
  const shopFilter = shopId ? { shopId } : {};

  const [events, outcomes, feedbackItems, conversations] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { ...dateFilter, ...shopFilter }
    }),
    prisma.conversationOutcome.findMany({
      where: { ...dateFilter, ...shopFilter }
    }),
    prisma.feedback.findMany({
      where: { ...dateFilter, ...shopFilter }
    }),
    prisma.conversation.count({ where: dateFilter })
  ]);

  // --- Intent analysis ---
  const intentCounts = {};
  const intentSources = {};
  const toolCounts = {};
  const toolErrors = {};
  const errorMessages = {};
  let totalErrors = 0;
  let totalToolCalls = 0;
  const routingAmbiguities = [];

  events.forEach(e => {
    try {
      const data = e.eventData ? JSON.parse(e.eventData) : {};

      if (e.eventType === 'intent_detected') {
        const intent = data.intent || 'unknown';
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
        const src = data.source || 'unknown';
        intentSources[src] = (intentSources[src] || 0) + 1;
      }

      if (e.eventType === 'tool_used') {
        const tool = data.toolName || 'unknown';
        totalToolCalls++;
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
        if (data.error || data.isError) {
          toolErrors[tool] = (toolErrors[tool] || 0) + 1;
        }
      }

      if (e.eventType === 'turn_error') {
        totalErrors++;
        const msg = data.error || data.message || 'unknown';
        const key = msg.substring(0, 100);
        errorMessages[key] = (errorMessages[key] || 0) + 1;
      }

      if (e.eventType === 'routing_selected' && data.isAmbiguous) {
        routingAmbiguities.push({
          conversationId: e.conversationId,
          scores: data.scores,
          gap: data.scoreGap,
          date: e.createdAt
        });
      }
    } catch { /* skip */ }
  });

  // --- Outcome analysis ---
  const outcomeCounts = {};
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  outcomes.forEach(o => {
    outcomeCounts[o.outcome] = (outcomeCounts[o.outcome] || 0) + 1;
    if (o.sentiment) sentimentCounts[o.sentiment]++;
  });

  // --- Feedback analysis ---
  const feedbackUp = feedbackItems.filter(f => f.rating === 'up').length;
  const feedbackDown = feedbackItems.filter(f => f.rating === 'down').length;
  const negativeComments = feedbackItems
    .filter(f => f.rating === 'down' && f.comment)
    .map(f => ({ conversationId: f.conversationId, comment: f.comment, date: f.createdAt }));

  // --- Top N helpers ---
  const topN = (obj, n) => Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

  // --- Identify top 5 problems ---
  const problems = [];

  // High error rate
  if (totalErrors > 0) {
    problems.push({
      type: 'errors',
      severity: totalErrors > 10 ? 'high' : 'medium',
      description: `${totalErrors} erreurs detectees`,
      details: topN(errorMessages, 3)
    });
  }

  // Tool failures
  const failedTools = Object.entries(toolErrors).filter(([, c]) => c > 0);
  if (failedTools.length > 0) {
    problems.push({
      type: 'tool_failures',
      severity: failedTools.some(([, c]) => c > 5) ? 'high' : 'medium',
      description: `${failedTools.reduce((s, [, c]) => s + c, 0)} echecs outils`,
      details: failedTools.map(([tool, count]) => ({
        key: tool,
        count,
        failRate: toolCounts[tool] ? Math.round((count / toolCounts[tool]) * 100) + '%' : 'N/A'
      }))
    });
  }

  // High escalation rate
  const escalated = outcomeCounts.escalated || 0;
  const totalOutcomes = outcomes.length;
  if (totalOutcomes > 0 && escalated / totalOutcomes > 0.2) {
    problems.push({
      type: 'high_escalation',
      severity: escalated / totalOutcomes > 0.4 ? 'high' : 'medium',
      description: `Taux d'escalade: ${Math.round((escalated / totalOutcomes) * 100)}% (${escalated}/${totalOutcomes})`,
      details: []
    });
  }

  // Negative sentiment dominance
  if (sentimentCounts.negative > sentimentCounts.positive && sentimentCounts.negative > 5) {
    problems.push({
      type: 'negative_sentiment',
      severity: 'medium',
      description: `Sentiment negatif dominant: ${sentimentCounts.negative} negatifs vs ${sentimentCounts.positive} positifs`,
      details: []
    });
  }

  // Low satisfaction from feedback
  const totalFeedback = feedbackUp + feedbackDown;
  if (totalFeedback > 0 && feedbackDown / totalFeedback > 0.3) {
    problems.push({
      type: 'low_satisfaction',
      severity: feedbackDown / totalFeedback > 0.5 ? 'high' : 'medium',
      description: `Satisfaction faible: ${Math.round((feedbackUp / totalFeedback) * 100)}% positif (${feedbackDown} negatifs)`,
      details: negativeComments.slice(0, 3)
    });
  }

  // Ambiguous routing
  if (routingAmbiguities.length > 5) {
    problems.push({
      type: 'ambiguous_routing',
      severity: 'low',
      description: `${routingAmbiguities.length} routages ambigus detectes`,
      details: []
    });
  }

  // Sort by severity and take top 5
  const severityOrder = { high: 0, medium: 1, low: 2 };
  problems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    summary: {
      totalConversations: conversations,
      totalEvents: events.length,
      totalErrors,
      totalToolCalls,
      totalOutcomes,
      totalFeedback
    },
    intents: {
      distribution: topN(intentCounts, 20),
      sources: intentSources,
      unknownCount: intentCounts.unknown || 0
    },
    tools: {
      usage: topN(toolCounts, 10),
      errors: toolErrors,
      totalCalls: totalToolCalls
    },
    outcomes: outcomeCounts,
    sentiment: sentimentCounts,
    feedback: {
      up: feedbackUp,
      down: feedbackDown,
      satisfactionRate: totalFeedback > 0 ? Math.round((feedbackUp / totalFeedback) * 100) : null,
      negativeComments: negativeComments.slice(0, 10)
    },
    routing: {
      ambiguousCount: routingAmbiguities.length
    },
    topProblems: problems.slice(0, 5),
    generatedAt: new Date().toISOString()
  };
}

/**
 * Compute a heuristic conversion score (0.0 – 1.0) for a conversation
 * based on events that signal purchase intent.
 *
 * Scoring signals and weights:
 *   - Product search / catalog browsing:      +0.10 each (max 0.20)
 *   - Products displayed to user:             +0.10 each (max 0.20)
 *   - Cart interaction (get/update):          +0.25
 *   - Quote / devis intent detected:          +0.20
 *   - Pricing / tarifs intent detected:       +0.10
 *   - Order-related intent (commander):       +0.15
 *   - B2B-specific intent (b2b_only):         +0.05
 *   - Positive sentiment outcome:             +0.05
 *   - Multiple user messages (engagement):    +0.05 if >=3 messages
 *
 * The raw sum is clamped to [0.0, 1.0].
 *
 * @param {Array} events - AnalyticsEvent rows for the conversation
 * @param {object} [outcome] - ConversationOutcome row (optional)
 * @returns {number} Score between 0.0 and 1.0
 */
export function computeConversionScore(events, outcome) {
  let score = 0;
  let productSearches = 0;
  let productsDisplayed = 0;
  let hasCartInteraction = false;
  let userMessageCount = 0;

  const conversionIntents = {
    devis: 0.20,
    tarifs: 0.10,
    commander_produits: 0.15,
    b2b_only: 0.05,
    decouvrir_produits: 0.05
  };

  for (const e of events) {
    try {
      const data = e.eventData ? JSON.parse(e.eventData) : {};

      if (e.eventType === 'intent_detected') {
        const intent = data.intent || '';
        if (conversionIntents[intent]) {
          score += conversionIntents[intent];
        }
      }

      if (e.eventType === 'tool_used') {
        const tool = data.toolName || '';
        if (tool === 'search_shop_catalog') {
          productSearches++;
        }
        if (tool === 'get_cart' || tool === 'update_cart') {
          hasCartInteraction = true;
        }
      }

      if (e.eventType === 'products_displayed') {
        productsDisplayed++;
      }

      if (e.eventType === 'user_message_received') {
        userMessageCount++;
      }
    } catch { /* skip malformed */ }
  }

  // Product search signals (max 0.20)
  score += Math.min(productSearches * 0.10, 0.20);

  // Products displayed signals (max 0.20)
  score += Math.min(productsDisplayed * 0.10, 0.20);

  // Cart interaction is a strong conversion signal
  if (hasCartInteraction) score += 0.25;

  // Engagement: multiple user messages
  if (userMessageCount >= 3) score += 0.05;

  // Positive sentiment from outcome
  if (outcome?.sentiment === 'positive') score += 0.05;

  return Math.min(Math.round(score * 100) / 100, 1.0);
}

/**
 * Format a conversation for dashboard display
 * @param {object} conversation - Conversation with messages
 * @returns {object}
 */
function formatConversationForDashboard(conversation) {
  const userMessages = [];
  const assistantMessages = [];

  conversation.messages.forEach(m => {
    let text = m.content;
    try {
      const parsed = JSON.parse(m.content);
      if (Array.isArray(parsed)) {
        text = parsed.filter(b => b.type === 'text').map(b => b.text).join(' ');
      }
    } catch { /* use raw */ }

    if (m.role === 'user') userMessages.push(text);
    else assistantMessages.push(text);
  });

  return {
    id: conversation.id,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    userPreview: (userMessages.join(' | ')).substring(0, 150) || '-',
    assistantPreview: (assistantMessages.join(' | ')).substring(0, 150) || '-'
  };
}
