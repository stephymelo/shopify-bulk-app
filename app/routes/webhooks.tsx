import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const ADJUST_INVENTORY_MUTATION = `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

const GET_INVENTORY_ITEM = `
  query GetInventoryItem($productId: ID!) {
    product(id: $productId) {
      variants(first: 1) {
        edges {
          node {
            inventoryItem {
              id
              inventoryLevels(first: 10) {
                edges {
                  node {
                    location { id }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "ORDERS_CREATE": {
      const lineItems = (payload as any).line_items || [];

      for (const item of lineItems) {
        const gid = `gid://shopify/Product/${item.product_id}`;

        const packConfig = await prisma.packConfig.findFirst({
          where: { shop, packProductId: gid },
        });

        if (!packConfig) continue;

        const unitsToDeduct = item.quantity * packConfig.unitsPerPack;

        // Get base product inventory
        const invRes = await admin!.graphql(GET_INVENTORY_ITEM, {
          variables: { productId: packConfig.baseProductId },
        });
        const invData = await invRes.json();
        const variant = invData.data?.product?.variants?.edges?.[0]?.node;
        if (!variant?.inventoryItem) continue;

        const inventoryItemId = variant.inventoryItem.id;
        const levels = variant.inventoryItem.inventoryLevels?.edges || [];

        // Deduct from first location with available stock
        for (const { node: level } of levels) {
          const available = level.quantities?.[0]?.quantity ?? 0;
          if (available <= 0) continue;

          await admin!.graphql(ADJUST_INVENTORY_MUTATION, {
            variables: {
              input: {
                reason: "correction",
                name: "available",
                changes: [{
                  delta: -unitsToDeduct,
                  inventoryItemId,
                  locationId: level.location.id,
                }],
              },
            },
          });
          break; // Only deduct from one location
        }
      }
      break;
    }

    case "APP_UNINSTALLED": {
      // Clean up pack configs for this shop
      await prisma.packConfig.deleteMany({ where: { shop } });
      break;
    }
  }

  return new Response(null, { status: 200 });
};
