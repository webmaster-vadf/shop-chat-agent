import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getChatStats, getRecentConversations } from "../db.server";
import prisma from "../db.server";

// Constants
const PERIODS = {
  day: 1,
  week: 7,
  month: 30,
  all: Infinity,
};

const MAX_QUESTIONS = 50;
const MAX_USER_CONTENT = 200;
const MAX_ASSISTANT_CONTENT = 300;
const MAX_PREVIEW_LENGTH = 100;

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

// Helper functions
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
  return content ? content.substring(0, MAX_ASSISTANT_CONTENT) : "-";
}

async function formatUserQuestion(msg) {
  const content = extractTextContent(msg.content);
  if (!content) return null;

  const assistantResponse = await getAssistantResponse(msg.conversationId, msg.createdAt);

  return {
    content: content.substring(0, MAX_USER_CONTENT),
    date: new Date(msg.createdAt).toLocaleString("fr-FR"),
    conversationId: msg.conversationId,
    assistantResponse,
  };
}

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

function formatConversationPreview(conversation) {
  const preview = conversation.messages
    .filter((m) => m.role === "user")
    .map((m) => extractTextContent(m.content) || m.content)
    .join(" | ");

  return {
    id: conversation.id,
    messageCount: conversation.messages.length,
    createdAt: new Date(conversation.createdAt).toLocaleString("fr-FR"),
    updatedAt: new Date(conversation.updatedAt).toLocaleString("fr-FR"),
    preview: preview.substring(0, MAX_PREVIEW_LENGTH),
  };
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "week";

  const { startDate, endDate } = calculateDateRange(period);
  const [stats, recentConversations] = await Promise.all([
    getChatStats(startDate, endDate),
    getRecentConversations(30),
  ]);

  const userQuestions = await Promise.all(
    stats.allUserMessages.slice(0, MAX_QUESTIONS).map(formatUserQuestion)
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

// UI Components
const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f6f7; color: #202223; padding: 20px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { margin-bottom: 20px; }
  .section { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
  .section h2 { margin-bottom: 16px; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e1e3e5; overflow-wrap: break-word; }
  th { background: #f6f6f7; font-weight: 600; }
  tr:hover { background: #fafbfb; }
  th:nth-child(1), td:nth-child(1) { width: 150px; }
  th:nth-child(2), td:nth-child(2) { width: 35%; }
  th:nth-child(3), td:nth-child(3) { width: 50%; }
  .empty { color: #6d7175; font-style: italic; }
`;

function IntentAnalysisTable({ intentCounts, totalUserMessages }) {
  const intentRows = Object.entries(intentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (intentRows.length === 0) {
    return <p className="empty">Aucune donnée pour cette période</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Catégorie</th>
          <th>Nombre</th>
          <th>Pourcentage</th>
        </tr>
      </thead>
      <tbody>
        {intentRows.map(([intent, count]) => (
          <tr key={intent}>
            <td>{intent}</td>
            <td>{count}</td>
            <td>{Math.round((count / totalUserMessages) * 100) || 0}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuestionsTable({ questions, maxDisplay = 30 }) {
  if (questions.length === 0) {
    return <p className="empty">Aucune question pour cette période</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Question</th>
          <th>Réponse du chatbot</th>
        </tr>
      </thead>
      <tbody>
        {questions.slice(0, maxDisplay).map((q, i) => (
          <tr key={q.conversationId + i}>
            <td style={{ whiteSpace: "nowrap" }}>{q.date}</td>
            <td>{q.content}</td>
            <td>{q.assistantResponse}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Stats() {
  const { stats, userQuestions, intentCounts } = useLoaderData();

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Dashboard Chat VADF</title>
        <style>{styles}</style>
      </head>
      <body>
        <div className="container">
          <h1>Dashboard Chat VADF</h1>

          <div className="section">
            <h2>Analyse des intentions</h2>
            <IntentAnalysisTable
              intentCounts={intentCounts}
              totalUserMessages={stats.userMessages}
            />
          </div>

          <div className="section">
            <h2>Questions récentes des utilisateurs</h2>
            <QuestionsTable questions={userQuestions} />
          </div>
        </div>
      </body>
    </html>
  );
}
