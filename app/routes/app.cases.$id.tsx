import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Button,
  Text,
  Banner,
  Divider,
  InlineStack,
  Badge,
  Thumbnail,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { formatMoney, calculateUnitPrice } from "../utils/pricing";

const GET_PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage {
        url
        altText
      }
      metafields(namespace: "case_pricing", first: 10) {
        edges {
          node {
            id
            key
            value
          }
        }
      }
    }
  }
`;

const SET_METAFIELDS_MUTATION = `
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;

  if (!id || id === "new") {
    return json({
      caseProduct: null as null | {
        id: string; title: string; handle: string; image: string | null;
        baseProductId: string; unitsPerCase: string; caseSku: string; casePrice: string;
      },
      isNew: true,
      loadError: null as string | null,
    });
  }

  const productId = decodeURIComponent(id);
  const response = await admin.graphql(GET_PRODUCT_QUERY, {
    variables: { id: productId },
  });
  const data = await response.json();
  const product = data.data?.product;

  if (!product) {
    return json({ caseProduct: null, isNew: true, loadError: "Product not found" });
  }

  const metafields: Record<string, string> = {};
  product.metafields?.edges?.forEach(({ node }: any) => {
    metafields[node.key] = node.value;
  });

  return json({
    caseProduct: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      image: product.featuredImage?.url || null,
      baseProductId: metafields.base_product_id || "",
      unitsPerCase: metafields.units_per_case || "",
      caseSku: metafields.case_sku || "",
      casePrice: metafields.case_price || "",
    },
    isNew: false,
    loadError: null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const caseProductId = formData.get("caseProductId") as string;
  const baseProductId = formData.get("baseProductId") as string;
  const unitsPerCase = formData.get("unitsPerCase") as string;
  const caseSku = formData.get("caseSku") as string;
  const casePrice = formData.get("casePrice") as string;

  if (!caseProductId || !baseProductId || !unitsPerCase || !caseSku || !casePrice) {
    return json({ error: "All fields are required." }, { status: 400 });
  }

  const units = parseInt(unitsPerCase, 10);
  const price = parseFloat(casePrice);

  if (isNaN(units) || units <= 0) {
    return json({ error: "Units per case must be a positive number." }, { status: 400 });
  }
  if (isNaN(price) || price <= 0) {
    return json({ error: "Case price must be a positive number." }, { status: 400 });
  }

  const setResponse = await admin.graphql(SET_METAFIELDS_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: caseProductId,
          namespace: "case_pricing",
          key: "base_product_id",
          value: baseProductId,
          type: "product_reference",
        },
        {
          ownerId: caseProductId,
          namespace: "case_pricing",
          key: "units_per_case",
          value: String(units),
          type: "number_integer",
        },
        {
          ownerId: caseProductId,
          namespace: "case_pricing",
          key: "case_sku",
          value: caseSku,
          type: "single_line_text_field",
        },
        {
          ownerId: caseProductId,
          namespace: "case_pricing",
          key: "case_price",
          value: String(price),
          type: "money",
        },
      ],
    },
  });

  const setData = await setResponse.json();
  const userErrors = setData.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length > 0) {
    return json({ error: userErrors.map((e: any) => e.message).join(", ") }, { status: 400 });
  }

  // Update the base product reverse reference list
  const baseRes = await admin.graphql(`
    query {
      product(id: "${baseProductId}") {
        metafields(namespace: "case_pricing", first: 5) {
          edges {
            node { id key value }
          }
        }
      }
    }
  `);
  const baseData = await baseRes.json();
  const existingCasesMf = (baseData.data?.product?.metafields?.edges || [])
    .find(({ node }: any) => node.key === "case_products");

  let currentList: string[] = [];
  if (existingCasesMf) {
    try { currentList = JSON.parse(existingCasesMf.node.value || "[]"); } catch { /* ignore */ }
  }

  if (!currentList.includes(caseProductId)) {
    currentList.push(caseProductId);
  }

  await admin.graphql(SET_METAFIELDS_MUTATION, {
    variables: {
      metafields: [{
        ownerId: baseProductId,
        namespace: "case_pricing",
        key: "case_products",
        value: JSON.stringify(currentList),
        type: "list.product_reference",
      }],
    },
  });

  return redirect("/app");
};

interface SelectedProduct {
  id: string;
  title: string;
  image?: string;
}

