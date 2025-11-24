import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getChatStats, getRecentConversations } from "../db.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ============================================================================
// CONSTANTS
// ============================================================================

const PERIODS = {
  day: 1,
  week: 7,
  month: 30,
  all: Infinity,
};

const LIMITS = {
  MAX_QUESTIONS: 50,
  MAX_CONTENT_LENGTH: 200,
  MAX_ASSISTANT_CONTENT: 300,
  MAX_PREVIEW_LENGTH: 100,
  MAX_CONVERSATIONS_DISPLAY: 10,
  MAX_QUESTIONS_DISPLAY: 30,
};

const INTENT_KEYWORDS = {
  "Compte / Activation": ["activer", "activation", "compte", "créer compte", "inscription"],
  "Mot de passe": ["mot de passe", "password", "oublié", "réinitialiser"],
  "Produits": ["produit", "catalogue", "cherche", "prix", "stock"],
  "Photos / Visuels": ["photo", "visuel", "image", "fiche technique"],
  "Commande": ["commander", "commande", "panier", "acheter"],
  "Devis": ["devis"],
  "Support": ["problème", "aide", "support", "erreur"],
  "Salutation": ["bonjour", "salut", "hello"],
};

// ============================================================================
// HELPER FUNCTIONS - Date & Content Processing
// ============================================================================

function calculateDateRange(period) {
  const endDate = new Date();
  const startDate = new Date();

  const days = PERIODS[period] || PERIODS.week;
  if (days === Infinity) {
    return { startDate: new Date(0), endDate };
  }

  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate };
}

function extractTextContent(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const textBlocks = parsed.filter((b) => b.type === "text");
      return textBlocks.length > 0 ? textBlocks.map((b) => b.text).join(" ") : null;
    }
    return typeof parsed === "string" ? parsed : content;
  } catch {
    return content;
  }
}

function formatDate(date) {
  return new Date(date).toLocaleString("fr-FR");
}

// ============================================================================
// HELPER FUNCTIONS - Database Queries
// ============================================================================

async function getAssistantResponse(conversationId, userMessageDate) {
  const response = await prisma.message.findFirst({
    where: {
      conversationId,
      role: "assistant",
      createdAt: { gt: userMessageDate },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!response) return "-";

  const content = extractTextContent(response.content);
  return content ? content.substring(0, LIMITS.MAX_ASSISTANT_CONTENT) : "-";
}

// ============================================================================
// HELPER FUNCTIONS - Data Formatting
// ============================================================================

async function formatUserQuestion(msg) {
  const content = extractTextContent(msg.content);
  if (!content) return null;

  const assistantResponse = await getAssistantResponse(msg.conversationId, msg.createdAt);

  return {
    content: content.substring(0, LIMITS.MAX_CONTENT_LENGTH),
    date: formatDate(msg.createdAt),
    conversationId: msg.conversationId,
    assistantResponse,
  };
}

function formatConversationPreview(conversation) {
  const userMessages = conversation.messages
    .filter((m) => m.role === "user")
    .map((m) => extractTextContent(m.content))
    .filter(Boolean);

  const assistantMessages = conversation.messages
    .filter((m) => m.role === "assistant")
    .map((m) => extractTextContent(m.content))
    .filter(Boolean);

  const userPreview = userMessages.join(" | ");
  const assistantPreview = assistantMessages.join(" | ");

  return {
    id: conversation.id,
    messageCount: conversation.messages.length,
    createdAt: formatDate(conversation.createdAt),
    updatedAt: formatDate(conversation.updatedAt),
    preview: userPreview.substring(0, LIMITS.MAX_PREVIEW_LENGTH) || "-",
    assistantPreview: assistantPreview.substring(0, LIMITS.MAX_PREVIEW_LENGTH) || "-",
  };
}

// ============================================================================
// HELPER FUNCTIONS - Intent Analysis
// ============================================================================

function analyzeIntents(questions) {
  const intentCounts = Object.keys(INTENT_KEYWORDS).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, { "Autre": 0 });

  questions.forEach((q) => {
    const msgLower = q.content.toLowerCase();
    let matched = false;

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (keywords.some((k) => msgLower.includes(k))) {
        intentCounts[intent]++;
        matched = true;
        break;
      }
    }

    if (!matched) intentCounts["Autre"]++;
  });

  return intentCounts;
}

// ============================================================================
// LOADER
// ============================================================================

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "week";

  const { startDate, endDate } = calculateDateRange(period);

  // Parallel data fetching
  const [stats, recentConversations] = await Promise.all([
    getChatStats(startDate, endDate),
    getRecentConversations(30),
  ]);

  // Process user questions with assistant responses
  const userQuestions = await Promise.all(
    stats.allUserMessages.slice(0, LIMITS.MAX_QUESTIONS).map(formatUserQuestion)
  );

  const validQuestions = userQuestions.filter(Boolean);
  const intentCounts = analyzeIntents(validQuestions);

  return json({
    stats: {
      totalConversations: stats.totalConversations,
      totalMessages: stats.totalMessages,
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
    },
    userQuestions: validQuestions,
    intentCounts,
    recentConversations: recentConversations.map(formatConversationPreview),
    period,
  });
};

// ============================================================================
// UI COMPONENTS
// ============================================================================

function StatCard({ title, value }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text variant="headingSm" as="h3">
          {title}
        </Text>
        <Text variant="heading2xl" as="p">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

function IntentAnalysisCard({ intentCounts, totalUserMessages }) {
  const intentRows = Object.entries(intentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([intent, count]) => [
      intent,
      count,
      `${Math.round((count / totalUserMessages) * 100) || 0}%`,
    ]);

  const hasData = intentRows.length > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Analyse des intentions
        </Text>
        {hasData ? (
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
  );
}

function ConversationsCard({ conversations, maxDisplay = LIMITS.MAX_CONVERSATIONS_DISPLAY }) {
  const conversationRows = conversations
    .slice(0, maxDisplay)
    .map((c) => [c.createdAt, c.messageCount, c.preview, c.assistantPreview]);

  const hasConversations = conversationRows.length > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Conversations récentes
        </Text>
        {hasConversations ? (
          <DataTable
            columnContentTypes={["text", "numeric", "text", "text"]}
            headings={["Date", "Messages", "Aperçu", "Réponse du chatbot"]}
            rows={conversationRows}
          />
        ) : (
          <Text as="p" tone="subdued">
            Aucune conversation
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function QuestionsCard({ questions, maxDisplay = LIMITS.MAX_QUESTIONS_DISPLAY }) {
  const questionRows = questions
    .slice(0, maxDisplay)
    .map((q) => [q.date, q.content, q.assistantResponse]);

  const hasQuestions = questionRows.length > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">
          Questions récentes des utilisateurs
        </Text>
        {hasQuestions ? (
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Date", "Question", "Réponse du chatbot"]}
            rows={questionRows}
          />
        ) : (
          <Text as="p" tone="subdued">
            Aucune question pour cette période
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Dashboard() {
  const { stats, userQuestions, intentCounts, recentConversations } = useLoaderData();

  return (
    <Page>
      <TitleBar title="Dashboard Chat VADF" />
      <BlockStack gap="500">  
        {/* Intent analysis and conversations */}
        <Layout>
          <Layout.Section>
            <IntentAnalysisCard
              intentCounts={intentCounts}
              totalUserMessages={stats.userMessages}
            />
          </Layout.Section>
          <Layout.Section>
            <ConversationsCard conversations={recentConversations} />
          </Layout.Section>
        </Layout>

        {/* Recent questions */}
        <QuestionsCard questions={userQuestions} />
      </BlockStack>
    </Page>
  );
}
