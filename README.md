# Shopify Multi-Vendor Marketplace

Custom Shopify app that turns a single store into a multi-vendor marketplace.

- **Admin** (embedded in Shopify Admin): approve vendors, set commission, view products/orders
- **Vendors** (`/vendor`): register/login, manage products & inventory, view orders & sales
- **Customers**: shop on the Online Store as usual — multi-vendor cart + Shopify checkout

## Prerequisites

- Node.js 20.19+ or 22.12+
- [Shopify Partner account](https://partners.shopify.com/) and a development store
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) (`npm install -g @shopify/cli`)
- **SQLite** for local/Railway (set `DATABASE_URL` in `.env`)

## Setup

```bash
cd shopify-multivendor
npm install
cp .env.example .env
# DATABASE_URL is already set to file:./dev.sqlite in .env.example
npx prisma db push
```

Create a Partner app and link it:

```bash
npm run config:link
# or: shopify app config link
```

Copy remaining Shopify env values into `.env` (see `.env.example`).

Start the app:

```bash
npm run dev
```

Install the app on your development store when prompted.

### Theme App Extension (“Sold by”)

1. With `npm run dev` running (or after `npm run deploy`), open the theme editor.
2. On a **product** template, add the **Sold by vendor** app block.
3. Vendor products set Shopify’s native `vendor` field to the seller name.

## Vendor portal

Vendors open `{APP_URL}/vendor/register` (or `/vendor/login`) and enter the shop domain (e.g. `your-store.myshopify.com`).

New vendors start as **pending**. Approve them under **Vendors** in the embedded admin.

## How attribution works

1. Vendor products get metafield `marketplace.vendor_id` = vendor DB id.
2. `orders/create` and `orders/updated` webhooks split line items by that metafield.
3. Commission = line subtotal × vendor commission %. Tracked in-app (manual payouts in v1).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development with Shopify CLI tunnel |
| `npm run build` | Production build |
| `npm run setup` | Prisma generate + migrate deploy |
| `npm run deploy` | Deploy app config + extensions to Shopify |
| `npm run docker-start` | Migrate DB + start production server |

## Host on Railway (production)

1. **Push this repo to GitHub**, then in [Railway](https://railway.app/) → **New Project** → **Deploy from GitHub**.

2. After the first deploy, add a **Volume** mounted at `/data` (keeps the SQLite DB between restarts).

3. **Variables** on the web service:

   | Variable | Value |
   |----------|--------|
   | `SHOPIFY_API_KEY` | App client ID |
   | `SHOPIFY_API_SECRET` | App client secret |
   | `SCOPES` | Same as in `shopify.app.toml` |
   | `SHOPIFY_APP_URL` | `https://YOUR-SERVICE.up.railway.app` (no trailing slash) |
   | `DATABASE_URL` | `file:/data/prod.sqlite` |
   | `NODE_ENV` | `production` |

4. Update `shopify.app.toml` `application_url` + `redirect_urls` to that Railway host, then run:

   ```bash
   npm run deploy
   ```

5. Open the app from Shopify Admin. Vendor login: `https://YOUR-SERVICE.up.railway.app/vendor/login`

> Railway needs your GitHub login in the browser — the CLI can’t finish that part alone from here.

## Project layout

```
app/
  routes/app.*          # Admin embedded UI
  routes/vendor.*       # Vendor portal
  routes/webhooks.*     # Order attribution
  models/               # Prisma helpers
  services/             # Products, auth, commission
extensions/
  marketplace-theme/    # “Sold by” theme block
prisma/schema.prisma
```

## Out of scope (v1)

- Automatic vendor payouts / payment splits
- Separate Shopify stores per vendor
- Headless custom storefront
