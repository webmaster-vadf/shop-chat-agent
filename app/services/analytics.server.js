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
