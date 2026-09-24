import type { ReactNode } from "react";

/** Shopify bag mark (simplified), used on auth screens. */
export function ShopifyMark() {
  return (
    <div className="vendor-auth-logo" aria-hidden>
      <svg
        width="40"
        height="44"
        viewBox="0 0 40 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M34.2 10.4c-.2-.1-2-.6-4.1-.3-.1-1.7-.6-3.3-1.6-4.5C27.2 3.8 25.3 3 23.2 3c-.2 0-.4 0-.6.1-.5-1.1-1.3-2-2.4-2.6C19 0 17.5-.2 16.1.3c-1.5.5-2.6 1.6-3.2 3-1.7.5-2.9 1.2-3 1.3L8.4 5.7c-.3.1-.5.4-.5.7l-3 28.8c0 .3.2.6.5.7l15.2 2.9h.1c.1 0 .1 0 .2 0l15.3-3.3c.3-.1.5-.4.5-.7l2.5-23.3c.1-.4-.2-.8-.5-.9z"
          fill="#95BF47"
        />
        <path
          d="M25.7 9.9c-.1 0-.3 0-.4.1-1.1-3.3-3.1-5-5.5-5-.1 0-.3 0-.4 0 1.1-.7 2.4-.8 3.6-.4 1.2.4 2.1 1.4 2.5 2.6.2.9.2 1.8.2 2.7z"
          fill="#5E8E3E"
        />
        <path
          d="M23.1 14.1l-1.1 3.4s-.9-.4-2-.4c-1.6 0-1.7.9-1.7 1.2 0 1.3 3.5 1.8 3.5 4.9 0 2.4-1.5 4-3.9 4-2.7 0-4.1-1.7-4.1-1.7l1.2-3.2s1.4 1.1 2.6 1.1c.8 0 1.1-.4 1.1-.9 0-1.6-3.4-1.5-3.4-4.8 0-2.5 1.8-4.9 5.3-4.9 1.4 0 2.5.4 2.5.4z"
          fill="#fff"
        />
      </svg>
    </div>
  );
}

/** Centered Shopify Accounts-style shell for login / signup. */
export function VendorAuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="vendor-auth-shell">
      {children}
      <style>{`
        .vendor-auth-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          background: #f6f6f7;
          box-sizing: border-box;
        }
        .vendor-auth-card {
          width: 100%;
          max-width: 400px;
          background: #ffffff;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          padding: 32px 28px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
        }
        .vendor-auth-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .vendor-auth-logo {
          display: flex;
          justify-content: center;
          margin-bottom: 4px;
        }
        .vendor-auth-footer {
          padding-top: 4px;
          border-top: 1px solid #e3e3e3;
          margin-top: 4px;
          padding-top: 20px;
        }
        .vendor-auth-link {
          color: #005bd3;
          text-decoration: none;
          font-weight: 550;
        }
        .vendor-auth-link:hover {
          text-decoration: underline;
        }
        .vendor-auth-card .Polaris-Button--sizeLarge {
          min-height: 44px;
        }
        .vendor-auth-card .Polaris-TextField__Input {
          min-height: 40px;
        }
      `}</style>
    </div>
  );
}
