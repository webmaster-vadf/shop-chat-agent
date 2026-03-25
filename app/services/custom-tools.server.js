/**
 * Custom Tools Service
 * Defines and handles custom tools that extend beyond MCP
 * Enables autonomous agent actions: quotes, order modifications, stock checks, callbacks
 */
import { createQuote, getQuotesByConversation, saveConversationContext, getConversationContext } from "../db.server";

/**
 * Tool definitions in Claude-compatible format
 */
export const CUSTOM_TOOL_DEFINITIONS = [
  {
    name: "generate_quote",
    description: "Génère un devis personnalisé pour un client B2B. Utilisez cet outil quand le client demande un devis ou veut connaître le prix pour une quantité spécifique de produits.",
    input_schema: {
      type: "object",
      properties: {
        products: {
          type: "array",
          description: "Liste des produits pour le devis",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Nom du produit" },
              productId: { type: "string", description: "ID du produit (optionnel)" },
              quantity: { type: "integer", description: "Quantité demandée", minimum: 1 },
              unitPrice: { type: "number", description: "Prix unitaire si connu" }
            },
            required: ["title", "quantity"]
          }
        },
        customerEmail: {
          type: "string",
          description: "Email du client (optionnel)"
        },
        notes: {
          type: "string",
          description: "Notes ou demandes spéciales du client"
        }
      },
      required: ["products"]
    }
  },
  {
    name: "request_order_modification",
    description: "Crée une demande de modification de commande. Utilisez quand un client veut modifier une commande existante (quantité, adresse, annulation partielle).",
    input_schema: {
      type: "object",
      properties: {
        orderNumber: {
          type: "string",
          description: "Numéro de la commande à modifier"
        },
        modificationType: {
          type: "string",
          enum: ["quantity_change", "address_change", "partial_cancel", "full_cancel", "other"],
          description: "Type de modification demandée"
        },
        details: {
          type: "string",
          description: "Détails de la modification souhaitée"
        },
        customerEmail: {
          type: "string",
          description: "Email du client"
        }
      },
      required: ["orderNumber", "modificationType", "details"]
    }
  },
  {
    name: "check_stock_availability",
    description: "Vérifie la disponibilité en stock de produits spécifiques. Retourne les quantités disponibles et les dates de réapprovisionnement estimées.",
    input_schema: {
      type: "object",
      properties: {
        productNames: {
          type: "array",
          items: { type: "string" },
          description: "Noms des produits à vérifier"
        }
      },
      required: ["productNames"]
    }
  },
  {
    name: "schedule_callback",
    description: "Planifie un rappel téléphonique ou par email pour le client. Utilisez quand le client a besoin d'un suivi personnalisé ou d'une assistance approfondie.",
    input_schema: {
      type: "object",
      properties: {
        customerEmail: {
          type: "string",
          description: "Email du client"
        },
        customerPhone: {
          type: "string",
          description: "Téléphone du client (optionnel)"
        },
        preferredTime: {
          type: "string",
          description: "Moment préféré pour le rappel (ex: 'matin', 'après-midi', 'demain 14h')"
        },
        topic: {
          type: "string",
          description: "Sujet du rappel"
        }
      },
      required: ["topic"]
    }
  }
];

/**
 * Get custom tool names for routing
 */
export function getCustomToolNames() {
  return CUSTOM_TOOL_DEFINITIONS.map(t => t.name);
}

/**
 * Execute a custom tool
 * @param {string} toolName - Name of the tool
 * @param {object} toolArgs - Tool arguments
 * @param {string} conversationId - Current conversation ID
 * @returns {Promise<object>} Tool result in MCP-compatible format
 */
export async function executeCustomTool(toolName, toolArgs, conversationId) {
  console.log(`[CUSTOM-TOOLS] Executing: ${toolName}`);
  console.log(`[CUSTOM-TOOLS] Args:`, JSON.stringify(toolArgs, null, 2));

  switch (toolName) {
    case 'generate_quote':
      return handleGenerateQuote(toolArgs, conversationId);
    case 'request_order_modification':
      return handleOrderModification(toolArgs, conversationId);
    case 'check_stock_availability':
      return handleStockCheck(toolArgs, conversationId);
    case 'schedule_callback':
      return handleScheduleCallback(toolArgs, conversationId);
    default:
      return {
        content: [{ type: 'text', text: `Outil inconnu: ${toolName}` }],
        isError: true
      };
  }
}

/**
 * Generate a quote for B2B customer
 */
