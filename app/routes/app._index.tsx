import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, IndexTable, Button, EmptyState, Badge,
  Text, InlineStack, BlockStack, Thumbnail, Banner, Modal,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatMoney, calculateUnitPrice, calculateSavings } from "../utils/pricing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const packs = await prisma.packConfig.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
  });

  return json({ packs });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const packId = formData.get("packId") as string;
    await prisma.packConfig.delete({
      where: { id: packId },
    });
    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function Index() {
  const { packs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("packId", deleteTarget);
    submit(formData, { method: "post" });
    setDeleteTarget(null);
  }, [deleteTarget, submit]);

  const resourceName = { singular: "pack", plural: "packs" };

  const rowMarkup = packs.map((pack: any, index: number) => {
    const unitPrice = calculateUnitPrice(pack.packPrice, pack.unitsPerPack);

    return (
      <IndexTable.Row id={pack.id} key={pack.id} position={index}>
        <IndexTable.Cell>
          <Button variant="plain" onClick={() => navigate(`/app/packs/${pack.id}`)}>
            {pack.packProductTitle}
          </Button>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued">{pack.baseProductTitle}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge>{`${pack.unitsPerPack} units`}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{pack.packSku || "—"}</IndexTable.Cell>
        <IndexTable.Cell>{formatMoney(pack.packPrice)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="success" fontWeight="semibold">
            {formatMoney(unitPrice)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button size="slim" onClick={() => navigate(`/app/packs/${pack.id}`)}>
              Edit
            </Button>
            <Button size="slim" tone="critical" onClick={() => setDeleteTarget(pack.id)}>
              Remove
            </Button>
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Pack Pricing"
      subtitle="Manage case & multi-pack pricing for your products"
      primaryAction={{
        content: "Create Pack",
        onAction: () => navigate("/app/packs/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          {packs.length === 0 ? (
            <Card>
              <EmptyState
                heading="No packs configured yet"
                action={{
                  content: "Create your first pack",
                  onAction: () => navigate("/app/packs/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Create multi-packs and cases for your products. Set pack sizes,
                  pricing, and let customers choose between single units and bulk options.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={packs.length}
                headings={[
                  { title: "Pack Product" },
                  { title: "Base Product" },
                  { title: "Pack Size" },
                  { title: "SKU" },
                  { title: "Pack Price" },
                  { title: "Unit Price" },
                  { title: "Actions" },
                ]}
                selectable={false}
                loading={isLoading}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">How it works</Text>
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  <strong>1.</strong> Pick a base product (the single unit).
                </Text>
                <Text as="p" tone="subdued">
                  <strong>2.</strong> Choose or create a pack product (e.g., "12-Pack").
                </Text>
                <Text as="p" tone="subdued">
                  <strong>3.</strong> Set units per pack, price, SKU, and barcode.
                </Text>
                <Text as="p" tone="subdued">
                  <strong>4.</strong> Unit price is calculated automatically.
                </Text>
                <Text as="p" tone="subdued">
                  <strong>5.</strong> Inventory stays in sync — selling a pack adjusts base stock.
                </Text>
                <Text as="p" tone="subdued">
                  <strong>6.</strong> Add the widget to your theme to let customers switch options.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {deleteTarget && (
        <Modal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title="Remove pack configuration?"
          primaryAction={{
            content: "Remove",
            destructive: true,
            onAction: handleDelete,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setDeleteTarget(null) },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              This removes the pack link. The pack product itself will not be deleted from your store.
            </Text>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
