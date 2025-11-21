import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { getChatStats } from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Get ALL data from Sept 9, 2025 at 12:43 (all shops)
  const startDate = new Date('2025-09-09T12:43:00');
  const endDate = new Date();

  const stats = await getChatStats(startDate, endDate);

  // Extract plain text from user messages - sorted by date ascending (oldest first)
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
        timestamp: new Date(msg.createdAt).getTime(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp) // Sort ascending by date (oldest first)
    .slice(0, 100);

  return json({ userQuestions });
};

export default function Dashboard() {
  const { userQuestions } = useLoaderData();

  // Prepare questions table - already sorted by date descending
  const questionRows = userQuestions.map((q) => [q.date, q.content]);

  return (
    <Page>
      <TitleBar title="Dashboard Chat VADF" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Questions récentes des utilisateurs
            </Text>
            {questionRows.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Date", "Question"]}
                rows={questionRows}
              />
            ) : (
              <Text as="p" tone="subdued">
                Aucune question
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
