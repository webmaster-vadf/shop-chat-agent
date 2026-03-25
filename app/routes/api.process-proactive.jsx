/**
 * Proactive Message Processor
 * Called periodically (cron) to process pending proactive messages
 *
 * Usage: GET /api/process-proactive?secret=<PROACTIVE_PROCESSOR_SECRET>
 * Can be triggered by Fly.io scheduled machines, external cron, or setInterval
 */
import { json } from "@remix-run/node";
import { processScheduledMessages, seedDefaultTemplates } from "../services/proactive-engine.server";
import { getProactiveMessagesForCustomer, getProactiveMessagesForConversation } from "../services/proactive-engine.server";

export async function loader({ request }) {
  const url = new URL(request.url);

  // Proactive message polling endpoint for frontend
  // GET /api/process-proactive?poll=true&conversation_id=X
  if (url.searchParams.has('poll')) {
    const conversationId = url.searchParams.get('conversation_id');
    const customerEmail = url.searchParams.get('customer_email');
    const shopId = url.searchParams.get('shop_id');

    let messages = [];
    if (conversationId) {
      messages = await getProactiveMessagesForConversation(conversationId);
    } else if (customerEmail && shopId) {
      messages = await getProactiveMessagesForCustomer(shopId, customerEmail);
    }

    return json({ messages }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Cron processing endpoint
  // GET /api/process-proactive?secret=<secret>
  const secret = url.searchParams.get('secret');
  const expectedSecret = process.env.PROACTIVE_PROCESSOR_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Seed default templates on first run
  await seedDefaultTemplates();

  // Process pending messages
  const result = await processScheduledMessages(10);

  console.log(`[PROACTIVE-CRON] Processed: ${result.processed}, Failed: ${result.failed}`);

  return json({
    ok: true,
    processed: result.processed,
    failed: result.failed,
    timestamp: new Date().toISOString()
  });
}
