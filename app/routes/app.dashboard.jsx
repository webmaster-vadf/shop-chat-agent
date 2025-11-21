import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  Badge,
  InlineStack,
  Box,
  Divider,
  Select,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { getChatStats, getRecentConversations } from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "week";

  // Calculate date range
  const endDate = new Date();
  let startDate = new Date();

  switch (period) {
    case "day":
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "all":
      startDate = new Date(0);
      break;
    default:
      startDate.setDate(startDate.getDate() - 7);
  }

  const stats = await getChatStats(startDate, endDate);
  const recentConversations = await getRecentConversations(30);

  // Extract plain text from user messages
  const userQuestions = stats.allUserMessages
    .map((msg) => {
      let content = msg.content;
      // Try to parse JSON content
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          // Filter out tool_result messages
          const textBlocks = parsed.filter((b) => b.type === "text");
          if (textBlocks.length > 0) {
            content = textBlocks.map((b) => b.text).join(" ");
          } else {
            return null; // Skip tool_result only messages
          }
        }
      } catch {
        // Not JSON, use as-is
      }
      return {
        content: content.substring(0, 200),
        date: new Date(msg.createdAt).toLocaleString("fr-FR"),
        conversationId: msg.conversationId,
      };
    })
    .filter(Boolean)
    .slice(0, 50);

  // Analyze intents from messages
  const intentKeywords = {
    "Compte / Activation": ["activer", "activation", "compte", "créer compte", "inscription"],
    "Mot de passe": ["mot de passe", "password", "oublié", "réinitialiser"],
    "Produits": ["produit", "catalogue", "cherche", "prix", "stock"],
    "Photos / Visuels": ["photo", "visuel", "image", "fiche technique"],
    "Commande": ["commander", "commande", "panier", "acheter"],
    "Devis": ["devis"],
    "Support": ["problème", "aide", "support", "erreur"],
    "Salutation": ["bonjour", "salut", "hello"],
  };

  const intentCounts = {};
  Object.keys(intentKeywords).forEach((intent) => {
    intentCounts[intent] = 0;
  });
  intentCounts["Autre"] = 0;

  userQuestions.forEach((q) => {
    if (!q) return;
    const msgLower = q.content.toLowerCase();
    let matched = false;

    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      if (keywords.some((k) => msgLower.includes(k))) {
        intentCounts[intent]++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      intentCounts["Autre"]++;
    }
  });

  return json({
    stats: {
      totalConversations: stats.totalConversations,
      totalMessages: stats.totalMessages,
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
    },
    userQuestions,
    intentCounts,
    recentConversations: recentConversations.map((c) => ({
      id: c.id,
      messageCount: c.messages.length,
      createdAt: new Date(c.createdAt).toLocaleString("fr-FR"),
      updatedAt: new Date(c.updatedAt).toLocaleString("fr-FR"),
      preview: c.messages
        .filter((m) => m.role === "user")
        .map((m) => {
          try {
            const parsed = JSON.parse(m.content);
            if (Array.isArray(parsed)) {
              const textBlocks = parsed.filter((b) => b.type === "text");
              return textBlocks.map((b) => b.text).join(" ");
            }
            return m.content;
          } catch {
            return m.content;
          }
        })
        .join(" | ")
        .substring(0, 100),
    })),
    period,
  });
};

export default function Dashboard() {
  const { stats, userQuestions, intentCounts, recentConversations, period } =
    useLoaderData();
  const [selectedPeriod, setSelectedPeriod] = useState(period);

  const handlePeriodChange = (value) => {
    setSelectedPeriod(value);
    window.location.href = `/app/dashboard?period=${value}`;
  };

  // Prepare intent data for display
  const intentRows = Object.entries(intentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([intent, count]) => [
      intent,
      count,
      `${Math.round((count / stats.userMessages) * 100) || 0}%`,
    ]);

  // Prepare questions table
  const questionRows = userQuestions.map((q) => [q.date, q.content]);

  // Prepare conversations table
  const conversationRows = recentConversations.map((c) => [
    c.createdAt,
    c.messageCount,
    c.preview || "-",
  ]);

  return (
    <Page>
      <TitleBar title="Dashboard Chat VADF" />
      <BlockStack gap="500">
        {/* Period selector */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingMd" as="h2">
              Statistiques du chat
            </Text>
            <Select
              label="Période"
              labelInline
              options={[
                { label: "Dernières 24h", value: "day" },
                { label: "7 derniers jours", value: "week" },
                { label: "30 derniers jours", value: "month" },
                { label: "Tout", value: "all" },
              ]}
              value={selectedPeriod}
              onChange={handlePeriodChange}
            />
          </InlineStack>
        </Card>

        {/* Stats cards */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Conversations
                </Text>
                <Text variant="heading2xl" as="p">
                  {stats.totalConversations}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Messages totaux
                </Text>
                <Text variant="heading2xl" as="p">
                  {stats.totalMessages}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Questions utilisateurs
                </Text>
                <Text variant="heading2xl" as="p">
                  {stats.userMessages}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Réponses assistant
                </Text>
                <Text variant="heading2xl" as="p">
                  {stats.assistantMessages}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Intent analysis */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Analyse des intentions
                </Text>
                {intentRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Catégorie", "Nombre", "Pourcentage"]}
                    rows={intentRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    Aucune donnée pour cette période
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Conversations récentes
                </Text>
                {conversationRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "text"]}
                    headings={["Date", "Messages", "Aperçu"]}
                    rows={conversationRows.slice(0, 10)}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    Aucune conversation
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Recent questions */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Questions récentes des utilisateurs
            </Text>
            {questionRows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Date", "Question"]}
                rows={questionRows.slice(0, 30)}
              />
            ) : (
              <Text as="p" tone="subdued">
                Aucune question pour cette période
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
