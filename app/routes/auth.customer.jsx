import { redirect } from "@remix-run/node";

/**
 * Route d'initiation de l'authentification client (OAuth)
 * Redirige le client vers l'URL d'autorisation Shopify Customer API
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation_id");
  const shopId = url.searchParams.get("shop_id");

  if (!conversationId || !shopId) {
    return new Response("Missing conversation_id or shop_id", { status: 400 });
  }

  // Générer l'URL d'autorisation OAuth client
  const clientId = process.env.SHOPIFY_CUSTOMER_API_CLIENT_ID;
  const redirectUri = `${url.origin}/auth.callback`;
  const state = `${conversationId}-${shopId}`;
  const scopes = "openid email profile phone";

  const authUrl = `https://${shopId}/auth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;

  return redirect(authUrl);
}
