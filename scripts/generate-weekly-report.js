#!/usr/bin/env node
/**
 * Weekly Report Generator
 * Analyzes intents, errors, tool failures, and problematic patterns
 * Exports JSON and CSV files to ./reports/
 *
 * Usage:
 *   node scripts/generate-weekly-report.js                  # last 7 days
 *   node scripts/generate-weekly-report.js --days 14        # last 14 days
 *   node scripts/generate-weekly-report.js --shop shop123   # filter by shop
 *   node scripts/generate-weekly-report.js --format json    # JSON only
 *   node scripts/generate-weekly-report.js --format csv     # CSV only
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// ============================================================
// CLI Arguments
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 7, shopId: null, format: 'both' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) opts.days = parseInt(args[i + 1], 10);
    if (args[i] === '--shop' && args[i + 1]) opts.shopId = args[i + 1];
    if (args[i] === '--format' && args[i + 1]) opts.format = args[i + 1]; // json, csv, both
  }
  return opts;
}

// ============================================================
// Report Generation (mirrors analytics.server.js getWeeklyReport)
// ============================================================

async function generateReport(shopId, startDate, endDate) {
  const dateFilter = { createdAt: { gte: startDate, lte: endDate } };
  const shopFilter = shopId ? { shopId } : {};

  const [events, outcomes, feedbackItems, conversationCount] = await Promise.all([
    prisma.analyticsEvent.findMany({ where: { ...dateFilter, ...shopFilter } }),
    prisma.conversationOutcome.findMany({ where: { ...dateFilter, ...shopFilter } }),
    prisma.feedback.findMany({ where: { ...dateFilter, ...shopFilter } }),
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
    } catch { /* skip malformed */ }
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

  // --- Top N helper ---
  const topN = (obj, n) => Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));

  // --- Identify top 5 problems ---
  const problems = [];

  if (totalErrors > 0) {
    problems.push({
      type: 'errors',
      severity: totalErrors > 10 ? 'high' : 'medium',
      description: `${totalErrors} erreurs detectees`,
      details: topN(errorMessages, 3)
    });
  }

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

  if (sentimentCounts.negative > sentimentCounts.positive && sentimentCounts.negative > 5) {
    problems.push({
      type: 'negative_sentiment',
      severity: 'medium',
      description: `Sentiment negatif dominant: ${sentimentCounts.negative} negatifs vs ${sentimentCounts.positive} positifs`,
      details: []
    });
  }

  const totalFeedback = feedbackUp + feedbackDown;
  if (totalFeedback > 0 && feedbackDown / totalFeedback > 0.3) {
    problems.push({
      type: 'low_satisfaction',
      severity: feedbackDown / totalFeedback > 0.5 ? 'high' : 'medium',
      description: `Satisfaction faible: ${Math.round((feedbackUp / totalFeedback) * 100)}% positif (${feedbackDown} negatifs)`,
      details: negativeComments.slice(0, 3)
    });
  }

  if (routingAmbiguities.length > 5) {
    problems.push({
      type: 'ambiguous_routing',
      severity: 'low',
      description: `${routingAmbiguities.length} routages ambigus detectes`,
      details: []
    });
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  problems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    summary: {
      totalConversations: conversationCount,
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
    routing: { ambiguousCount: routingAmbiguities.length },
    topProblems: problems.slice(0, 5),
    generatedAt: new Date().toISOString()
  };
}

// ============================================================
// CSV Export
// ============================================================

function reportToCSV(report) {
  const sections = [];

  // Summary
  sections.push('# Summary');
  sections.push('metric,value');
  for (const [k, v] of Object.entries(report.summary)) {
    sections.push(`${k},${v}`);
  }

  // Intent distribution
  sections.push('');
  sections.push('# Intent Distribution');
  sections.push('intent,count');
  for (const { key, count } of report.intents.distribution) {
    sections.push(`${key},${count}`);
  }

  // Tool usage
  sections.push('');
  sections.push('# Tool Usage');
  sections.push('tool,count');
  for (const { key, count } of report.tools.usage) {
    sections.push(`${key},${count}`);
  }

  // Tool errors
  if (Object.keys(report.tools.errors).length > 0) {
    sections.push('');
    sections.push('# Tool Errors');
    sections.push('tool,error_count');
    for (const [tool, count] of Object.entries(report.tools.errors)) {
      sections.push(`${tool},${count}`);
    }
  }

  // Outcomes
  sections.push('');
  sections.push('# Outcomes');
  sections.push('outcome,count');
  for (const [outcome, count] of Object.entries(report.outcomes)) {
    sections.push(`${outcome},${count}`);
  }

  // Sentiment
  sections.push('');
  sections.push('# Sentiment');
  sections.push('sentiment,count');
  for (const [s, c] of Object.entries(report.sentiment)) {
    sections.push(`${s},${c}`);
  }

  // Feedback
  sections.push('');
  sections.push('# Feedback');
  sections.push(`up,${report.feedback.up}`);
  sections.push(`down,${report.feedback.down}`);
  sections.push(`satisfaction_rate,${report.feedback.satisfactionRate ?? 'N/A'}`);

  // Top problems
  sections.push('');
  sections.push('# Top Problems');
  sections.push('type,severity,description');
  for (const p of report.topProblems) {
    const desc = p.description.replace(/,/g, ';');
    sections.push(`${p.type},${p.severity},${desc}`);
  }

  // Negative feedback comments
  if (report.feedback.negativeComments.length > 0) {
    sections.push('');
    sections.push('# Negative Feedback Comments');
    sections.push('conversation_id,comment,date');
    for (const c of report.feedback.negativeComments) {
      const comment = (c.comment || '').replace(/,/g, ';').replace(/\n/g, ' ');
      sections.push(`${c.conversationId},"${comment}",${c.date}`);
    }
  }

  return sections.join('\n');
}