export default function CaseForm() {
  const { caseProduct, isNew, loadError } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state === "submitting";

  const [selectedCaseProduct, setSelectedCaseProduct] = useState<SelectedProduct | null>(
    caseProduct
      ? { id: caseProduct.id, title: caseProduct.title, image: caseProduct.image || undefined }
      : null
  );
  const [selectedBaseProduct, setSelectedBaseProduct] = useState<SelectedProduct | null>(
    caseProduct?.baseProductId ? { id: caseProduct.baseProductId, title: "Linked product" } : null
  );

  const [unitsPerCase, setUnitsPerCase] = useState(caseProduct?.unitsPerCase || "");
  const [caseSku, setCaseSku] = useState(caseProduct?.caseSku || "");
  const [casePrice, setCasePrice] = useState(caseProduct?.casePrice || "");
  const [formError, setFormError] = useState<string | null>(null);

  const unitPrice = calculateUnitPrice(
    parseFloat(casePrice) || 0,
    parseInt(unitsPerCase) || 0
  );

  const openCaseProductPicker = useCallback(async () => {
    const selected = await shopify.resourcePicker({ type: "product", multiple: false });
    if (selected && selected.length > 0) {
      const product = selected[0] as any;
      setSelectedCaseProduct({
        id: product.id,
        title: product.title,
        image: product.images?.[0]?.originalSrc,
      });
      if (product.variants?.[0]?.sku && !caseSku) {
        setCaseSku(product.variants[0].sku);
      }
    }
  }, [shopify, caseSku]);

  const openBaseProductPicker = useCallback(async () => {
    const selected = await shopify.resourcePicker({ type: "product", multiple: false });
    if (selected && selected.length > 0) {
      const product = selected[0] as any;
      setSelectedBaseProduct({ id: product.id, title: product.title });
    }
  }, [shopify]);

  const handleSubmit = () => {
    setFormError(null);
    if (!selectedCaseProduct) { setFormError("Please select a case product."); return; }
    if (!selectedBaseProduct) { setFormError("Please select a base (single-unit) product."); return; }
    if (!unitsPerCase || parseInt(unitsPerCase) <= 0) { setFormError("Enter a valid number of units per case."); return; }
    if (!caseSku.trim()) { setFormError("Enter a SKU for this case."); return; }
    if (!casePrice || parseFloat(casePrice) <= 0) { setFormError("Enter a valid case price."); return; }

    const formData = new FormData();
    formData.set("caseProductId", selectedCaseProduct.id);
    formData.set("baseProductId", selectedBaseProduct.id);
    formData.set("unitsPerCase", unitsPerCase);
    formData.set("caseSku", caseSku);
    formData.set("casePrice", casePrice);
    submit(formData, { method: "post" });
  };

  return (
    <Page
      title={isNew ? "Add Case Product" : `Edit: ${caseProduct?.title ?? ""}`}
      backAction={{ content: "Back", onAction: () => navigate("/app") }}
    >
      <Layout>
        <Layout.Section>
          {(formError || loadError) && (
            <Banner tone="critical">
              <p>{formError || loadError}</p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Step 1: Select the Case Product</Text>
              <Text as="p" tone="subdued">
                Choose the Shopify product that represents the case (bulk/multi-unit) version.
              </Text>
              {selectedCaseProduct ? (
                <InlineStack gap="400" align="start" blockAlign="center">
                  {selectedCaseProduct.image && (
                    <Thumbnail source={selectedCaseProduct.image} alt={selectedCaseProduct.title} size="medium" />
                  )}
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">{selectedCaseProduct.title}</Text>
                    <Text as="p" tone="subdued" variant="bodySm">{selectedCaseProduct.id}</Text>
                  </BlockStack>
                  <Button onClick={openCaseProductPicker} size="slim">Change</Button>
                </InlineStack>
              ) : (
                <Button onClick={openCaseProductPicker}>Browse products</Button>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Step 2: Link to Base (Single-Unit) Product</Text>
              <Text as="p" tone="subdued">
                Select the individual/single-unit product that this case is a bulk version of.
              </Text>
              {selectedBaseProduct ? (
                <InlineStack gap="400" align="start" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">{selectedBaseProduct.title}</Text>
                    <Text as="p" tone="subdued" variant="bodySm">{selectedBaseProduct.id}</Text>
                  </BlockStack>
                  <Button onClick={openBaseProductPicker} size="slim">Change</Button>
                </InlineStack>
              ) : (
                <Button onClick={openBaseProductPicker}>Browse products</Button>
              )}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Step 3: Case Details</Text>

              <TextField
                label="Units Per Case"
                type="number"
                value={unitsPerCase}
                onChange={setUnitsPerCase}
                min={1}
                helpText="How many individual units are in this case? (e.g. 12, 24, 48)"
                autoComplete="off"
              />
              <TextField
                label="Case SKU"
                value={caseSku}
                onChange={setCaseSku}
                helpText="The SKU specific to this case product"
                autoComplete="off"
              />
              <TextField
                label="Case Price"
                type="number"
                value={casePrice}
                onChange={setCasePrice}
                prefix="$"
                helpText="The selling price for the full case"
                autoComplete="off"
              />

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
                      {formatMoney(parseFloat(casePrice)) + " ÷ " + unitsPerCase + " units"}
                    </Badge>
                  </InlineStack>
                ) : (
                  <Text as="p" tone="subdued">
                    Enter a case price and units per case to see the unit price.
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
              disabled={isSubmitting}
            >
              {isNew ? "Save Case" : "Update Case"}
            </Button>
          </InlineStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">About Unit Price</Text>
              <Text as="p" tone="subdued">Unit price = Case Price ÷ Units Per Case</Text>
              <Text as="p" tone="subdued">
                Example: A case of 24 bottles at $48.00 = $2.00/bottle.
              </Text>
              <Divider />
              <Text variant="headingMd" as="h2">Storefront Widget</Text>
              <Text as="p" tone="subdued">
                Once saved, add the "Case Pricing" block in your theme editor. Customers on the base product page can click the case pill to view and purchase the case.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
