import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";

const GET_INVENTORY_ITEM_QUERY = `
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
                    id
                    location {
                      id
                    }
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

const ADJUST_INVENTORY_MUTATION = `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        reason
      }
    }
  }
`;

interface LineItem {
  product_id: number;
  quantity: number;
}

/**
 * When a pack product is ordered, decrement the base product's inventory
 * by (quantity ordered × units per pack).
 */
export async function syncInventoryOnOrder(
  admin: AdminApiContext,
  shop: string,
  lineItems: LineItem[],
) {
  for (const item of lineItems) {
    const gid = `gid://shopify/Product/${item.product_id}`;

    // Check if this product is a pack
    const packConfig = await prisma.packConfig.findUnique({
      where: { shop_packProductId: { shop, packProductId: gid } },
    });

    if (!packConfig) continue;

    const unitsToDeduct = item.quantity * packConfig.unitsPerPack;

    // Get base product inventory
    const response = await admin.graphql(GET_INVENTORY_ITEM_QUERY, {
      variables: { productId: packConfig.baseProductId },
    });
    const data = await response.json();

    const variant = data.data?.product?.variants?.edges?.[0]?.node;
    if (!variant?.inventoryItem) continue;

    const inventoryItemId = variant.inventoryItem.id;
    const levels = variant.inventoryItem.inventoryLevels?.edges || [];

    // Adjust at each location
    for (const { node: level } of levels) {
      await admin.graphql(ADJUST_INVENTORY_MUTATION, {
        variables: {
          input: {
            reason: "correction",
            name: "available",
            changes: [
              {
                delta: -unitsToDeduct,
                inventoryItemId,
                locationId: level.location.id,
              },
            ],
          },
        },
      });
    }
  }
}