// ============================================================
// Console Display
// ============================================================

function printReport(report) {
  console.log('\n' + '='.repeat(60));
  console.log('  RAPPORT HEBDOMADAIRE - Patterns & Problemes');
  console.log('='.repeat(60));
  console.log(`  Periode: ${report.period.start.split('T')[0]} -> ${report.period.end.split('T')[0]}`);
  console.log(`  Genere:  ${report.generatedAt}`);
  console.log('='.repeat(60));

  // Summary
  console.log('\n--- Resume ---');
  console.log(`  Conversations: ${report.summary.totalConversations}`);
  console.log(`  Events:        ${report.summary.totalEvents}`);
  console.log(`  Erreurs:       ${report.summary.totalErrors}`);
  console.log(`  Appels outils: ${report.summary.totalToolCalls}`);
  console.log(`  Outcomes:      ${report.summary.totalOutcomes}`);
  console.log(`  Feedbacks:     ${report.summary.totalFeedback}`);

  // Top intents
  console.log('\n--- Top Intents ---');
  for (const { key, count } of report.intents.distribution.slice(0, 10)) {
    const bar = '#'.repeat(Math.min(count, 30));
    console.log(`  ${key.padEnd(30)} ${String(count).padStart(4)}  ${bar}`);
  }
  if (report.intents.unknownCount > 0) {
    console.log(`  ** unknown: ${report.intents.unknownCount} (fallback MCP)`);
  }

  // Tool usage
  if (report.tools.usage.length > 0) {
    console.log('\n--- Outils ---');
    for (const { key, count } of report.tools.usage) {
      const errors = report.tools.errors[key] || 0;
      const errStr = errors > 0 ? ` (${errors} erreurs)` : '';
      console.log(`  ${key.padEnd(35)} ${String(count).padStart(4)}${errStr}`);
    }
  }

  // Outcomes
  if (Object.keys(report.outcomes).length > 0) {
    console.log('\n--- Outcomes ---');
    for (const [k, v] of Object.entries(report.outcomes)) {
      console.log(`  ${k.padEnd(15)} ${v}`);
    }
  }

  // Sentiment
  console.log('\n--- Sentiment ---');
  console.log(`  Positif:  ${report.sentiment.positive}`);
  console.log(`  Neutre:   ${report.sentiment.neutral}`);
  console.log(`  Negatif:  ${report.sentiment.negative}`);

  // Feedback
  console.log('\n--- Feedback ---');
  console.log(`  Positif: ${report.feedback.up}  |  Negatif: ${report.feedback.down}  |  Satisfaction: ${report.feedback.satisfactionRate ?? 'N/A'}%`);

  // Top problems
  if (report.topProblems.length > 0) {
    console.log('\n--- TOP 5 PROBLEMES ---');
    report.topProblems.forEach((p, i) => {
      const icon = p.severity === 'high' ? '[!!!]' : p.severity === 'medium' ? '[!!]' : '[!]';
      console.log(`  ${i + 1}. ${icon} ${p.description}`);
      if (p.details && p.details.length > 0) {
        p.details.forEach(d => {
          console.log(`     - ${d.key}: ${d.count}${d.failRate ? ' (' + d.failRate + ' fail)' : ''}`);
        });
      }
    });
  } else {
    console.log('\n--- Aucun probleme detecte ---');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - opts.days);

  console.log(`Generating report for last ${opts.days} days...`);
  if (opts.shopId) console.log(`Filtering by shop: ${opts.shopId}`);

  const report = await generateReport(opts.shopId, startDate, endDate);

  // Print to console
  printReport(report);

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];

  // Export JSON
  if (opts.format === 'json' || opts.format === 'both') {
    const jsonPath = path.join(reportsDir, `weekly-report-${dateStr}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`JSON exported: ${jsonPath}`);
  }

  // Export CSV
  if (opts.format === 'csv' || opts.format === 'both') {
    const csvPath = path.join(reportsDir, `weekly-report-${dateStr}.csv`);
    fs.writeFileSync(csvPath, reportToCSV(report));
    console.log(`CSV exported:  ${csvPath}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Report generation failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
