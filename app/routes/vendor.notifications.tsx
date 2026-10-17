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
      <div className="sx-page-head">
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

      <div className="sx-panel sx-panel--flush">
        {notifications.length === 0 ? (
          <div className="sx-empty">
            No notifications yet. New orders, payouts, and design requests will
            show up here.
          </div>
        ) : (
          <ul className="sx-list">
            {notifications.map((n) => {
              const unreadItem = !n.readAt;
              const chip =
                n.type === "payment"
                  ? "sx-chip sx-chip--payment"
                  : n.type === "customization"
                    ? "sx-chip sx-chip--custom"
                    : "sx-chip sx-chip--order";
              return (
                <li
                  key={n.id}
                  className={`sx-list__item${unreadItem ? " is-unread" : ""}`}
                >
                  <div className="sx-list__body">
                    <div className="sx-list__meta">
                      <span className={chip}>{typeLabel(n.type)}</span>
                      {unreadItem ? <span className="sx-dot" title="Unread" /> : null}
                      <span className="sx-list__time">
                        {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="sx-list__title">
                      {n.href ? <Link to={n.href}>{n.title}</Link> : n.title}
                    </p>
                    {n.body ? <p className="sx-list__text">{n.body}</p> : null}
                  </div>
                  {unreadItem ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="markRead" />
                      <input type="hidden" name="id" value={n.id} />
                      <button className="sx-btn" type="submit" disabled={busy}>
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
