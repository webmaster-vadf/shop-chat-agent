import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getChatStats, getRecentConversations } from "../db.server";

export const loader = async ({ request }) => {
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
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const textBlocks = parsed.filter((b) => b.type === "text");
          if (textBlocks.length > 0) {
            content = textBlocks.map((b) => b.text).join(" ");
          } else {
            return null;
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

  // Analyze intents
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

export default function Stats() {
  const { stats, userQuestions, intentCounts, recentConversations, period } = useLoaderData();

  const intentRows = Object.entries(intentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Dashboard Chat VADF</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f6f6f7; color: #202223; padding: 20px; }
          .container { max-width: 1200px; margin: 0 auto; }
          h1 { margin-bottom: 20px; }
          .period-select { margin-bottom: 20px; padding: 10px; font-size: 16px; border-radius: 8px; border: 1px solid #ccc; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
          .stat-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .stat-card h3 { font-size: 14px; color: #6d7175; margin-bottom: 8px; }
          .stat-card .value { font-size: 32px; font-weight: 600; }
          .section { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
          .section h2 { margin-bottom: 16px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e1e3e5; }
          th { background: #f6f6f7; font-weight: 600; }
          tr:hover { background: #fafbfb; }
          .intent-bar { display: flex; align-items: center; gap: 10px; }
          .intent-bar .bar { height: 20px; background: #008060; border-radius: 4px; }
          .empty { color: #6d7175; font-style: italic; }
        `}</style>
      </head>
      <body>
        <div className="container">
          <h1>Dashboard Chat VADF</h1>

          <select
            className="period-select"
            value={period}
            onChange={(e) => window.location.href = `/stats?period=${e.target.value}`}
          >
            <option value="day">Dernières 24h</option>
            <option value="week">7 derniers jours</option>
            <option value="month">30 derniers jours</option>
            <option value="all">Tout</option>
          </select>

          <div className="stats-grid">
            <div className="stat-card">
              <h3>Conversations</h3>
              <div className="value">{stats.totalConversations}</div>
            </div>
            <div className="stat-card">
              <h3>Messages totaux</h3>
              <div className="value">{stats.totalMessages}</div>
            </div>
            <div className="stat-card">
              <h3>Questions utilisateurs</h3>
              <div className="value">{stats.userMessages}</div>
            </div>
            <div className="stat-card">
              <h3>Réponses assistant</h3>
              <div className="value">{stats.assistantMessages}</div>
            </div>
          </div>

          <div className="section">
            <h2>Analyse des intentions</h2>
            {intentRows.length > 0 ? (
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
                      <td>{Math.round((count / stats.userMessages) * 100) || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">Aucune donnée pour cette période</p>
            )}
          </div>

          <div className="section">
            <h2>Conversations récentes</h2>
            {recentConversations.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Messages</th>
                    <th>Aperçu</th>
                  </tr>
                </thead>
                <tbody>
                  {recentConversations.slice(0, 10).map((c) => (
                    <tr key={c.id}>
                      <td>{c.createdAt}</td>
                      <td>{c.messageCount}</td>
                      <td>{c.preview || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">Aucune conversation</p>
            )}
          </div>

          <div className="section">
            <h2>Questions récentes des utilisateurs</h2>
            {userQuestions.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Question</th>
                  </tr>
                </thead>
                <tbody>
                  {userQuestions.slice(0, 30).map((q, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{q.date}</td>
                      <td>{q.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">Aucune question pour cette période</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
