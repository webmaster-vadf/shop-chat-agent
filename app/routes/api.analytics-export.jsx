/**
 * Analytics Export API
 * Streams CSV data for analytics export
 */
import { authenticate } from "../shopify.server";
import { getExportData } from "../services/analytics.server";

const PERIODS = {
  day: 1,
  week: 7,
  month: 30,
  all: Infinity,
};

function calculateDateRange(period) {
  const endDate = new Date();
  const startDate = new Date();
  const days = PERIODS[period] || PERIODS.week;
  if (days === Infinity) return { startDate: new Date(0), endDate };
  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate };
}

function escapeCsvField(field) {
  if (field == null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(row, headers) {
  return headers.map(h => escapeCsvField(row[h])).join(',');
}

export async function loader({ request }) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "week";
  const { startDate, endDate } = calculateDateRange(period);

  const data = await getExportData(null, startDate, endDate);

  const headers = [
    'date',
    'conversationId',
    'role',
    'message',
    'intent',
    'sentiment',
    'sentimentScore',
    'outcome',
    'toolsUsed'
  ];

  const headerLabels = [
    'Date',
    'Conversation ID',
    'Role',
    'Message',
    'Intent',
    'Sentiment',
    'Score Sentiment',
    'Outcome',
    'Outils Utilisés'
  ];

  // BOM for Excel UTF-8 compatibility
  const bom = '\uFEFF';
  const csvHeader = headerLabels.join(',');
  const csvRows = data.map(row => rowToCsv(row, headers));
  const csvContent = bom + csvHeader + '\n' + csvRows.join('\n');

  const filename = `vadf-analytics-${period}-${new Date().toISOString().split('T')[0]}.csv`;

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    }
  });
}
