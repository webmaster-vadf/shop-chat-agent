/**
 * Feedback API Route
 * Receives thumbs up/down feedback from storefront chat widget
 */
import { json } from "@remix-run/node";
import { saveFeedback, getFeedbackByConversation } from "../db.server";
import { trackEvent } from "../db.server";

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Shopify-Shop-Id",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation_id");

  if (!conversationId) {
    return json({ error: "conversation_id required" }, { status: 400, headers: getCorsHeaders(request) });
  }

  const feedback = await getFeedbackByConversation(conversationId);
  return json({ feedback }, { headers: getCorsHeaders(request) });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  try {
    const body = await request.json();
    const { conversation_id, message_id, rating, comment } = body;
    const shopId = request.headers.get("X-Shopify-Shop-Id");

    if (!conversation_id || !rating) {
      return json(
        { error: "conversation_id and rating (up/down) are required" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    if (rating !== 'up' && rating !== 'down') {
      return json(
        { error: "rating must be 'up' or 'down'" },
        { status: 400, headers: getCorsHeaders(request) }
      );
    }

    const feedback = await saveFeedback({
      conversationId: conversation_id,
      messageId: message_id || null,
      shopId,
      rating,
      comment: comment || null,
    });

    // Track feedback event
    trackEvent(conversation_id, shopId, 'feedback_submitted', {
      rating,
      hasComment: !!comment,
      messageId: message_id || null
    });

    return json({ ok: true, id: feedback.id }, { headers: getCorsHeaders(request) });
  } catch (error) {
    console.error('[FEEDBACK] Error:', error);
    return json(
      { error: "Failed to save feedback" },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}
