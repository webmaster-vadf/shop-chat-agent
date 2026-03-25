import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Tabs,
  ProgressBar,
  Button,
  Select,
  InlineGrid,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getDashboardAnalytics } from "../services/analytics.server";

// ============================================================================
// CONSTANTS
// ============================================================================

const PERIODS = {
  day: 1,
  week: 7,
  month: 30,
  all: Infinity,
};

const PERIOD_OPTIONS = [
  { label: "Aujourd'hui", value: "day" },
  { label: "7 jours", value: "week" },
  { label: "30 jours", value: "month" },
  { label: "Tout", value: "all" },
];

const OUTCOME_LABELS = {
  resolved: "Résolue",
  escalated: "Escaladée",
  converted: "Convertie",
  abandoned: "Abandonnée",
  ongoing: "En cours",
};

const SENTIMENT_LABELS = {
  positive: "Positif",
  neutral: "Neutre",
  negative: "Négatif",
};

// ============================================================================
// HELPERS
// ============================================================================

function calculateDateRange(period) {
  const endDate = new Date();
  const startDate = new Date();
  const days = PERIODS[period] || PERIODS.week;
  if (days === Infinity) return { startDate: new Date(0), endDate };
  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate };
}

function formatPercent(value) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds) {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}

function sentimentToTone(sentiment) {
  if (sentiment === "positive") return "success";
  if (sentiment === "negative") return "critical";
  return "info";
}

function outcomeToBadge(outcome) {
  const tones = {
    resolved: "success",
    converted: "success",
    escalated: "warning",
    abandoned: "critical",
    ongoing: "info",
  };
  return tones[outcome] || "info";
}

// ============================================================================
// LOADER
// ============================================================================

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "week";
  const { startDate, endDate } = calculateDateRange(period);

  const analytics = await getDashboardAnalytics(null, startDate, endDate);

  return json({ analytics, period });
};

// ============================================================================
// KPI CARDS
// ============================================================================

