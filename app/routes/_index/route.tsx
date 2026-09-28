import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Embedded / OAuth install flow still goes into the admin app.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const base =
    process.env.SHOPIFY_APP_URL?.replace(/\/$/, "") || url.origin;

  return {
    showForm: Boolean(login),
    sellerLoginUrl: `${base}/vendor/login`,
    sellerRegisterUrl: `${base}/vendor/register`,
  };
};

export default function MarketplacePortal() {
  const { showForm, sellerLoginUrl, sellerRegisterUrl } =
    useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>M</span>
          <div>
            <p className={styles.brandName}>Multivendor</p>
            <p className={styles.brandSub}>Marketplace portal</p>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Seller & store portal</p>
          <h1 className={styles.heading}>Welcome to Multivendor</h1>
          <p className={styles.lead}>
            Sellers manage products and orders here. Store owners open the app
            from Shopify Admin.
          </p>
        </section>

        <section className={styles.cards}>
          <article className={styles.card}>
            <h2 className={styles.cardTitle}>I am a seller</h2>
            <p className={styles.cardText}>
              Log in to list products, check sales, and see your earnings.
            </p>
            <div className={styles.cardActions}>
              <a className={styles.btnPrimary} href={sellerLoginUrl}>
                Seller login
              </a>
              <a className={styles.btnGhost} href={sellerRegisterUrl}>
                Create seller account
              </a>
            </div>
          </article>

          <article className={styles.card}>
            <h2 className={styles.cardTitle}>I own the store</h2>
            <p className={styles.cardText}>
              Approve sellers, review products, and record payouts inside
              Shopify Admin → Apps → Multivendor.
            </p>
            {showForm ? (
              <Form className={styles.form} method="post" action="/auth/login">
                <label className={styles.label}>
                  <span>Shop domain</span>
                  <input
                    className={styles.input}
                    type="text"
                    name="shop"
                    placeholder="your-store.myshopify.com"
                    autoComplete="off"
                  />
                </label>
                <button className={styles.btnPrimary} type="submit">
                  Open admin app
                </button>
              </Form>
            ) : (
              <p className={styles.hint}>
                Open Shopify Admin, then click <strong>Multivendor</strong> in
                your apps list.
              </p>
            )}
          </article>
        </section>

        <p className={styles.footerNote}>
          Already approved?{" "}
          <Link className={styles.inlineLink} to="/vendor/login">
            Go to seller portal
          </Link>
        </p>
      </main>
    </div>
  );
}
