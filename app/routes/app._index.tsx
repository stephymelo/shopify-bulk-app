import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  EmptyState,
  Badge,
  Text,
  InlineStack,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { formatMoney, calculateUnitPrice } from "../utils/pricing";

// GraphQL query: find all products that have a case_pricing.base_product_id metafield
const GET_CASE_PRODUCTS_QUERY = `
  query GetCaseProducts($cursor: String) {
    products(first: 50, after: $cursor, query: "metafield:case_pricing.base_product_id:*") {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          metafields(namespace: "case_pricing", first: 10) {
            edges {
              node {
                key
                value
                jsonValue
              }
            }
          }
        }
      }
    }
  }
`;

const DELETE_METAFIELDS_MUTATION = `
  mutation DeleteMetafields($metafieldIds: [ID!]!) {
    metafieldsDelete(metafields: $metafieldIds) {
      deletedMetafieldIds
      userErrors {
        field
        message
      }
    }
  }
`;

// Also fetch base product metafield IDs so we can clean up the reverse reference
const GET_PRODUCT_METAFIELD_IDS_QUERY = `
  query GetProductMetafieldIds($id: ID!) {
    product(id: $id) {
      id
      metafields(namespace: "case_pricing", first: 20) {
        edges {
          node {
            id
            key
          }
        }
      }
    }
  }
`;

const UPDATE_BASE_PRODUCT_CASES_MUTATION = `
  mutation UpdateBaseProductCases($metafields: [MetafieldsSetInput!]!) {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(GET_CASE_PRODUCTS_QUERY);
  const data = await response.json();

  const caseProducts = (data.data?.products?.edges || []).map(({ node }: any) => {
    const metafields: Record<string, string> = {};
    node.metafields?.edges?.forEach(({ node: mf }: any) => {
      metafields[mf.key] = mf.value;
    });

    const casePrice = parseFloat(metafields.case_price || "0");
    const unitsPerCase = parseInt(metafields.units_per_case || "0", 10);
    const unitPrice = calculateUnitPrice(casePrice, unitsPerCase);

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      baseProductId: metafields.base_product_id || "",
      unitsPerCase,
      caseSku: metafields.case_sku || "",
      casePrice,
      unitPrice,
    };
  });

  // Fetch base product titles for display
  const baseProductIds = [...new Set(caseProducts.map((p: any) => p.baseProductId).filter(Boolean))];
  const baseProductTitles: Record<string, string> = {};

  for (const baseId of baseProductIds) {
    const res = await admin.graphql(`
      query { product(id: "${baseId}") { id title } }
    `);
    const d = await res.json();
    if (d.data?.product) {
      baseProductTitles[baseId as string] = d.data.product.title;
    }
  }

  return json({ caseProducts, baseProductTitles });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const caseProductId = formData.get("caseProductId") as string;
    const baseProductId = formData.get("baseProductId") as string;

    // 1. Get all metafield IDs on the case product
    const caseRes = await admin.graphql(GET_PRODUCT_METAFIELD_IDS_QUERY, {
      variables: { id: caseProductId },
    });
    const caseData = await caseRes.json();
    const caseMetafieldIds = (caseData.data?.product?.metafields?.edges || [])
      .map(({ node }: any) => ({ id: node.id }));

    if (caseMetafieldIds.length > 0) {
      await admin.graphql(DELETE_METAFIELDS_MUTATION, {
        variables: { metafieldIds: caseMetafieldIds },
      });
    }

    // 2. Update base product: remove this case from its case_products list
    if (baseProductId) {
      const baseRes = await admin.graphql(GET_PRODUCT_METAFIELD_IDS_QUERY, {
        variables: { id: baseProductId },
      });
      const baseData = await baseRes.json();
      const caseProductsMf = (baseData.data?.product?.metafields?.edges || [])
        .find(({ node }: any) => node.key === "case_products");

      if (caseProductsMf) {
        let currentList: string[] = [];
        try {
          currentList = JSON.parse(caseProductsMf.node.value || "[]");
        } catch {}
        const updatedList = currentList.filter((id: string) => id !== caseProductId);

        if (updatedList.length === 0) {
          // Delete the metafield entirely
          await admin.graphql(DELETE_METAFIELDS_MUTATION, {
            variables: { metafieldIds: [{ id: caseProductsMf.node.id }] },
          });
        } else {
          await admin.graphql(UPDATE_BASE_PRODUCT_CASES_MUTATION, {
            variables: {
              metafields: [{
                ownerId: baseProductId,
                namespace: "case_pricing",
                key: "case_products",
                value: JSON.stringify(updatedList),
                type: "list.product_reference",
              }],
            },
          });
        }
      }
    }

    return json({ success: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function Index() {
  const { caseProducts, baseProductTitles } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();

  const handleDelete = (caseProductId: string, baseProductId: string) => {
    if (confirm("Remove this case link? The product will not be deleted.")) {
      const formData = new FormData();
      formData.set("intent", "delete");
      formData.set("caseProductId", caseProductId);
      formData.set("baseProductId", baseProductId);
      submit(formData, { method: "post" });
    }
  };

  const titles = baseProductTitles as Record<string, string>;
  const rows = caseProducts.map((cp: any) => [
    <Button
      variant="plain"
      onClick={() => navigate(`/app/cases/${encodeURIComponent(cp.id)}`)}
    >
      {cp.title}
    </Button>,
    titles[cp.baseProductId as string] || cp.baseProductId,
    cp.unitsPerCase || "—",
    cp.caseSku || "—",
    cp.casePrice ? formatMoney(cp.casePrice) : "—",
    cp.unitPrice ? formatMoney(cp.unitPrice) : "—",
    <InlineStack gap="200">
      <Button
        size="slim"
        onClick={() => navigate(`/app/cases/${encodeURIComponent(cp.id)}`)}
      >
        Edit
      </Button>
      <Button
        size="slim"
        tone="critical"
        onClick={() => handleDelete(cp.id, cp.baseProductId)}
      >
        Remove
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Case Pricing"
      primaryAction={{
        content: "Add Case",
        onAction: () => navigate("/app/cases/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          {caseProducts.length === 0 ? (
            <Card>
              <EmptyState
                heading="No case products yet"
                action={{
                  content: "Add your first case",
                  onAction: () => navigate("/app/cases/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Link a product as a case of a single item. Set the case SKU,
                  price, and units — the unit price is calculated automatically.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Case Products ({caseProducts.length})
                </Text>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "numeric",
                    "text",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "Case Product",
                    "Base Product",
                    "Units / Case",
                    "Case SKU",
                    "Case Price",
                    "Unit Price",
                    "Actions",
                  ]}
                  rows={rows}
                />
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">How it works</Text>
              <Text as="p" tone="subdued">
                1. Pick an existing product to act as the "case" version.
              </Text>
              <Text as="p" tone="subdued">
                2. Link it to the single/base product it represents.
              </Text>
              <Text as="p" tone="subdued">
                3. Enter the units per case, the case's own SKU and price.
              </Text>
              <Text as="p" tone="subdued">
                4. The unit price is calculated automatically: Case Price ÷ Units.
              </Text>
              <Text as="p" tone="subdued">
                5. A widget on the base product's page lets customers switch between single and case options.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
