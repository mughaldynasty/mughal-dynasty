# Cloudflare Gmail API Worker for Mughal Dynasty

This Cloudflare Worker handles server-to-server email dispatch using the official Google Gmail API (`users.messages.send`).

## Features
- **RFC 2822 Multipart MIME Support**: Sends both rich HTML (with restaurant branding, order summaries, and colors) and plain-text fallback.
- **Gmail API OAuth 2.0**: Uses refresh token stored securely in Cloudflare KV.
- **Bearer Token Authentication**: Protects the `/gmail/send` endpoint using `SEND_API_SECRET`.
- **Health & Diagnostics**: `/` and `/health` endpoints for status verification.

## Worker Configuration in Cloudflare Dashboard
1. Go to **Cloudflare Dashboard** -> **Workers & Pages** -> Select your worker (`mughal-resend-worker`).
2. Go to **Settings** -> **Variables & Secrets**:
   - `SEND_API_SECRET`: (Secret) A random secure string shared only between the Worker and the backend `server.ts`.
   - `GOOGLE_CLIENT_ID`: Your Google Cloud OAuth Client ID.
   - `GOOGLE_CLIENT_SECRET`: (Secret) Your Google Cloud OAuth Client Secret.
   - `GOOGLE_REDIRECT_URI`: `https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev/oauth/callback`
   - `GMAIL_FROM`: `Mughal Dynasty <mughaldynastyrestaurant@gmail.com>`
3. Go to **Settings** -> **KV Namespace Bindings**:
   - Variable name: `GMAIL_TOKENS_KV` (or `OAUTH_KV`)
   - KV namespace: Select your bound KV namespace.
4. Paste the contents of `worker.js` into the Cloudflare Worker Quick Edit / Code editor and click **Deploy**.

## Testing the Worker Directly
```bash
curl -X POST https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev/gmail/send \
  -H "Authorization: Bearer YOUR_SEND_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Test from Gmail Worker",
    "text": "Hello, this is a plain text test.",
    "html": "<h1>Hello</h1><p>This is an <strong>HTML</strong> test from Mughal Dynasty.</p>"
  }'
```
