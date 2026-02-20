import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../shopify.server";
import { loginErrorMessage } from "./auth.login/error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // If loaded inside Shopify admin with shop & host params, bounce to /app
  // The /app route will handle token exchange auth via App Bridge
  const shop = url.searchParams.get("shop");
  const host = url.searchParams.get("host");
  if (shop && host) {
    return redirect(`/app?shop=${shop}&host=${host}`);
  }

  // If just shop param (e.g., from initial install flow)
  if (shop) {
    return redirect(`/app?shop=${shop}`);
  }

  // No shop param — show login form
  const errors = loginErrorMessage(await login(request) as Record<string, string>);
  return { showLogin: true, errors };
};

export default function Index() {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Pack Pricing</h1>
      <p>This app runs inside the Shopify Admin.</p>
      <Form method="post" action="/auth/login">
        <label>
          Shop domain:
          <input type="text" name="shop" placeholder="your-store.myshopify.com" />
        </label>
        <button type="submit">Log in</button>
      </Form>
    </div>
  );
}