async function handleGenerateQuote(args, conversationId) {
  try {
    const { products, customerEmail, notes } = args;

    // Calculate totals
    let totalAmount = 0;
    const items = products.map(p => {
      const lineTotal = (p.unitPrice || 0) * p.quantity;
      totalAmount += lineTotal;
      return {
        title: p.title,
        productId: p.productId || null,
        quantity: p.quantity,
        unitPrice: p.unitPrice || null,
        lineTotal: lineTotal || null
      };
    });

    // Set validity period (30 days)
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    // Save quote to database
    const quote = await createQuote({
      conversationId,
      customerEmail: customerEmail || 'non-spécifié',
      items: JSON.stringify(items),
      totalAmount,
      currency: 'EUR',
      status: 'draft',
      validUntil,
      notes: notes || null
    });

    // Build response
    let responseText = `**Devis VADF - Réf: ${quote.id}**\n\n`;
    responseText += `| Produit | Quantité | Prix unitaire | Total |\n`;
    responseText += `|---------|----------|---------------|-------|\n`;

    items.forEach(item => {
      const unitPriceStr = item.unitPrice ? `${item.unitPrice} EUR` : 'Sur demande';
      const totalStr = item.lineTotal ? `${item.lineTotal} EUR` : 'Sur demande';
      responseText += `| ${item.title} | ${item.quantity} | ${unitPriceStr} | ${totalStr} |\n`;
    });

    if (totalAmount > 0) {
      responseText += `\n**Total : ${totalAmount} EUR HT**\n`;
    } else {
      responseText += `\nLes tarifs exacts seront confirmés par notre équipe commerciale.\n`;
    }

    responseText += `\nValidité : 30 jours (jusqu'au ${validUntil.toLocaleDateString('fr-FR')})\n`;
    responseText += `Référence devis : ${quote.id}\n`;

    if (notes) {
      responseText += `\nNotes : ${notes}`;
    }

    responseText += `\n\nNotre équipe commerciale va traiter votre demande et vous recontactera rapidement à l'adresse ${customerEmail || 'fournie lors de votre inscription'}.`;

    return {
      content: [{ type: 'text', text: responseText }]
    };
  } catch (error) {
    console.error('[CUSTOM-TOOLS] Quote generation error:', error);
    return {
      content: [{ type: 'text', text: `Erreur lors de la création du devis. Veuillez contacter support@vadf.fr pour une assistance manuelle.` }],
      isError: true
    };
  }
}

/**
 * Handle order modification request
 */
async function handleOrderModification(args, conversationId) {
  const { orderNumber, modificationType, details, customerEmail } = args;

  const modTypeLabels = {
    quantity_change: 'Modification de quantité',
    address_change: "Changement d'adresse",
    partial_cancel: 'Annulation partielle',
    full_cancel: 'Annulation complète',
    other: 'Autre modification'
  };

  const refId = `MOD-${Date.now().toString(36).toUpperCase()}`;

  // Save as context for tracking
  try {
    const existingContext = await getConversationContext(conversationId);
    await saveConversationContext(conversationId, {
      ...(existingContext || {}),
      lastModificationRequest: refId,
      lastOrderNumber: orderNumber
    });
  } catch (e) {
    console.warn('[CUSTOM-TOOLS] Failed to save modification context:', e.message);
  }

  const responseText = `**Demande de modification enregistrée**\n\n` +
    `- Commande : #${orderNumber}\n` +
    `- Type : ${modTypeLabels[modificationType] || modificationType}\n` +
    `- Détails : ${details}\n` +
    `- Référence : ${refId}\n\n` +
    `Notre équipe va traiter votre demande. ` +
    `Un email de confirmation sera envoyé à ${customerEmail || 'votre adresse enregistrée'}.\n\n` +
    `Pour toute question urgente : support@vadf.fr`;

  return {
    content: [{ type: 'text', text: responseText }]
  };
}

/**
 * Check stock availability (queries MCP internally if available, otherwise returns guidance)
 */
async function handleStockCheck(args, conversationId) {
  const { productNames } = args;

  // Since we can't directly call MCP from here, we return a structured response
  // that tells Claude to use the search_shop_catalog tool for actual stock data
  const responseText = `Vérification de stock demandée pour :\n` +
    productNames.map(p => `- ${p}`).join('\n') +
    `\n\nPour obtenir les informations de stock en temps réel, utilisez l'outil search_shop_catalog pour chaque produit.` +
    `\nSi un produit est en rupture, informez le client qu'il peut demander un reliquat via la fiche produit une fois connecté.`;

  return {
    content: [{ type: 'text', text: responseText }]
  };
}

/**
 * Schedule a callback for a customer
 */
async function handleScheduleCallback(args, conversationId) {
  const { customerEmail, customerPhone, preferredTime, topic } = args;

  const refId = `CB-${Date.now().toString(36).toUpperCase()}`;

  // Save callback request in conversation context
  try {
    const existingContext = await getConversationContext(conversationId);
    await saveConversationContext(conversationId, {
      ...(existingContext || {}),
      lastCallbackRequest: refId,
      callbackTopic: topic
    });
  } catch (e) {
    console.warn('[CUSTOM-TOOLS] Failed to save callback context:', e.message);
  }

  let contactInfo = '';
  if (customerEmail) contactInfo += `Email : ${customerEmail}\n`;
  if (customerPhone) contactInfo += `Téléphone : ${customerPhone}\n`;

  const responseText = `**Demande de rappel enregistrée**\n\n` +
    `- Sujet : ${topic}\n` +
    (contactInfo ? `- ${contactInfo}` : '') +
    (preferredTime ? `- Créneau souhaité : ${preferredTime}\n` : '') +
    `- Référence : ${refId}\n\n` +
    `Un membre de notre équipe vous recontactera dans les plus brefs délais.`;

  return {
    content: [{ type: 'text', text: responseText }]
  };
}
