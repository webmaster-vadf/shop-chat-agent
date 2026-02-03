/**
 * Proactive Messaging Engine
 * Schedules and processes proactive messages to customers
 */
import prisma from "../db.server";

// ============================================================================
// Message Scheduling
// ============================================================================

/**
 * Schedule a proactive message
 * @param {object} params
 * @param {string} params.shopId - Shop ID
 * @param {string} params.customerEmail - Customer email (optional)
 * @param {string} params.conversationId - Existing conversation ID (optional)
 * @param {string} params.triggerType - Trigger type (cart_abandoned, welcome, order_update, inactive_reminder)
 * @param {object} params.triggerData - Trigger context data
 * @param {string} params.messageContent - Message content
 * @param {number} params.delayMinutes - Delay before sending (default 0)
 * @returns {Promise<object>}
 */
export async function scheduleProactiveMessage({
  shopId,
  customerEmail,
  conversationId,
  triggerType,
  triggerData,
  messageContent,
  delayMinutes = 0
}) {
  const scheduledFor = new Date();
  scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes);

  try {
    return await prisma.proactiveMessage.create({
      data: {
        shopId,
        customerEmail: customerEmail || null,
        conversationId: conversationId || null,
        triggerType,
        triggerData: triggerData ? JSON.stringify(triggerData) : null,
        messageContent,
        status: 'pending',
        scheduledFor
      }
    });
  } catch (error) {
    console.error('[PROACTIVE] Error scheduling message:', error.message);
    throw error;
  }
}

/**
 * Schedule a message using a template
 * @param {string} triggerType
 * @param {object} params - shopId, customerEmail, conversationId, triggerData, variables
 * @returns {Promise<object|null>}
 */
