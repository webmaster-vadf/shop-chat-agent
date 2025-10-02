import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";
import React, { useState } from "react";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();
  // Exemple d'ID de conversation et shop, à adapter selon votre logique
  const [conversationId] = useState("demo-conv-001");
  const [shopId] = useState("demo-shop.myshopify.com");

  function CustomerLoginButton({ conversationId, shopId }) {
    const handleLogin = () => {
      window.location.href = `/auth.customer?conversation_id=${conversationId}&shop_id=${shopId}`;
    };
    return (
      <button onClick={handleLogin} style={{marginTop:20}}>
        Se connecter à son compte client
      </button>
    );
  }

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Shop chat agent reference app</h1>
        <p className={styles.text}>
          A reference app for shop chat agent.
        </p>
        {/* Bouton de login client intégré dans l'interface chat */}
        <CustomerLoginButton conversationId={conversationId} shopId={shopId} />
      </div>
    </div>
  );
}
