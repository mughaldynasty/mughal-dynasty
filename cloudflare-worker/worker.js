/**
 * Cloudflare Worker: Gmail API Mailer for Mughal Dynasty Restaurant
 * 
 * Capabilities:
 * - OAuth 2.0 flow (/oauth/login, /oauth/callback) with Google API
 * - Auto-refreshes Gmail access token using refresh_token stored in Cloudflare KV
 * - POST /gmail/send endpoint protected by Bearer SEND_API_SECRET
 * - Full RFC 2822 MIME support: multipart/alternative with HTML and plain-text fallback
 * - Retains health check endpoints (/ and /health)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(),
      });
    }

    // Health / Root Endpoints
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("Gmail OAuth Worker is running.", {
        status: 200,
        headers: { "Content-Type": "text/plain", ...getCorsHeaders() },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "gmail-worker", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCorsHeaders() },
      });
    }

    // OAuth: Initiate Login
    if (url.pathname === "/oauth/login" && request.method === "GET") {
      const redirectUri = env.GOOGLE_REDIRECT_URI || `${url.origin}/oauth/callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      return Response.redirect(authUrl.toString(), 302);
    }

    // OAuth: Callback
    if (url.pathname === "/oauth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing authorization code", { status: 400 });
      }

      const redirectUri = env.GOOGLE_REDIRECT_URI || `${url.origin}/oauth/callback`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.refresh_token) {
        return new Response(`Failed to obtain refresh token: ${JSON.stringify(tokenData)}`, { status: 500 });
      }

      // Store in KV (support either GMAIL_TOKENS_KV or OAUTH_KV binding)
      const kv = env.GMAIL_TOKENS_KV || env.OAUTH_KV || env.KV;
      if (kv) {
        await kv.put("tokens", JSON.stringify(tokenData));
      }

      return new Response("Gmail OAuth configuration complete. Refresh token saved in KV.", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Email Dispatch: POST /gmail/send
    if (url.pathname === "/gmail/send" && request.method === "POST") {
      // 1. Authenticate with Bearer token
      const authHeader = request.headers.get("Authorization") || "";
      const expectedSecret = env.SEND_API_SECRET;

      if (!expectedSecret) {
        return new Response(JSON.stringify({ error: "Worker SEND_API_SECRET not configured" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match || match[1] !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      // 2. Parse request payload
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      const { to, subject, text, html } = body;
      if (!to || !subject || (!text && !html)) {
        return new Response(JSON.stringify({ error: "Fields 'to', 'subject', and ('text' or 'html') are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      // 3. Get valid Access Token via Refresh Token from KV or Environment
      const kv = env.GMAIL_TOKENS_KV || env.OAUTH_KV || env.KV;
      let rawTokens = null;
      if (kv) {
        rawTokens = await kv.get("tokens");
        if (!rawTokens) {
          rawTokens = await kv.get("refresh_token") || await kv.get("GMAIL_REFRESH_TOKEN") || await kv.get("oauth_tokens");
        }
      }

      let tokens = null;
      if (rawTokens) {
        try {
          tokens = JSON.parse(rawTokens);
        } catch {
          // If stored directly as a raw refresh token string
          tokens = { refresh_token: rawTokens.trim() };
        }
      } else if (env.GMAIL_REFRESH_TOKEN) {
        tokens = { refresh_token: env.GMAIL_REFRESH_TOKEN.trim() };
      }

      if (!tokens || !tokens.refresh_token) {
        return new Response(JSON.stringify({ 
          error: "No OAuth tokens found in KV. Visit /oauth/login first.",
          loginUrl: `${url.origin}/oauth/login`,
        }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      const accessToken = await getFreshAccessToken(tokens, env, kv);

      // 4. Construct RFC 2822 MIME message with HTML support
      const fromAddress = env.GMAIL_FROM || "Mughal Dynasty <mughaldynastyrestaurant@gmail.com>";
      const rawMime = buildRfc2822MimeMessage({
        from: fromAddress,
        to,
        subject,
        text: text || (html ? stripHtml(html) : ""),
        html: html || undefined,
      });

      const base64UrlMessage = toBase64Url(rawMime);

      // 5. Send via Gmail API users.messages.send
      const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64UrlMessage }),
      });

      const sendData = await sendRes.json();
      if (!sendRes.ok) {
        console.error("Gmail API error:", sendData);
        return new Response(JSON.stringify({ 
          error: sendData.error?.message || "Failed to send email via Gmail API",
          details: sendData 
        }), {
          status: sendRes.status,
          headers: { "Content-Type": "application/json", ...getCorsHeaders() },
        });
      }

      return new Response(JSON.stringify({
        sent: true,
        id: sendData.id,
        messageId: sendData.id,
        threadId: sendData.threadId,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCorsHeaders() },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...getCorsHeaders() },
    });
  },
};

/**
 * Refreshes the Google OAuth access token using the stored refresh token
 */
async function getFreshAccessToken(tokens, env, kv) {
  // If access token exists and not expired, use it
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > Date.now() + 60000) {
    return tokens.access_token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token refresh error: ${JSON.stringify(data)}`);
  }

  const updatedTokens = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
  };

  await kv.put("tokens", JSON.stringify(updatedTokens));
  return data.access_token;
}

/**
 * Generates an RFC 2822 MIME message supporting plain-text and HTML
 */
function buildRfc2822MimeMessage({ from, to, subject, text, html }) {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  // Encode subject line in UTF-8 base64
  const utf8Subject = `=?UTF-8?B?${utf8ToBase64(subject)}?=`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    `MIME-Version: 1.0`,
  ];

  if (html && text) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const parts = [
      headers.join("\r\n"),
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      utf8ToBase64(text),
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      utf8ToBase64(html),
      "",
      `--${boundary}--`,
      "",
    ];
    return parts.join("\r\n");
  } else if (html) {
    headers.push("Content-Type: text/html; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    return `${headers.join("\r\n")}\r\n\r\n${utf8ToBase64(html)}\r\n`;
  } else {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    return `${headers.join("\r\n")}\r\n\r\n${utf8ToBase64(text || "")}\r\n`;
  }
}

/**
 * UTF-8 safe Base64 encoder for Cloudflare Workers / browser standard
 */
function utf8ToBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a string to base64url encoding (URL-safe without padding)
 */
function toBase64Url(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