export async function scheduleFromTemplate(triggerType, params) {
  try {
    const template = await prisma.proactiveTemplate.findUnique({
      where: { triggerType }
    });

    if (!template || !template.isActive) {
      console.log(`[PROACTIVE] No active template for trigger: ${triggerType}`);
      return null;
    }

    // Replace variables in template text
    let messageContent = template.templateText;
    if (params.variables) {
      Object.entries(params.variables).forEach(([key, value]) => {
        messageContent = messageContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
      });
    }

    return await scheduleProactiveMessage({
      shopId: params.shopId,
      customerEmail: params.customerEmail,
      conversationId: params.conversationId,
      triggerType,
      triggerData: params.triggerData,
      messageContent,
      delayMinutes: template.delayMinutes
    });
  } catch (error) {
    console.error('[PROACTIVE] Error scheduling from template:', error.message);
    return null;
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process pending scheduled messages
 * @param {number} limit - Max messages to process per run
 * @returns {Promise<{processed: number, failed: number}>}
 */
export async function processScheduledMessages(limit = 10) {
  const now = new Date();
  let processed = 0;
  let failed = 0;

  try {
    const pendingMessages = await prisma.proactiveMessage.findMany({
      where: {
        status: 'pending',
        scheduledFor: { lte: now }
      },
      orderBy: { scheduledFor: 'asc' },
      take: limit
    });

    console.log(`[PROACTIVE] Found ${pendingMessages.length} pending messages to process`);

    for (const msg of pendingMessages) {
      try {
        // Mark as sent
        await prisma.proactiveMessage.update({
          where: { id: msg.id },
          data: {
            status: 'sent',
            sentAt: new Date()
          }
        });
        processed++;
        console.log(`[PROACTIVE] Processed message ${msg.id} (type: ${msg.triggerType})`);
      } catch (error) {
        console.error(`[PROACTIVE] Failed to process message ${msg.id}:`, error.message);
        await prisma.proactiveMessage.update({
          where: { id: msg.id },
          data: { status: 'failed' }
        }).catch(() => {});
        failed++;
      }
    }
  } catch (error) {
    console.error('[PROACTIVE] Error processing messages:', error.message);
  }

  return { processed, failed };
}

// ============================================================================
// Proactive Message Retrieval (for frontend polling)
// ============================================================================

/**
 * Get pending proactive messages for a customer
 * @param {string} shopId
 * @param {string} customerEmail
 * @returns {Promise<Array>}
 */
export async function getProactiveMessagesForCustomer(shopId, customerEmail) {
  try {
    const messages = await prisma.proactiveMessage.findMany({
      where: {
        shopId,
        customerEmail,
        status: 'sent',
        scheduledFor: { lte: new Date() }
      },
      orderBy: { sentAt: 'desc' },
      take: 5
    });

    // Mark as delivered
    if (messages.length > 0) {
      await prisma.proactiveMessage.updateMany({
        where: {
          id: { in: messages.map(m => m.id) }
        },
        data: { status: 'delivered' }
      });
    }

    return messages.map(m => ({
      id: m.id,
      triggerType: m.triggerType,
      messageContent: m.messageContent,
      sentAt: m.sentAt?.toISOString()
    }));
  } catch (error) {
    console.error('[PROACTIVE] Error getting messages:', error.message);
    return [];
  }
}

/**
 * Get pending proactive messages for a conversation
 * @param {string} conversationId
 * @returns {Promise<Array>}
 */
export async function getProactiveMessagesForConversation(conversationId) {
  try {
    const messages = await prisma.proactiveMessage.findMany({
      where: {
        conversationId,
        status: 'sent',
        scheduledFor: { lte: new Date() }
      },
      orderBy: { sentAt: 'desc' },
      take: 5
    });

    // Mark as delivered
    if (messages.length > 0) {
      await prisma.proactiveMessage.updateMany({
        where: {
          id: { in: messages.map(m => m.id) }
        },
        data: { status: 'delivered' }
      });
    }

    return messages.map(m => ({
      id: m.id,
      triggerType: m.triggerType,
      messageContent: m.messageContent,
      sentAt: m.sentAt?.toISOString()
    }));
  } catch (error) {
    console.error('[PROACTIVE] Error getting messages:', error.message);
    return [];
  }
}

// ============================================================================
// Webhook Trigger Handlers
// ============================================================================

/**
 * Handle abandoned checkout trigger
 * @param {string} shopId
 * @param {object} checkoutData
 */
export async function triggerCartAbandoned(shopId, checkoutData) {
  const email = checkoutData.email;
  if (!email) return;

  return scheduleFromTemplate('cart_abandoned', {
    shopId,
    customerEmail: email,
    triggerData: {
      checkoutId: checkoutData.id,
      totalPrice: checkoutData.total_price
    },
    variables: {
      customerName: checkoutData.billing_address?.first_name || 'Client',
      totalPrice: checkoutData.total_price || '0',
      currency: checkoutData.currency || 'EUR'
    }
  });
}

/**
 * Handle new customer welcome trigger
 * @param {string} shopId
 * @param {object} customerData
 */
export async function triggerWelcome(shopId, customerData) {
  const email = customerData.email;
  if (!email) return;

  return scheduleFromTemplate('welcome', {
    shopId,
    customerEmail: email,
    triggerData: { customerId: customerData.id },
    variables: {
      customerName: customerData.first_name || 'Client',
      companyName: customerData.company || ''
    }
  });
}

/**
 * Handle order status update trigger
 * @param {string} shopId
 * @param {object} orderData
 */
export async function triggerOrderUpdate(shopId, orderData) {
  const email = orderData.email || orderData.contact_email;
  if (!email) return;

  return scheduleFromTemplate('order_update', {
    shopId,
    customerEmail: email,
    triggerData: {
      orderId: orderData.id,
      orderNumber: orderData.order_number,
      status: orderData.fulfillment_status
    },
    variables: {
      orderNumber: String(orderData.order_number || ''),
      status: orderData.fulfillment_status || 'mise à jour',
      customerName: orderData.billing_address?.first_name || 'Client'
    }
  });
}

// ============================================================================
// Template Management (for admin)
// ============================================================================

/**
 * Get all proactive templates
 * @returns {Promise<Array>}
 */
export async function getTemplates() {
  return prisma.proactiveTemplate.findMany({
    orderBy: { triggerType: 'asc' }
  });
}

/**
 * Create or update a proactive template
 * @param {object} templateData
 * @returns {Promise<object>}
 */
export async function upsertTemplate(templateData) {
  return prisma.proactiveTemplate.upsert({
    where: { triggerType: templateData.triggerType },
    update: {
      templateText: templateData.templateText,
      delayMinutes: templateData.delayMinutes,
      isActive: templateData.isActive
    },
    create: templateData
  });
}

/**
 * Delete a proactive template
 * @param {string} id
 */
export async function deleteTemplate(id) {
  return prisma.proactiveTemplate.delete({ where: { id } });
}

/**
 * Get proactive message stats
 * @param {string} shopId
 * @returns {Promise<object>}
 */
export async function getProactiveStats(shopId) {
  const [total, sent, delivered, failed, pending] = await Promise.all([
    prisma.proactiveMessage.count({ where: shopId ? { shopId } : {} }),
    prisma.proactiveMessage.count({ where: { ...(shopId ? { shopId } : {}), status: 'sent' } }),
    prisma.proactiveMessage.count({ where: { ...(shopId ? { shopId } : {}), status: 'delivered' } }),
    prisma.proactiveMessage.count({ where: { ...(shopId ? { shopId } : {}), status: 'failed' } }),
    prisma.proactiveMessage.count({ where: { ...(shopId ? { shopId } : {}), status: 'pending' } })
  ]);

  const recentMessages = await prisma.proactiveMessage.findMany({
    where: shopId ? { shopId } : {},
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  return { total, sent, delivered, failed, pending, recentMessages };
}

/**
 * Seed default templates if none exist
 */
export async function seedDefaultTemplates() {
  const count = await prisma.proactiveTemplate.count();
  if (count > 0) return;

  const defaults = [
    {
      triggerType: 'cart_abandoned',
      templateText: 'Bonjour {{customerName}}, vous avez des articles dans votre panier pour un total de {{totalPrice}} {{currency}}. Souhaitez-vous finaliser votre commande ? Je peux vous aider si vous avez des questions.',
      delayMinutes: 30,
      isActive: true
    },
    {
      triggerType: 'welcome',
      templateText: 'Bienvenue chez VADF {{customerName}} ! Je suis votre assistant dédié. N\'hésitez pas à me poser vos questions sur nos produits éco-responsables, les tarifs professionnels ou la personnalisation.',
      delayMinutes: 0,
      isActive: true
    },
    {
      triggerType: 'order_update',
      templateText: 'Bonjour {{customerName}}, votre commande #{{orderNumber}} a été mise à jour : {{status}}. N\'hésitez pas si vous avez des questions.',
      delayMinutes: 0,
      isActive: true
    },
    {
      triggerType: 'inactive_reminder',
      templateText: 'Bonjour {{customerName}}, cela fait un moment que nous n\'avons pas eu de vos nouvelles. Découvrez nos nouveaux produits éco-responsables ! Des questions ? Je suis là pour vous aider.',
      delayMinutes: 0,
      isActive: false
    }
  ];

  for (const tmpl of defaults) {
    await prisma.proactiveTemplate.create({ data: tmpl });
  }
  console.log('[PROACTIVE] Default templates seeded');
}
