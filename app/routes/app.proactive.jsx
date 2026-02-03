import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  DataTable,
  TextField,
  Select,
  Button,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getTemplates,
  upsertTemplate,
  deleteTemplate,
  getProactiveStats,
  seedDefaultTemplates,
} from "../services/proactive-engine.server";

// ============================================================================
// LOADER
// ============================================================================

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Seed defaults if needed
  await seedDefaultTemplates();

  const [templates, stats] = await Promise.all([
    getTemplates(),
    getProactiveStats(null),
  ]);

  return json({
    templates: templates.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    stats,
  });
};

// ============================================================================
// ACTION
// ============================================================================

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "upsert") {
    await upsertTemplate({
      triggerType: formData.get("triggerType"),
      templateText: formData.get("templateText"),
      delayMinutes: parseInt(formData.get("delayMinutes") || "0", 10),
      isActive: formData.get("isActive") === "true",
    });
  } else if (actionType === "delete") {
    await deleteTemplate(formData.get("id"));
  }

  return json({ ok: true });
};

// ============================================================================
// COMPONENTS
// ============================================================================

const TRIGGER_TYPE_LABELS = {
  cart_abandoned: "Panier abandonn\u00e9",
  welcome: "Bienvenue",
  order_update: "Mise \u00e0 jour commande",
  inactive_reminder: "Relance inactif",
};

function StatsHeader({ stats }) {
  return (
    <InlineGrid columns={{ xs: 2, md: 5 }} gap="400">
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">Total</Text>
          <Text variant="heading2xl" as="p">{stats.total}</Text>
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">En attente</Text>
          <Text variant="heading2xl" as="p">{stats.pending}</Text>
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">Envoy\u00e9s</Text>
          <Text variant="heading2xl" as="p">{stats.sent}</Text>
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">D\u00e9livr\u00e9s</Text>
          <Text variant="heading2xl" as="p" tone="success">{stats.delivered}</Text>
        </BlockStack>
      </Card>
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">\u00c9chou\u00e9s</Text>
          <Text variant="heading2xl" as="p" tone="critical">{stats.failed}</Text>
        </BlockStack>
      </Card>
    </InlineGrid>
  );
}

function TemplateEditor({ template, onSave, onDelete }) {
  const [text, setText] = useState(template.templateText);
  const [delay, setDelay] = useState(String(template.delayMinutes));
  const [active, setActive] = useState(template.isActive ? "true" : "false");
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "upsert");
    formData.set("triggerType", template.triggerType);
    formData.set("templateText", text);
    formData.set("delayMinutes", delay);
    formData.set("isActive", active);
    submit(formData, { method: "post" });
  }, [text, delay, active, template.triggerType, submit]);

  const handleDelete = useCallback(() => {
    if (!confirm("Supprimer ce template ?")) return;
    const formData = new FormData();
    formData.set("_action", "delete");
    formData.set("id", template.id);
    submit(formData, { method: "post" });
  }, [template.id, submit]);

  const triggerLabel =
    TRIGGER_TYPE_LABELS[template.triggerType] || template.triggerType;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text variant="headingMd" as="h2">
            {triggerLabel}
          </Text>
          <Select
            label="Statut"
            labelHidden
            options={[
              { label: "Actif", value: "true" },
              { label: "Inactif", value: "false" },
            ]}
            value={active}
            onChange={setActive}
          />
        </InlineStack>

        <TextField
          label="Texte du message"
          value={text}
          onChange={setText}
          multiline={4}
          helpText="Variables disponibles : {{customerName}}, {{companyName}}, {{totalPrice}}, {{currency}}, {{orderNumber}}, {{status}}"
          autoComplete="off"
        />

        <TextField
          label="D\u00e9lai (minutes)"
          value={delay}
          onChange={setDelay}
          type="number"
          helpText="Temps d'attente avant envoi (ex: 30 min pour panier abandonn\u00e9)"
          autoComplete="off"
        />

        <InlineStack gap="300">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>
            Enregistrer
          </Button>
          <Button tone="critical" onClick={handleDelete}>
            Supprimer
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function RecentMessagesTable({ messages }) {
  if (!messages || messages.length === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text variant="headingMd" as="h2">Messages r\u00e9cents</Text>
          <Text as="p" tone="subdued">Aucun message proactif envoy\u00e9</Text>
        </BlockStack>
      </Card>
    );
  }

  const rows = messages.map((m) => [
    new Date(m.createdAt).toLocaleString("fr-FR"),
    TRIGGER_TYPE_LABELS[m.triggerType] || m.triggerType,
    m.customerEmail || "-",
    m.status,
    (m.messageContent || "").substring(0, 80),
  ]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingMd" as="h2">Messages r\u00e9cents</Text>
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={["Date", "Type", "Email", "Statut", "Contenu"]}
          rows={rows}
        />
      </BlockStack>
    </Card>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ProactiveAdmin() {
  const { templates, stats } = useLoaderData();

  return (
    <Page>
      <TitleBar title="Messagerie Proactive" />
      <BlockStack gap="500">
        <Banner tone="info">
          Les messages proactifs sont envoy\u00e9s automatiquement aux clients
          lors d'\u00e9v\u00e9nements cl\u00e9s : panier abandonn\u00e9, inscription, mise \u00e0 jour
          de commande. Configurez les templates ci-dessous.
        </Banner>

        {/* Stats */}
        <StatsHeader stats={stats} />

        <Divider />

        {/* Templates */}
        <Text variant="headingLg" as="h2">Templates de messages</Text>
        <Layout>
          {templates.map((template) => (
            <Layout.Section key={template.id}>
              <TemplateEditor template={template} />
            </Layout.Section>
          ))}
        </Layout>

        <Divider />

        {/* Recent messages log */}
        <RecentMessagesTable messages={stats.recentMessages} />
      </BlockStack>
    </Page>
  );
}
