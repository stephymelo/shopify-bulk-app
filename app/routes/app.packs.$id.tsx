import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData, useNavigate, useSubmit, useNavigation, useActionData,
} from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page, Layout, Card, BlockStack, TextField, Button, Text,
  Banner, Divider, InlineStack, Badge, Thumbnail, FormLayout,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatMoney, calculateUnitPrice } from "../utils/pricing";
import { GET_PRODUCT, SET_METAFIELDS } from "../utils/graphql";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id || id === "new") {
    return json({ pack: null, isNew: true });
  }

  const pack = await prisma.packConfig.findUnique({ where: { id } });
  if (!pack) {
    return json({ pack: null, isNew: true });
  }

  return json({ pack, isNew: false });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const packId = formData.get("packId") as string | null;
  const baseProductId = formData.get("baseProductId") as string;
  const baseProductTitle = formData.get("baseProductTitle") as string;
  const packProductId = formData.get("packProductId") as string;
  const packProductTitle = formData.get("packProductTitle") as string;
  const unitsPerPack = parseInt(formData.get("unitsPerPack") as string, 10);
  const packSku = formData.get("packSku") as string;
  const packBarcode = formData.get("packBarcode") as string;
  const packPrice = parseFloat(formData.get("packPrice") as string);

  // Validation
  if (!baseProductId || !packProductId) {
    return json({ error: "Please select both a base product and a pack product." }, { status: 400 });
  }
  if (baseProductId === packProductId) {
    return json({ error: "Base product and pack product must be different." }, { status: 400 });
  }
  if (isNaN(unitsPerPack) || unitsPerPack <= 1) {
    return json({ error: "Units per pack must be greater than 1." }, { status: 400 });
  }
  if (isNaN(packPrice) || packPrice <= 0) {
    return json({ error: "Pack price must be a positive number." }, { status: 400 });
  }

  // Save metafields on pack product
  const metafieldsResponse = await admin.graphql(SET_METAFIELDS, {
    variables: {
      metafields: [
        {
          ownerId: packProductId,
          namespace: "pack_config",
          key: "base_product_id",
          value: baseProductId,
          type: "product_reference",
        },
        {
          ownerId: packProductId,
          namespace: "pack_config",
          key: "units_per_pack",
          value: String(unitsPerPack),
          type: "number_integer",
        },
        {
          ownerId: packProductId,
          namespace: "pack_config",
          key: "pack_price",
          value: String(packPrice),
          type: "single_line_text_field",
        },
      ],
    },
  });

  const mfData = await metafieldsResponse.json();
  const mfErrors = mfData.data?.metafieldsSet?.userErrors || [];
  if (mfErrors.length > 0) {
    return json({ error: mfErrors.map((e: any) => e.message).join(", ") }, { status: 400 });
  }

  // Update base product's pack list metafield
  const baseRes = await admin.graphql(GET_PRODUCT, {
    variables: { id: baseProductId },
  });
  const baseData = await baseRes.json();
  const existingPacksMf = (baseData.data?.product?.metafields?.edges || [])
    .find(({ node }: any) => node.key === "pack_products");

  let currentList: string[] = [];
  if (existingPacksMf) {
    try { currentList = JSON.parse(existingPacksMf.node.value || "[]"); } catch {}
  }
  if (!currentList.includes(packProductId)) {
    currentList.push(packProductId);
  }

  await admin.graphql(SET_METAFIELDS, {
    variables: {
      metafields: [{
        ownerId: baseProductId,
        namespace: "pack_config",
        key: "pack_products",
        value: JSON.stringify(currentList),
        type: "list.product_reference",
      }],
    },
  });

  // Upsert local DB record
  const data = {
    shop,
    baseProductId,
    baseProductTitle,
    packProductId,
    packProductTitle,
    unitsPerPack,
    packSku: packSku || null,
    packBarcode: packBarcode || null,
    packPrice,
  };

  if (packId) {
    await prisma.packConfig.update({ where: { id: packId }, data });
  } else {
    await prisma.packConfig.upsert({
      where: { shop_packProductId: { shop, packProductId } },
      update: data,
      create: data,
    });
  }

  return redirect("/app");
};

interface SelectedProduct {
  id: string;
  title: string;
  image?: string;
  sku?: string;
  barcode?: string;
  price?: string;
}

