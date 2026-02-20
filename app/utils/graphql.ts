// ─── Product Queries ────────────────────────────────────────

export const GET_PRODUCTS_WITH_PACKS = `
  query GetProductsWithPacks($cursor: String) {
    products(first: 50, after: $cursor, query: "metafield:pack_config.pack_products:*") {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          featuredImage { url altText }
          metafields(namespace: "pack_config", first: 10) {
            edges {
              node { id key value }
            }
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      featuredImage { url altText }
      variants(first: 1) {
        edges {
          node {
            id
            price
            sku
            barcode
            inventoryQuantity
          }
        }
      }
      metafields(namespace: "pack_config", first: 10) {
        edges {
          node { id key value }
        }
      }
    }
  }
`;

// ─── Metafield Mutations ────────────────────────────────────

export const SET_METAFIELDS = `
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key value }
      userErrors { field message }
    }
  }
`;

export const DELETE_METAFIELDS = `
  mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafieldIds
      userErrors { field message }
    }
  }
`;

// ─── Product Mutations ──────────────────────────────────────

export const CREATE_PRODUCT = `
  mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        variants(first: 1) {
          edges {
            node { id price sku barcode }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

export const UPDATE_PRODUCT_VARIANT = `
  mutation UpdateProductVariant($input: ProductVariantInput!) {
    productVariantUpdate(input: $input) {
      productVariant { id price sku barcode }
      userErrors { field message }
    }
  }
`;
