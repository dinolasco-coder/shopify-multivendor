import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateSettings,
  updateSettings,
} from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getOrCreateSettings(session.shop);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const defaultCommissionPercent = Number(form.get("defaultCommissionPercent"));
  const requireProductApproval = form.get("requireProductApproval") === "on";

  if (
    !Number.isFinite(defaultCommissionPercent) ||
    defaultCommissionPercent < 0 ||
    defaultCommissionPercent > 100
  ) {
    return { error: "Default commission must be between 0 and 100." };
  }

  const settings = await updateSettings(session.shop, {
    defaultCommissionPercent,
    requireProductApproval,
  });

  return { ok: true, settings, message: "Settings saved." };
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const current =
    actionData && "settings" in actionData && actionData.settings
      ? actionData.settings
      : settings;

  return (
    <s-page heading="Marketplace settings">
      {actionData && "error" in actionData && actionData.error && (
        <s-banner tone="critical">{actionData.error}</s-banner>
      )}
      {actionData && "message" in actionData && actionData.message && (
        <s-banner tone="success">{actionData.message}</s-banner>
      )}

      <s-section heading="Defaults">
        <Form method="post">
          <s-stack direction="block" gap="base">
            <s-number-field
              label="Default vendor commission %"
              name="defaultCommissionPercent"
              value={String(current.defaultCommissionPercent)}
              min={0}
              max={100}
              step={0.1}
              details="Applied to newly invited or registered vendors. Per-vendor rates can be overridden on the Vendors page."
            />
            <s-checkbox
              name="requireProductApproval"
              label="Require admin approval before vendor products go live"
              {...(current.requireProductApproval ? { checked: true } : {})}
            />
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { loading: true } : {})}
            >
              Save settings
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Payouts">
        <s-paragraph>
          v1 tracks commission owed only. Pay vendors outside Shopify using the
          Orders and vendor Sales reports. Automatic payment splits are not
          enabled yet.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
