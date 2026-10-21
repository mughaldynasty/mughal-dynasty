import { Handler, HandlerEvent } from "@netlify/functions";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Firestore,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Safe fallback for Firebase configuration
const resolvedFirebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  appId: process.env.FIREBASE_APP_ID || firebaseConfig.appId,
  apiKey: process.env.FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  firestoreDatabaseId:
    process.env.FIREBASE_DATABASE_ID ||
    firebaseConfig.firestoreDatabaseId ||
    "(default)",
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    firebaseConfig.messagingSenderId,
};

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;

function getDb(): Firestore | null {
  try {
    if (!appInstance) {
      const apps = getApps();
      appInstance =
        apps.length > 0 ? apps[0] : initializeApp(resolvedFirebaseConfig);
    }
    if (!dbInstance && appInstance) {
      dbInstance = getFirestore(
        appInstance,
        resolvedFirebaseConfig.firestoreDatabaseId
      );
    }
    return dbInstance;
  } catch (err) {
    console.error("[FIREBASE INIT] Firestore init error:", err);
    return null;
  }
}

// Convert HTML to clean plain text fallback
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n\n$1\n\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n* ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&pound;/gi, "£")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Verifies request authorization:
 * 1. Checks Firebase ID token via Google Identity Toolkit
 * 2. Verifies if email is admin (mughaldynastyrestaurant@gmail.com) or users/{uid}.role === 'admin'
 * 3. Or validates that entityId exists in orders or reservations
 */
async function verifyRequester(
  event: HandlerEvent,
  entityId?: string,
  entityType?: string,
  db?: Firestore | null
): Promise<{ authorized: boolean; reason?: string }> {
  const authHeader =
    event.headers["authorization"] || event.headers["Authorization"];

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && resolvedFirebaseConfig.apiKey) {
      try {
        const lookupRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${resolvedFirebaseConfig.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: token }),
          }
        );

        if (lookupRes.ok) {
          const data = await lookupRes.json();
          const user = data.users?.[0];
          if (user) {
            const email = (user.email || "").toLowerCase();
            if (email === "mughaldynastyrestaurant@gmail.com") {
              return { authorized: true, reason: "Verified admin email" };
            }

            if (db && user.localId) {
              const userDoc = await getDoc(doc(db, "users", user.localId));
              if (userDoc.exists() && userDoc.data()?.role === "admin") {
                return { authorized: true, reason: "Verified admin role" };
              }
            }
          }
        }
      } catch (authErr) {
        console.warn("[AUTH VERIFY] Token lookup error:", authErr);
      }
    }
  }

  // Check if caller is fulfilling an existing verified order or reservation
  if (entityId && db) {
    try {
      const coll = entityType === "reservation" ? "reservations" : "orders";
      const entityDoc = await getDoc(doc(db, coll, entityId));
      if (entityDoc.exists()) {
        return { authorized: true, reason: `Matched verified ${coll} doc` };
      }
    } catch (dbErr) {
      console.warn("[AUTH VERIFY] Entity check error:", dbErr);
    }
  }

  // Development environment check
  if (process.env.NODE_ENV !== "production") {
    return { authorized: true, reason: "Development mode permit" };
  }

  return {
    authorized: false,
    reason: "Requester is not an authenticated admin or recognized entity",
  };
}

