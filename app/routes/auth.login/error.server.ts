import { LoginErrorType } from "@shopify/shopify-app-remix/server";

export function loginErrorMessage(loginErrors: Record<string, string>) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain (.myshopify.com)" };
  }
  return {};
}
