import { authenticate } from "../shopify.server";
import db from "../db.server";
import { triggerCartAbandoned, triggerWelcome, triggerOrderUpdate } from "../services/proactive-engine.server";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Extract shopId from shop domain
  const shopId = shop;

  switch (topic) {
    case 'APP_UNINSTALLED':
      if (session) {
        await db.session.deleteMany({where: {shop}});
      }
      break;

    case 'CHECKOUTS_CREATE':
    case 'CHECKOUTS_UPDATE':
      // Trigger cart abandoned message (with delay from template)
      if (payload && payload.abandoned_checkout_url) {
        console.log(`[WEBHOOK] Abandoned checkout detected for ${shop}`);
        triggerCartAbandoned(shopId, payload).catch(e =>
          console.error('[WEBHOOK] Error triggering cart_abandoned:', e.message)
        );
      }
      break;

    case 'CUSTOMERS_CREATE':
      // Welcome message for new customers
      if (payload) {
        console.log(`[WEBHOOK] New customer created for ${shop}`);
        triggerWelcome(shopId, payload).catch(e =>
          console.error('[WEBHOOK] Error triggering welcome:', e.message)
        );
      }
      break;

    case 'ORDERS_FULFILLED':
      // Order fulfillment update
      if (payload) {
        console.log(`[WEBHOOK] Order fulfilled for ${shop}`);
        triggerOrderUpdate(shopId, { ...payload, fulfillment_status: 'expédiée' }).catch(e =>
          console.error('[WEBHOOK] Error triggering order_update:', e.message)
        );
      }
      break;

    case 'ORDERS_CANCELLED':
      // Order cancellation update
      if (payload) {
        console.log(`[WEBHOOK] Order cancelled for ${shop}`);
        triggerOrderUpdate(shopId, { ...payload, fulfillment_status: 'annulée' }).catch(e =>
          console.error('[WEBHOOK] Error triggering order_update:', e.message)
        );
      }
      break;

    default:
      throw new Response('Unhandled webhook topic', {status: 404});
  }

  return new Response();
};
