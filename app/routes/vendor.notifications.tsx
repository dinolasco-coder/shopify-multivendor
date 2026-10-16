import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireApprovedVendor } from "../services/vendor-auth.server";
import {
  listVendorNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../models/notifications.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;
  const notifications = await listVendorNotifications(result.vendor.id, 80);
  const unread = notifications.filter((n) => !n.readAt).length;
  return { notifications, unread };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const result = await requireApprovedVendor(request);
  if (result instanceof Response) throw result;

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "markAll") {
    await markAllNotificationsRead(result.vendor.id);
    return { ok: true };
  }

  if (intent === "markRead") {
    const id = String(form.get("id") || "");
    if (id) await markNotificationRead(id, result.vendor.id);
    return { ok: true };
  }

  return { error: "Unknown action." };
};

function typeLabel(type: string) {
  if (type === "order_status") return "Order";
  if (type === "payment") return "Payment";
  if (type === "customization") return "Customization";
  return type;
}

export default function VendorNotifications() {
  const { notifications, unread } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div>
          <h1 className="sx-title">Notifications</h1>
          <p className="sx-sub">
            Order status, payment updates, and customization requests.
            {unread > 0 ? ` ${unread} unread.` : " You’re all caught up."}
          </p>
        </div>
        {unread > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="markAll" />
            <button className="sx-btn" type="submit" disabled={busy}>
              Mark all read
            </button>
          </Form>
        ) : null}
      </div>

      <div className="sx-panel" style={{ padding: 0, overflow: "hidden" }}>
        {notifications.length === 0 ? (
          <div className="sx-empty">
            No notifications yet. New orders, payouts, and design requests will
            show up here.
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {notifications.map((n) => {
              const unreadItem = !n.readAt;
              return (
                <li
                  key={n.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "14px 16px",
                    borderBottom: "1px solid #ececec",
                    background: unreadItem ? "#f7fafc" : "#fff",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background:
                            n.type === "payment"
                              ? "#e4f7e9"
                              : n.type === "customization"
                                ? "#fff4e5"
                                : "#eef3ff",
                          color:
                            n.type === "payment"
                              ? "#0d6b2d"
                              : n.type === "customization"
                                ? "#8a5a00"
                                : "#1a3a8a",
                        }}
                      >
                        {typeLabel(n.type)}
                      </span>
                      {unreadItem ? (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#2c6ecb",
                            display: "inline-block",
                          }}
                          title="Unread"
                        />
                      ) : null}
                      <span style={{ fontSize: 12, color: "#6d7175" }}>
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: "0 0 4px",
                        fontWeight: unreadItem ? 700 : 600,
                        fontSize: 14,
                      }}
                    >
                      {n.href ? (
                        <Link to={n.href} style={{ color: "inherit" }}>
                          {n.title}
                        </Link>
                      ) : (
                        n.title
                      )}
                    </p>
                    {n.body ? (
                      <p style={{ margin: 0, fontSize: 13, color: "#6d7175" }}>
                        {n.body}
                      </p>
                    ) : null}
                  </div>
                  {unreadItem ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="markRead" />
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        className="sx-btn"
                        type="submit"
                        disabled={busy}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        Mark read
                      </button>
                    </Form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
