import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const entries = shopify.appMetafields?.value ?? [];
  const statusEntry = entries.find(
    (entry) =>
      entry.target?.type === "order" &&
      entry.metafield?.namespace === "marketplace" &&
      entry.metafield?.key === "customization_status",
  );
  const noteEntry = entries.find(
    (entry) =>
      entry.target?.type === "order" &&
      entry.metafield?.namespace === "marketplace" &&
      entry.metafield?.key === "customization_customer_note",
  );

  const status = statusEntry?.metafield?.value;
  const note = noteEntry?.metafield?.value?.trim();
  if (!note && !status) {
    return null;
  }

  const tone = status === "cancelled" ? "critical" : "info";
  const heading =
    status === "cancelled"
      ? "Customization update"
      : status === "accepted"
        ? "Customization accepted"
        : "Customization";

  return (
    <s-banner tone={tone}>
      <s-text type="strong">{heading}</s-text>
      <s-text>{note || status}</s-text>
    </s-banner>
  );
}
