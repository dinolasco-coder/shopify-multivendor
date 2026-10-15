# PayMongo auto-pay after sale

Shopify still collects the customer payment. The app then sends each seller’s share from your **PayMongo wallet** via InstaPay (GCash / bank).

## Test without upgrading your PayMongo account

1. Sign up at PayMongo and open **Developers → API keys**.
2. Copy the **secret test key** (`sk_test_…`). No business upgrade is required for test mode.
3. Set Railway / `.env`:

```env
PAYMONGO_SECRET_KEY=sk_test_xxxxxxxx
PAYMONGO_AUTO_PAYOUTS=true
SHOPIFY_APP_URL=https://your-app.up.railway.app
```

4. Optionally set source wallet / account (from PayMongo Money Movement → Wallets):

```env
PAYMONGO_SOURCE_WALLET_ID=wallet_…
# or
PAYMONGO_SOURCE_ACCOUNT_NUMBER=…
PAYMONGO_SOURCE_ACCOUNT_NAME=…
PAYMONGO_SOURCE_ACCOUNT_BIC=PAEYPHM2XXX
```

5. Redeploy. In **Admin → Payouts** you should see “PayMongo connected”.
6. Sellers fill **Payouts** (account name, number, bank/e-wallet).
7. Use **Send via PayMongo** on a seller balance, or place a test order with auto-pay ON.

Test mode simulates transfers — no real money moves.

## Go live (after account upgrade)

1. Complete PayMongo verification and enable the wallet for external disbursements.
2. Swap to `sk_live_…`.
3. Fund the PayMongo wallet from store settlements (or top-ups).
4. Confirm live source account number / name / BIC.
5. Keep `callback_url` HTTPS (`{SHOPIFY_APP_URL}/webhooks/paymongo`).

## Behaviour

| Event | What happens |
|--------|----------------|
| Order attributed | If `PAYMONGO_AUTO_PAYOUTS=true` and seller is auto-pay ready, create a pending PayMongo transfer for their share |
| PayMongo callback | Updates payout status to succeeded / failed |
| Seller missing details | Skip auto-pay; balance stays for manual Mark paid / Send via PayMongo |
| Failed transfer | Shown on Admin → Payouts with **Retry** |

Manual **Mark paid** / **Mark all paid** still work as a fallback ledger.

## Callback URL

`POST {SHOPIFY_APP_URL}/webhooks/paymongo`

No Shopify HMAC — this is PayMongo’s transfer status callback.