function KpiCard({ title, value, subtitle, tone }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h3" tone="subdued">
          {title}
        </Text>
        <Text variant="heading2xl" as="p" tone={tone}>
          {value}
        </Text>
        {subtitle && (
          <Text variant="bodySm" as="p" tone="subdued">
            {subtitle}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function KpiHeader({ kpis }) {
  const sentimentLabel = kpis.avgSentiment != null
    ? kpis.avgSentiment > 0.3 ? "Positif" : kpis.avgSentiment < -0.3 ? "Négatif" : "Neutre"
    : "-";
  const sentimentTone = kpis.avgSentiment > 0.3 ? "success" : kpis.avgSentiment < -0.3 ? "critical" : undefined;

  return (
    <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
      <KpiCard
        title="Conversations"
        value={kpis.totalConversations}
        subtitle={`${kpis.userMessages} msg utilisateur`}
      />
      <KpiCard
        title="Taux de résolution"
        value={formatPercent(kpis.resolutionRate)}
        subtitle={kpis.resolutionRate != null ? (
          kpis.resolutionRate >= 0.7 ? "Bon" : kpis.resolutionRate >= 0.4 ? "Moyen" : "A améliorer"
        ) : undefined}
        tone={kpis.resolutionRate >= 0.7 ? "success" : kpis.resolutionRate >= 0.4 ? "caution" : "critical"}
      />
      <KpiCard
        title="Satisfaction"
        value={sentimentLabel}
        subtitle={kpis.avgSentiment != null ? `Score: ${kpis.avgSentiment.toFixed(2)}` : undefined}
        tone={sentimentTone}
      />
      <KpiCard
        title="Temps moyen"
        value={formatDuration(kpis.avgResolutionTime)}
        subtitle={kpis.escalationRate != null ? `Escalade: ${formatPercent(kpis.escalationRate)}` : undefined}
      />
      <KpiCard
        title="Score conversion"
        value={kpis.avgConversionScore != null ? `${Math.round(kpis.avgConversionScore * 100)}%` : '-'}
        subtitle={kpis.conversionRate != null ? `Taux: ${formatPercent(kpis.conversionRate)}` : undefined}
        tone={kpis.avgConversionScore >= 0.5 ? "success" : kpis.avgConversionScore >= 0.2 ? "caution" : undefined}
      />
    </InlineGrid>
  );
}

// ============================================================================
// TAB: VUE D'ENSEMBLE
// ============================================================================

function OverviewTab({ analytics }) {
  const { intentDistribution, outcomeDistribution, sentimentDistribution, funnel, feedback } = analytics;

  // Intent distribution table
  const totalIntents = Object.values(intentDistribution).reduce((a, b) => a + b, 0);
  const intentRows = Object.entries(intentDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([intent, count]) => [
      intent,
      count,
      `${totalIntents > 0 ? Math.round((count / totalIntents) * 100) : 0}%`,
    ]);

  // Outcome distribution table
  const totalOutcomes = Object.values(outcomeDistribution).reduce((a, b) => a + b, 0);
  const outcomeRows = Object.entries(outcomeDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => [
      OUTCOME_LABELS[outcome] || outcome,
      count,
      `${totalOutcomes > 0 ? Math.round((count / totalOutcomes) * 100) : 0}%`,
    ]);

  // Sentiment distribution
  const totalSentiment = Object.values(sentimentDistribution).reduce((a, b) => a + b, 0);
  const sentimentRows = Object.entries(sentimentDistribution)
    .filter(([, count]) => count > 0)
    .map(([sentiment, count]) => [
      SENTIMENT_LABELS[sentiment] || sentiment,
      count,
      `${totalSentiment > 0 ? Math.round((count / totalSentiment) * 100) : 0}%`,
    ]);

  return (
    <BlockStack gap="500">
      {/* Funnel */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Entonnoir de conversion</Text>
          <BlockStack gap="300">
            <FunnelStep label="Conversations" value={funnel.total} max={funnel.total} />
            <FunnelStep label="Engagées (avec outcome)" value={funnel.engaged} max={funnel.total} />
            <FunnelStep label="Résolues" value={funnel.resolved} max={funnel.total} tone="success" />
            <FunnelStep label="Converties" value={funnel.converted} max={funnel.total} tone="success" />
            <FunnelStep label="Escaladées" value={funnel.escalated} max={funnel.total} tone="warning" />
            <FunnelStep label="Abandonnées" value={funnel.abandoned} max={funnel.total} tone="critical" />
          </BlockStack>
        </BlockStack>
      </Card>

      <Layout>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Distribution des intentions</Text>
              {intentRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "numeric", "text"]}
                  headings={["Intent", "Nombre", "%"]}
                  rows={intentRows}
                />
              ) : (
                <Text as="p" tone="subdued">Aucune donnée</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Outcomes</Text>
                {outcomeRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Résultat", "Nombre", "%"]}
                    rows={outcomeRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">Aucune donnée</Text>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Sentiment</Text>
                {sentimentRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Sentiment", "Nombre", "%"]}
                    rows={sentimentRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">Aucune donnée sentiment</Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Feedback section */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Feedback utilisateur</Text>
          {feedback && feedback.total > 0 ? (
            <BlockStack gap="300">
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <KpiCard
                  title="Satisfaction"
                  value={formatPercent(feedback.satisfactionRate)}
                  subtitle={`${feedback.total} votes`}
                  tone={feedback.satisfactionRate >= 0.7 ? "success" : feedback.satisfactionRate >= 0.4 ? "caution" : "critical"}
                />
                <KpiCard title="Positifs" value={feedback.up} tone="success" />
                <KpiCard title="Négatifs" value={feedback.down} tone={feedback.down > 0 ? "critical" : undefined} />
                <KpiCard title="Avec commentaire" value={feedback.withComments} />
              </InlineGrid>
              {feedback.recentNegative && feedback.recentNegative.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">Retours négatifs récents</Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text"]}
                      headings={["Date", "Conversation", "Commentaire"]}
                      rows={feedback.recentNegative.map(f => [
                        new Date(f.createdAt).toLocaleDateString("fr-FR"),
                        f.conversationId?.substring(0, 12) + '...',
                        f.comment?.substring(0, 100) || '-'
                      ])}
                    />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">Aucun feedback reçu</Text>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function FunnelStep({ label, value, max, tone }) {
  const progress = max > 0 ? (value / max) * 100 : 0;
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text variant="bodySm" as="span">{label}</Text>
        <Text variant="bodySm" as="span" fontWeight="semibold">
          {value} {max > 0 && value !== max ? `(${Math.round(progress)}%)` : ''}
        </Text>
      </InlineStack>
      <ProgressBar progress={progress} tone={tone} size="small" />
    </BlockStack>
  );
}

// ============================================================================
// TAB: CONVERSATIONS
// ============================================================================

function ConversationsTab({ conversations }) {
  const rows = conversations.map((c) => [
    new Date(c.createdAt).toLocaleString("fr-FR"),
    c.messageCount,
    c.userPreview,
    c.assistantPreview,
  ]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Conversations récentes</Text>
        {rows.length > 0 ? (
          <DataTable
            columnContentTypes={["text", "numeric", "text", "text"]}
            headings={["Date", "Messages", "Client", "Assistant"]}
            rows={rows}
          />
        ) : (
          <Text as="p" tone="subdued">Aucune conversation</Text>
        )}
      </BlockStack>
    </Card>
  );
}

// ============================================================================
// TAB: PERFORMANCE IA
// ============================================================================

function AiPerformanceTab({ aiPerformance, routing, experiments }) {
  const {
    vadfResponseCount,
    mcpFallbackCount,
    errorCount,
    totalClassifications,
    vadfAccuracy,
    toolUsage,
  } = aiPerformance;

  const toolRows = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => [tool, count]);

  return (
    <BlockStack gap="500">
      <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
        <KpiCard
          title="Classifications IA"
          value={totalClassifications}
          subtitle="Total des intents classifiés"
        />
        <KpiCard
          title="Réponses VADF"
          value={vadfResponseCount}
          subtitle="Traitées par le système VADF"
        />
        <KpiCard
          title="Fallback MCP"
          value={mcpFallbackCount}
          subtitle="Renvoyées vers Claude+MCP"
        />
        <KpiCard
          title="Erreurs"
          value={errorCount}
          subtitle={errorCount > 0 ? "Tours avec erreur" : "Aucune erreur"}
          tone={errorCount > 0 ? "critical" : "success"}
        />
      </InlineGrid>

      <Layout>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Précision VADF</Text>
              {vadfAccuracy != null ? (
                <BlockStack gap="200">
                  <Text variant="heading2xl" as="p">{formatPercent(vadfAccuracy)}</Text>
                  <ProgressBar
                    progress={vadfAccuracy * 100}
                    tone={vadfAccuracy >= 0.7 ? "success" : vadfAccuracy >= 0.4 ? "highlight" : "critical"}
                  />
                  <Text variant="bodySm" as="p" tone="subdued">
                    Proportion de requêtes traitées directement par VADF vs fallback MCP
                  </Text>
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">Aucune classification</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Utilisation des outils</Text>
              {toolRows.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "numeric"]}
                  headings={["Outil", "Utilisations"]}
                  rows={toolRows}
                />
              ) : (
                <Text as="p" tone="subdued">Aucun outil utilisé</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Agent Routing Performance */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">Performance des agents</Text>
          {routing && routing.totalRoutings > 0 ? (
            <BlockStack gap="300">
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
                <KpiCard
                  title="Routages"
                  value={routing.totalRoutings}
                  subtitle="Décisions de routage"
                />
                <KpiCard
                  title="Confiance moy."
                  value={routing.avgConfidence != null ? `${Math.round(routing.avgConfidence * 100)}%` : '-'}
                  tone={routing.avgConfidence >= 0.7 ? "success" : routing.avgConfidence >= 0.4 ? "caution" : "critical"}
                />
                <KpiCard
                  title="Ambigus"
                  value={routing.ambiguousCount}
                  subtitle={routing.ambiguousRate != null ? `${Math.round(routing.ambiguousRate * 100)}% des routages` : undefined}
                  tone={routing.ambiguousCount > 0 ? "warning" : "success"}
                />
                <KpiCard
                  title="Écart moy."
                  value={routing.avgScoreGap != null ? routing.avgScoreGap.toFixed(2) : '-'}
                  subtitle="Entre top 2 agents"
                />
              </InlineGrid>
              <Layout>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">Routage par agent</Text>
                      <DataTable
                        columnContentTypes={["text", "numeric", "text"]}
                        headings={["Agent", "Routages", "%"]}
                        rows={Object.entries(routing.byAgent)
                          .sort((a, b) => b[1] - a[1])
                          .map(([agent, count]) => [
                            agent,
                            count,
                            `${Math.round((count / routing.totalRoutings) * 100)}%`
                          ])}
                      />
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section variant="oneHalf">
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingSm" as="h3">Routage par méthode</Text>
                      <DataTable
                        columnContentTypes={["text", "numeric"]}
                        headings={["Méthode", "Utilisations"]}
                        rows={Object.entries(routing.byMethod)
                          .sort((a, b) => b[1] - a[1])
                          .map(([method, count]) => [method, count])}
                      />
                    </BlockStack>
                  </Card>
                </Layout.Section>
              </Layout>
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">Aucune donnée de routage</Text>
          )}
        </BlockStack>
      </Card>

      {/* A/B Testing */}
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">A/B Testing</Text>
          {experiments && Object.keys(experiments.exposures).length > 0 ? (
            <BlockStack gap="400">
              {Object.entries(experiments.exposures).map(([expKey, variants]) => {
                const totalExposures = Object.values(variants).reduce((a, b) => a + b, 0);
                const variantRows = Object.entries(variants)
                  .sort((a, b) => b[1] - a[1])
                  .map(([variantKey, count]) => [
                    variantKey,
                    count,
                    `${Math.round((count / totalExposures) * 100)}%`
                  ]);
                return (
                  <Card key={expKey}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="headingSm" as="h3">{expKey}</Text>
                        <Text variant="bodySm" as="span" tone="subdued">{totalExposures} expositions</Text>
                      </InlineStack>
                      <DataTable
                        columnContentTypes={["text", "numeric", "text"]}
                        headings={["Variante", "Expositions", "Répartition"]}
                        rows={variantRows}
                      />
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">Aucune expérience active</Text>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ============================================================================
// TAB: EXPORT
// ============================================================================

function ExportTab({ period }) {
  const handleExport = useCallback(() => {
    window.open(`/api/analytics-export?period=${period}&format=csv`, '_blank');
  }, [period]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Export des données</Text>
        <Text as="p">
          Exportez les données analytiques au format CSV pour une analyse approfondie.
          L'export inclut : messages, intents, sentiment, outcomes et outils utilisés.
        </Text>
        <InlineStack gap="300">
          <Button variant="primary" onClick={handleExport}>
            Exporter en CSV
          </Button>
        </InlineStack>
        <Divider />
        <Text variant="bodySm" as="p" tone="subdued">
          Période sélectionnée : {PERIOD_OPTIONS.find(o => o.value === period)?.label || period}
        </Text>
      </BlockStack>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Dashboard() {
  const { analytics, period } = useLoaderData();
  const [selectedTab, setSelectedTab] = useState(0);
  const navigate = useNavigate();

  const handlePeriodChange = useCallback((value) => {
    navigate(`/app/dashboard?period=${value}`);
  }, [navigate]);

  const tabs = [
    { id: "overview", content: "Vue d'ensemble" },
    { id: "conversations", content: "Conversations" },
    { id: "ai-performance", content: "Performance IA" },
    { id: "export", content: "Export" },
  ];

  const renderTabContent = () => {
    switch (selectedTab) {
      case 0:
        return <OverviewTab analytics={analytics} />;
      case 1:
        return <ConversationsTab conversations={analytics.recentConversations} />;
      case 2:
        return <AiPerformanceTab aiPerformance={analytics.aiPerformance} routing={analytics.routing} experiments={analytics.experiments} />;
      case 3:
        return <ExportTab period={period} />;
      default:
        return null;
    }
  };

  return (
    <Page>
      <TitleBar title="Dashboard IA VADF" />
      <BlockStack gap="500">
        {/* Period selector */}
        <InlineStack align="end">
          <Box width="200px">
            <Select
              label="Période"
              labelHidden
              options={PERIOD_OPTIONS}
              value={period}
              onChange={handlePeriodChange}
            />
          </Box>
        </InlineStack>

        {/* KPI Header */}
        <KpiHeader kpis={analytics.kpis} />

        {/* Tabs */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">
              {renderTabContent()}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