export default function PackForm() {
  const { pack, isNew } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";

  const [baseProduct, setBaseProduct] = useState<SelectedProduct | null>(
    pack ? { id: pack.baseProductId, title: pack.baseProductTitle } : null
  );
  const [packProduct, setPackProduct] = useState<SelectedProduct | null>(
    pack ? { id: pack.packProductId, title: pack.packProductTitle } : null
  );
  const [unitsPerPack, setUnitsPerPack] = useState(pack?.unitsPerPack?.toString() || "");
  const [packSku, setPackSku] = useState(pack?.packSku || "");
  const [packBarcode, setPackBarcode] = useState(pack?.packBarcode || "");
  const [packPrice, setPackPrice] = useState(pack?.packPrice?.toString() || "");

  const unitPrice = calculateUnitPrice(
    parseFloat(packPrice) || 0,
    parseInt(unitsPerPack) || 0,
  );

  const pickProduct = useCallback(async (type: "base" | "pack") => {
    const selected = await shopify.resourcePicker({ type: "product", multiple: false });
    if (!selected || selected.length === 0) return;

    const product = selected[0] as any;
    const variant = product.variants?.[0];
    const picked: SelectedProduct = {
      id: product.id,
      title: product.title,
      image: product.images?.[0]?.originalSrc,
      sku: variant?.sku,
      barcode: variant?.barcode,
      price: variant?.price,
    };

    if (type === "base") {
      setBaseProduct(picked);
    } else {
      setPackProduct(picked);
      if (variant?.sku && !packSku) setPackSku(variant.sku);
      if (variant?.barcode && !packBarcode) setPackBarcode(variant.barcode);
      if (variant?.price && !packPrice) setPackPrice(variant.price);
    }
  }, [shopify, packSku, packBarcode, packPrice]);

  const handleSubmit = () => {
    if (!baseProduct || !packProduct) return;

    const formData = new FormData();
    if (pack?.id) formData.set("packId", pack.id);
    formData.set("baseProductId", baseProduct.id);
    formData.set("baseProductTitle", baseProduct.title);
    formData.set("packProductId", packProduct.id);
    formData.set("packProductTitle", packProduct.title);
    formData.set("unitsPerPack", unitsPerPack);
    formData.set("packSku", packSku);
    formData.set("packBarcode", packBarcode);
    formData.set("packPrice", packPrice);
    submit(formData, { method: "post" });
  };

  const error = (actionData as any)?.error;

  return (
    <Page
      title={isNew ? "Create Pack" : `Edit: ${pack?.packProductTitle ?? ""}`}
      backAction={{ content: "Back", onAction: () => navigate("/app") }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical"><p>{error}</p></Banner>
            )}

            {/* Step 1: Base Product */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Base Product (Single Unit)</Text>
                <Text as="p" tone="subdued">
                  The individual product that this pack is a bulk version of.
                </Text>
                {baseProduct ? (
                  <InlineStack gap="400" align="start" blockAlign="center">
                    {baseProduct.image && (
                      <Thumbnail source={baseProduct.image} alt={baseProduct.title} size="medium" />
                    )}
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">{baseProduct.title}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{baseProduct.id}</Text>
                    </BlockStack>
                    <Button onClick={() => pickProduct("base")} size="slim">Change</Button>
                  </InlineStack>
                ) : (
                  <Button onClick={() => pickProduct("base")}>Select base product</Button>
                )}
              </BlockStack>
            </Card>

            {/* Step 2: Pack Product */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Pack Product</Text>
                <Text as="p" tone="subdued">
                  The product that represents the pack/case. Can be an existing product or one you create.
                </Text>
                {packProduct ? (
                  <InlineStack gap="400" align="start" blockAlign="center">
                    {packProduct.image && (
                      <Thumbnail source={packProduct.image} alt={packProduct.title} size="medium" />
                    )}
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">{packProduct.title}</Text>
                      <Text as="p" tone="subdued" variant="bodySm">{packProduct.id}</Text>
                    </BlockStack>
                    <Button onClick={() => pickProduct("pack")} size="slim">Change</Button>
                  </InlineStack>
                ) : (
                  <Button onClick={() => pickProduct("pack")}>Select pack product</Button>
                )}
              </BlockStack>
            </Card>

            {/* Step 3: Pack Details */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Pack Details</Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Units Per Pack"
                      type="number"
                      value={unitsPerPack}
                      onChange={setUnitsPerPack}
                      min={2}
                      helpText="How many individual units in this pack (e.g., 6, 12, 24)"
                      autoComplete="off"
                    />
                    <TextField
                      label="Pack Price"
                      type="number"
                      value={packPrice}
                      onChange={setPackPrice}
                      prefix="$"
                      helpText="Selling price for the full pack"
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Pack SKU"
                      value={packSku}
                      onChange={setPackSku}
                      helpText="Optional — SKU for the pack product"
                      autoComplete="off"
                    />
                    <TextField
                      label="Pack Barcode"
                      value={packBarcode}
                      onChange={setPackBarcode}
                      helpText="Optional — barcode/UPC for the pack"
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                </FormLayout>

                <Divider />

                <BlockStack gap="100">
                  <Text variant="headingMd" as="h3">Calculated Unit Price</Text>
                  {unitPrice > 0 ? (
                    <InlineStack gap="300" blockAlign="center">
                      <Text variant="headingLg" as="p" tone="success">
                        {formatMoney(unitPrice)}
                      </Text>
                      <Text as="p" tone="subdued">per unit</Text>
                      <Badge tone="info">
                        {formatMoney(parseFloat(packPrice))} ÷ {unitsPerPack} units
                      </Badge>
                    </InlineStack>
                  ) : (
                    <Text as="p" tone="subdued">
                      Enter a price and units per pack to see the unit price.
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            <InlineStack gap="300" align="end">
              <Button onClick={() => navigate("/app")}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={isSubmitting}
                disabled={isSubmitting || !baseProduct || !packProduct}
              >
                {isNew ? "Save Pack" : "Update Pack"}
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Tips</Text>
              <Text as="p" tone="subdued">
                <strong>Pack as a product:</strong> Each pack is a real Shopify product with its own page, images, and SEO.
              </Text>
              <Text as="p" tone="subdued">
                <strong>Inventory sync:</strong> When a pack sells, the base product's inventory is automatically reduced by the number of units in the pack.
              </Text>
              <Text as="p" tone="subdued">
                <strong>Multiple packs:</strong> You can create several pack sizes for the same base product (6-pack, 12-pack, 24-pack).
              </Text>
              <Divider />
              <Text variant="headingMd" as="h2">Storefront Widget</Text>
              <Text as="p" tone="subdued">
                After saving, add the "Pack Pricing" block in your theme editor.
                Customers on the base product page will see all pack options with prices.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