export const handler: Handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // 1. Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Preflight OK" }),
    };
  }

  // 2. Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  // 3. Parse JSON body
  let body: any = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const {
    to,
    to_email,
    email,
    user_email,
    subject,
    html,
    html_message,
    text,
    message,
    to_name,
    name,
    customer_name,
    order_id,
    entityId,
    entityType,
    notificationType,
    idempotencyKey,
  } = body;

  const recipient = (to || to_email || email || user_email || "").trim();
  const emailSubject = subject || "Mughal Dynasty Notification";
  const htmlBody = html || html_message || "";
  const textBody =
    text || message || (htmlBody ? htmlToPlainText(htmlBody) : "");

  if (!recipient) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Recipient email is required" }),
    };
  }

  if (!emailSubject) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Email subject is required" }),
    };
  }

  if (!htmlBody && !textBody) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: "Email content ('html' or 'text') is required",
      }),
    };
  }

  const cleanEntityId = entityId || order_id || "";
  const cleanEntityType =
    entityType ||
    (notificationType === "reservation-confirmation" ? "reservation" : "order");
  const cleanNotifType = notificationType || "general-notification";

  const db = getDb();

  // 4. Authenticate Request
  const authCheck = await verifyRequester(
    event,
    cleanEntityId,
    cleanEntityType,
    db
  );
  if (!authCheck.authorized) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({
        error: "Unauthorized: Requester is not permitted to trigger notifications",
      }),
    };
  }

  // 5. Check Cloudflare Worker Configuration
  const workerSecret =
    process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;
  const workerUrl =
    process.env.CLOUDFLARE_WORKER_URL ||
    "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev";

  if (!workerSecret) {
    // Unconfigured server provider: return 503 with fallback flag for client EmailJS
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: "Server email provider not configured (SEND_API_SECRET)",
        fallback: "emailjs",
      }),
    };
  }

  // 6. Idempotency Check via Firestore
  const finalIdempotencyKey = (
    idempotencyKey ||
    (cleanEntityId
      ? `${cleanEntityType}_${cleanEntityId}_${cleanNotifType}`
      : "")
  ).trim();

  let notifRef: any = null;
  let notifSnap: any = null;

  if (db && finalIdempotencyKey) {
    try {
      notifRef = doc(db, "email_notifications", finalIdempotencyKey);
      notifSnap = await getDoc(notifRef);

      if (notifSnap.exists()) {
        const notifData = notifSnap.data();

        // Already successfully sent
        if (notifData.status === "sent") {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              alreadySent: true,
              idempotencyKey: finalIdempotencyKey,
              provider: notifData.provider || "cloudflare-worker",
              messageId: notifData.providerMessageId || notifData.messageId,
              sentAt: notifData.sentAt,
            }),
          };
        }

        // Concurrency Guard: if dispatch in progress within the last 20 seconds, avoid duplicate dispatch
        if (notifData.status === "sending" && notifData.updatedAt) {
          const updatedAtMs = notifData.updatedAt?.toMillis
            ? notifData.updatedAt.toMillis()
            : Date.now();
          if (Date.now() - updatedAtMs < 20000) {
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                sending: true,
                idempotencyKey: finalIdempotencyKey,
                provider: notifData.provider || "cloudflare-worker",
              }),
            };
          }
        }
      }

      // Claim record as 'sending'
      await setDoc(
        notifRef,
        {
          idempotencyKey: finalIdempotencyKey,
          entityId: cleanEntityId,
          entityType: cleanEntityType,
          notificationType: cleanNotifType,
          status: "sending",
          updatedAt: serverTimestamp(),
          attempts: notifSnap.exists()
            ? (notifSnap.data()?.attempts || 0) + 1
            : 1,
        },
        { merge: true }
      );
    } catch (idemErr) {
      console.warn("[IDEMPOTENCY] Firestore read/write error:", idemErr);
    }
  }

  // 7. Dispatch to Cloudflare Worker
  const workerEndpoint = `${workerUrl.replace(/\/+$/, "")}/gmail/send`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const cfRes = await fetch(workerEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        to: recipient,
        subject: emailSubject,
        text: textBody,
        html: htmlBody || undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data: any = await cfRes.json().catch(() => ({}));

    if (!cfRes.ok) {
      const errorMessage =
        data.error || `Cloudflare Worker returned HTTP ${cfRes.status}`;

      if (db && notifRef) {
        await setDoc(
          notifRef,
          {
            status: "failed",
            error: errorMessage,
            failedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      }

      return {
        statusCode: cfRes.status >= 500 ? 502 : 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: errorMessage,
          provider: "cloudflare-worker",
        }),
      };
    }

    const messageId = data.id || data.messageId || `cf_${Date.now()}`;

    // Mark as sent in Firestore
    if (db && notifRef) {
      await setDoc(
        notifRef,
        {
          status: "sent",
          provider: "cloudflare-worker",
          providerMessageId: messageId,
          sentAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        provider: "cloudflare-worker",
        messageId,
        alreadySent: false,
        idempotencyKey: finalIdempotencyKey,
      }),
    };
  } catch (fetchErr: any) {
    const isTimeout = fetchErr.name === "AbortError";
    const errorMessage = isTimeout
      ? "Worker request timed out after 15 seconds"
      : fetchErr.message || "Worker dispatch failed";

    if (db && notifRef) {
      await setDoc(
        notifRef,
        {
          status: "failed",
          error: errorMessage,
          failedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }

    // Do NOT fall back to EmailJS after an ambiguous timeout
    return {
      statusCode: 504,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        provider: "cloudflare-worker",
      }),
    };
  }
};
