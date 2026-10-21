import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import dotenv from "dotenv";
import fs from "fs";
import nodemailer from "nodemailer";
import { initializeApp, getApps } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp, 
  Timestamp,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  limit
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { 
  getOrderAcceptedTemplate, 
  getOrderUpdateTemplate, 
  getReservationAcceptedTemplate 
} from "./src/lib/emailTemplates.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let stripe: Stripe | null = null;

function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }
    stripe = new Stripe(key, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }
  return stripe;
}

// In-memory cache for pending orders keyed by clientSecret or paymentIntentId
const pendingOrdersCache = new Map<string, any>();

// In-flight concurrency lock to prevent duplicate simultaneous order writes for the same payment
const inFlightPaymentConfirmations = new Map<string, Promise<string>>();

// In-memory cache for sent email notifications to guarantee instantaneous idempotency
const sentNotificationsCache = new Map<string, { status: string; provider: string; messageId: string; timestamp: number }>();

let dbInstance: any = null;
let serverAuthUser: any = null;

async function getServerDb() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const apps = getApps();
      const app = apps.length > 0 ? apps[0] : initializeApp(config);
      const auth = getAuth(app);
      if (!auth.currentUser) {
        try {
          const cred = await signInAnonymously(auth);
          serverAuthUser = cred.user;
          console.log("[SERVER FIREBASE] Signed in anonymously:", serverAuthUser.uid);
        } catch (authErr) {
          console.warn("[SERVER FIREBASE] Anonymous auth error:", authErr);
        }
      }
      if (!dbInstance) {
        dbInstance = getFirestore(app, config.firestoreDatabaseId);
      }
    }
  } catch (err) {
    console.error("Failed to initialize server-side Firestore:", err);
  }
  return dbInstance;
}

// Helper to save order to Firestore from server with 100% deterministic IDs & deduplication
async function saveOrderToFirestore(orderData: any, paymentIntentId?: string) {
  const db = await getServerDb();
  if (!db) {
    console.error("Server Firestore instance not available");
    return null;
  }

  // 1. If we have a paymentIntentId, use it as the deterministic Firestore Document ID
  if (paymentIntentId) {
    const cleanPi = paymentIntentId.trim();

    // Check if doc already exists by exact document ID
    const directDocRef = doc(db, "orders", cleanPi);
    const directSnap = await getDoc(directDocRef);
    if (directSnap.exists()) {
      console.log(`[ORDER] Order document ${cleanPi} already exists in Firestore`);
      return cleanPi;
    }

    // Also check if any order has paymentId == cleanPi (e.g. if created earlier with auto-ID)
    const existingQ = query(collection(db, "orders"), where("paymentId", "==", cleanPi));
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
      console.log(`[ORDER] Order already exists with paymentId field -> doc ${existingSnap.docs[0].id}`);
      return existingSnap.docs[0].id;
    }

    const isCollection = orderData.orderType === "collection" || orderData.type === "collection";
    const formattedAddress = !isCollection && orderData.address
      ? orderData.address
      : !isCollection
        ? `${orderData.houseNumber ? orderData.houseNumber.trim() + " " : ""}${orderData.houseName ? orderData.houseName.trim() + "\n" : ""}${orderData.streetName ? orderData.streetName.trim() : ""}\n${orderData.areaName ? orderData.areaName.trim() : ""}\n${orderData.postcode ? orderData.postcode.trim() : ""}`.trim()
        : "";

    const docData = {
      userId: orderData.userId || "guest_" + cleanPi.slice(-8),
      customerName: (orderData.customerName || "Customer").trim(),
      email: (orderData.email || "").trim(),
      items: Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : [
        { name: "Online Order (Paid)", price: Number(orderData.total) || 0, quantity: 1 }
      ],
      subtotal: Number(orderData.subtotal) || Number(orderData.total) || 0,
      discountAmount: Number(orderData.discountAmount) || 0,
      discountPercentage: Number(orderData.discountPercentage) || 0,
      deliveryFee: isCollection ? 0 : (Number(orderData.deliveryFee) || 0),
      distance: isCollection ? null : (orderData.distance || null),
      total: Number(orderData.total) || 0,
      status: "pending",
      type: isCollection ? "collection" : "delivery",
      phone: (orderData.phone || "").trim(),
      address: isCollection ? "" : formattedAddress,
      houseNumber: isCollection ? "" : (orderData.houseNumber || "").trim(),
      houseName: isCollection ? "" : (orderData.houseName || "").trim(),
      streetName: isCollection ? "" : (orderData.streetName || "").trim(),
      areaName: isCollection ? "" : (orderData.areaName || "").trim(),
      postcode: isCollection ? "" : (orderData.postcode || "").trim(),
      timeSlot: orderData.selectedTimeSlot || orderData.timeSlot || "ASAP",
      paymentMethod: "pay_online",
      paymentId: cleanPi,
      notes: (orderData.orderNotes || orderData.notes || "").trim(),
      estimate: "",
      createdAt: serverTimestamp(),
    };

    // Use deterministic document ID (cleanPi) with setDoc + merge
    await setDoc(directDocRef, docData, { merge: true });
    console.log(`[ORDER CREATED] Saved deterministic order doc ${cleanPi}`);
    return cleanPi;
  }

  // Non-paymentIntent (e.g. manual backend order)
  const isCollection = orderData.orderType === "collection" || orderData.type === "collection";
  const formattedAddress = !isCollection && orderData.address
    ? orderData.address
    : !isCollection
      ? `${orderData.houseNumber ? orderData.houseNumber.trim() + " " : ""}${orderData.houseName ? orderData.houseName.trim() + "\n" : ""}${orderData.streetName ? orderData.streetName.trim() : ""}\n${orderData.areaName ? orderData.areaName.trim() : ""}\n${orderData.postcode ? orderData.postcode.trim() : ""}`.trim()
      : "";

  const customDocId = orderData.clientOrderId || `ord_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const customDocRef = doc(db, "orders", customDocId);

  const docData = {
    userId: orderData.userId || "guest_" + Date.now(),
    customerName: (orderData.customerName || "Customer").trim(),
    email: (orderData.email || "").trim(),
    items: Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : [],
    subtotal: Number(orderData.subtotal) || Number(orderData.total) || 0,
    discountAmount: Number(orderData.discountAmount) || 0,
    discountPercentage: Number(orderData.discountPercentage) || 0,
    deliveryFee: isCollection ? 0 : (Number(orderData.deliveryFee) || 0),
    distance: isCollection ? null : (orderData.distance || null),
    total: Number(orderData.total) || 0,
    status: "pending",
    type: isCollection ? "collection" : "delivery",
    phone: (orderData.phone || "").trim(),
    address: isCollection ? "" : formattedAddress,
    houseNumber: isCollection ? "" : (orderData.houseNumber || "").trim(),
    houseName: isCollection ? "" : (orderData.houseName || "").trim(),
    streetName: isCollection ? "" : (orderData.streetName || "").trim(),
    areaName: isCollection ? "" : (orderData.areaName || "").trim(),
    postcode: isCollection ? "" : (orderData.postcode || "").trim(),
    timeSlot: orderData.selectedTimeSlot || orderData.timeSlot || "ASAP",
    paymentMethod: orderData.paymentMethod || "cash",
    paymentId: null,
    notes: (orderData.orderNotes || orderData.notes || "").trim(),
    estimate: "",
    createdAt: serverTimestamp(),
  };

  await setDoc(customDocRef, docData, { merge: true });
  console.log(`[ORDER CREATED] Saved cash/manual order doc ${customDocId}`);
  return customDocId;
}

// Automatic duplicate detector for server records (read-only on server)
async function cleanupDuplicateOrders() {
  return [];
}

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // CORS middleware for the API
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Debug middleware to log all requests
  app.use((req, res, next) => {
    if (req.url.startsWith("/api")) {
      console.log(`[API REQUEST] ${req.method} ${req.url}`);
    }
    next();
  });

  // Helper to convert HTML to clean plain text fallback
  const htmlToPlainText = (html: string): string => {
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
  };

  // Helper to verify if the requester is authorized
  const verifyRequester = async (req: express.Request, entityId?: string, entityType?: string): Promise<{ authorized: boolean; reason?: string; userEmail?: string }> => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const configPath = path.join(process.cwd(), "firebase-applet-config.json");
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          const lookupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${config.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: token }),
          });
          if (lookupRes.ok) {
            const data = await lookupRes.json();
            const user = data.users?.[0];
            if (user) {
              const email = user.email || "";
              if (email.toLowerCase() === "mughaldynastyrestaurant@gmail.com") {
                return { authorized: true, userEmail: email };
              }
              const db = await getServerDb();
              if (db) {
                const userDoc = await getDoc(doc(db, "users", user.localId));
                if (userDoc.exists() && userDoc.data()?.role === "admin") {
                  return { authorized: true, userEmail: email };
                }
              }
            }
          }
        }
      } catch (authErr) {
        console.warn("[AUTH VERIFY] Token lookup error:", authErr);
      }
    }

    // If an entityId is provided, check if it corresponds to an existing order or reservation in Firestore
    if (entityId) {
      try {
        const db = await getServerDb();
        if (db) {
          const coll = entityType === "reservation" ? "reservations" : "orders";
          const entityDoc = await getDoc(doc(db, coll, entityId));
          if (entityDoc.exists()) {
            return { authorized: true, reason: `Matched verified ${coll} doc ${entityId}` };
          }
        }
      } catch (dbErr) {
        console.warn("[AUTH VERIFY] Entity check error:", dbErr);
      }
    }

    // Allow in development or when testing directly
    if (process.env.NODE_ENV !== "production") {
      return { authorized: true, reason: "Development mode permit" };
    }

    return { authorized: false, reason: "Requester is not an authenticated admin or recognized entity" };
  };

  // Health check route
  app.get("/api/health", (req, res) => {
    const cfSecret = process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      stripeKeyPresent: !!process.env.STRIPE_SECRET_KEY,
      smtpConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
      cloudflareWorkerConfigured: !!cfSecret,
      cloudflareWorkerUrl: process.env.CLOUDFLARE_WORKER_URL || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev",
      activeEmailProvider: cfSecret ? "cloudflare-worker" : (process.env.SMTP_HOST ? "smtp" : "emailjs-fallback")
    });
  });

  // Dedicated Email Status & Diagnostics Endpoint
  app.get("/api/email-status", async (req, res) => {
    const cfSecret = process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev";
    
    let workerReachable = false;
    let workerResponseText = "";
    let workerOAuthAuthorized = false;
    let workerOAuthNotice = "";

    try {
      const ping = await fetch(workerUrl, { method: "GET" });
      workerReachable = ping.ok;
      workerResponseText = await ping.text();

      // Check if Cloudflare Worker has valid OAuth tokens in KV
      if (cfSecret && workerReachable) {
        const authCheckRes = await fetch(`${workerUrl.replace(/\/+$/, "")}/gmail/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cfSecret}`,
          },
          body: JSON.stringify({ to: "status-check@example.com", subject: "status-check", text: "status-check" }),
        });
        const authCheckData = await authCheckRes.json().catch(() => ({}));
        if (authCheckRes.ok) {
          workerOAuthAuthorized = true;
        } else if (authCheckData?.error && authCheckData.error.includes("No OAuth tokens found")) {
          workerOAuthAuthorized = false;
          workerOAuthNotice = authCheckData.error;
        } else {
          // If error is not missing tokens (e.g. rate limit, or valid tokens but test message blocked)
          workerOAuthNotice = authCheckData?.error || `HTTP ${authCheckRes.status}`;
          workerOAuthAuthorized = !authCheckData?.error?.includes("No OAuth tokens");
        }
      }
    } catch (e: any) {
      workerResponseText = e.message;
      workerOAuthNotice = e.message;
    }

    const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

    res.json({
      activeProvider: (cfSecret && workerOAuthAuthorized)
        ? "cloudflare-worker"
        : (hasSmtp ? "smtp" : (cfSecret ? "cloudflare-worker (OAuth Pending)" : "emailjs-fallback")),
      cloudflareWorker: {
        url: workerUrl,
        secretConfigured: !!cfSecret,
        reachable: workerReachable,
        oauthAuthorized: workerOAuthAuthorized,
        oauthNotice: workerOAuthNotice,
        oauthLoginUrl: `${workerUrl.replace(/\/+$/, "")}/oauth/login`,
        rootResponse: workerResponseText.slice(0, 100),
      },
      smtp: {
        configured: hasSmtp,
        host: process.env.SMTP_HOST || null,
        user: process.env.SMTP_USER ? process.env.SMTP_USER.replace(/(.{2})(.*)(@.*)/, "$1***$3") : null,
      },
      emailjs: {
        configured: !!(process.env.VITE_EMAILJS_SERVICE_ID || process.env.VITE_EMAILJS_PUBLIC_KEY),
      }
    });
  });

  // Nodemailer SMTP Transporter
  let mailTransporter: any = null;
  const getMailTransporter = () => {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT) || 587;

    if (host && user && pass) {
      if (!mailTransporter) {
        mailTransporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
      }
      return mailTransporter;
    }
    return null;
  };

  // Dispatch via Cloudflare Gmail API Worker
  const sendViaCloudflareWorker = async ({
    to,
    subject,
    text,
    html,
  }: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) => {
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev";
    const workerSecret = process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;

    if (!workerSecret) {
      throw new Error("SEND_API_SECRET is not configured on the server");
    }

    const endpoint = `${workerUrl.replace(/\/+$/, "")}/gmail/send`;
    console.log(`[CF WORKER DISPATCH] POST ${endpoint} -> to: ${to}, subject: ${subject}`);

    const cfRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${workerSecret}`,
      },
      body: JSON.stringify({
        to,
        subject,
        text,
        html,
      }),
    });

    const data = await cfRes.json().catch(() => ({}));
    if (!cfRes.ok) {
      throw new Error(data.error || `Cloudflare Worker returned HTTP ${cfRes.status}`);
    }

    return {
      success: true,
      provider: "cloudflare-worker",
      messageId: data.id || data.messageId || `cf_${Date.now()}`,
      data,
    };
  };

  // Dispatch via Server SMTP Fallback
  const sendViaSmtp = async ({
    to,
    toName,
    subject,
    text,
    html,
  }: {
    to: string;
    toName?: string;
    subject: string;
    text: string;
    html?: string;
  }) => {
    const transporter = getMailTransporter();
    if (!transporter) {
      throw new Error("SMTP credentials not configured on server");
    }

    const fromAddress = process.env.SMTP_FROM || `"Mughal Dynasty" <${process.env.SMTP_USER}>`;
    const mailOptions = {
      from: fromAddress,
      to: toName ? `"${toName}" <${to}>` : to,
      subject,
      text,
      html: html || `<div style="white-space: pre-wrap; font-family: sans-serif;">${text}</div>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[SMTP DISPATCH] Sent to ${to}: ${info.messageId}`);
    return {
      success: true,
      provider: "smtp",
      messageId: info.messageId,
    };
  };

  // Safe Email Test Endpoint (Phase 7)
  app.post("/api/send-email/test", async (req, res) => {
    try {
      const { testEmail, templateType, customData } = req.body;
      const recipient = (testEmail || "mughaldynastyrestaurant@gmail.com").trim();

      if (!recipient || !recipient.includes("@")) {
        return res.status(400).json({ error: "Valid testEmail address is required" });
      }

      const validTypes = ["order-confirmation", "reservation-confirmation", "collection-ready", "delivery-on-the-way"];
      const notifType = validTypes.includes(templateType) ? templateType : "order-confirmation";

      let subject = "";
      let htmlBody = "";
      let textBody = "";

      const sampleName = customData?.customerName || "Test Customer";
      const sampleOrderId = customData?.orderId || "#TEST-9999";

      if (notifType === "order-confirmation") {
        subject = `[TEST] Order Accepted ${sampleOrderId} - Mughal Dynasty`;
        htmlBody = getOrderAcceptedTemplate(sampleName, sampleOrderId, "35 mins", "collection");
        textBody = `[TEST]\nHi ${sampleName},\nYour test order ${sampleOrderId} has been accepted.\nEstimated Time: 35 mins.\nThank you for choosing Mughal Dynasty Restaurant.`;
      } else if (notifType === "reservation-confirmation") {
        subject = `[TEST] Table Reservation Confirmed - Mughal Dynasty Raunds`;
        const dateStr = "Friday, 24 Oct 2026";
        const timeStr = "19:30";
        htmlBody = getReservationAcceptedTemplate(sampleName, dateStr, timeStr, 4);
        textBody = `[TEST]\nDear ${sampleName},\nYour table reservation at Mughal Dynasty has been confirmed!\nDate: ${dateStr}\nTime: ${timeStr}\nGuests: 4 people.`;
      } else if (notifType === "collection-ready") {
        subject = `[TEST] Order Update ${sampleOrderId} - Mughal Dynasty`;
        const readyMsg = `Your order ${sampleOrderId} is ready for collection at Mughal Dynasty!`;
        htmlBody = getOrderUpdateTemplate(sampleName, sampleOrderId, readyMsg);
        textBody = `[TEST]\nHi ${sampleName},\n${readyMsg}\nOrder ID: ${sampleOrderId}\nEnjoy your meal!`;
      } else if (notifType === "delivery-on-the-way") {
        subject = `[TEST] Order Update ${sampleOrderId} - Mughal Dynasty`;
        const outMsg = `Your order ${sampleOrderId} is out for delivery!`;
        htmlBody = getOrderUpdateTemplate(sampleName, sampleOrderId, outMsg);
        textBody = `[TEST]\nHi ${sampleName},\n${outMsg}\nOrder ID: ${sampleOrderId}\nEnjoy your meal!`;
      }

      console.log(`[TEST EMAIL] Dispatching ${notifType} to ${recipient} (requested provider: ${req.body.provider || "auto"})`);

      const cfSecret = process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;
      const providerPref = (req.body.provider || "auto").toLowerCase();
      const workerUrl = process.env.CLOUDFLARE_WORKER_URL || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev";
      const oauthLoginUrl = `${workerUrl.replace(/\/+$/, "")}/oauth/login`;

      let result: any = null;
      let cfError: any = null;

      // 1. Try Cloudflare Worker if configured and not explicitly asking for SMTP only
      if (cfSecret && providerPref !== "smtp") {
        try {
          result = await sendViaCloudflareWorker({
            to: recipient,
            subject,
            text: textBody,
            html: htmlBody,
          });
        } catch (workerErr: any) {
          cfError = workerErr;
          console.warn(`[TEST EMAIL] Cloudflare Worker dispatch notice: ${workerErr.message}`);
        }
      }

      // If user specifically requested cloudflare worker and it failed
      if (!result && providerPref === "cloudflare") {
        const isOauthPending = cfError?.message && (cfError.message.includes("No OAuth tokens") || cfError.message.includes("/oauth/login"));
        return res.json({
          success: false,
          error: cfError?.message || "Cloudflare Worker dispatch failed",
          oauthRequired: isOauthPending,
          oauthLoginUrl,
          provider: "cloudflare-worker",
          note: isOauthPending ? "One-time Google OAuth authorization is required. Click Authorize to connect." : undefined
        });
      }

      // 2. Try SMTP fallback if Cloudflare Worker was not configured or threw an error
      if (!result) {
        try {
          result = await sendViaSmtp({
            to: recipient,
            toName: sampleName,
            subject,
            text: textBody,
            html: htmlBody,
          });
          if (cfError) {
            const isOauthPending = cfError.message && (cfError.message.includes("No OAuth tokens") || cfError.message.includes("/oauth/login"));
            result.workerNotice = cfError.message;
            result.oauthRequired = isOauthPending;
            result.oauthLoginUrl = oauthLoginUrl;
            result.provider = isOauthPending ? "smtp (Worker OAuth Pending)" : "smtp (Worker Fallback)";
            result.note = isOauthPending
              ? "Live test email delivered successfully via verified SMTP backup! One-time OAuth authorization is pending for Cloudflare Worker."
              : `Live test email delivered via SMTP backup (Worker notice: ${cfError.message})`;
          }
        } catch (smtpErr: any) {
          console.error("[TEST EMAIL] SMTP fallback failed:", smtpErr.message);
          const isOauthPending = cfError?.message && (cfError.message.includes("No OAuth tokens") || cfError.message.includes("/oauth/login"));
          return res.status(200).json({
            success: false,
            error: cfError ? `Cloudflare Worker: ${cfError.message}; SMTP: ${smtpErr.message}` : smtpErr.message,
            oauthRequired: isOauthPending,
            oauthLoginUrl,
          });
        }
      }

      return res.json({
        success: true,
        templateType: notifType,
        recipient,
        provider: result.provider,
        messageId: result.messageId,
        subject,
        oauthRequired: result.oauthRequired || false,
        oauthLoginUrl: result.oauthLoginUrl,
        note: result.note,
      });
    } catch (err: any) {
      console.error("[TEST EMAIL ERROR]:", err);
      const isOauthPending = err.message && (err.message.includes("No OAuth tokens") || err.message.includes("/oauth/login"));
      return res.status(200).json({ 
        success: false, 
        error: err.message || "Test email delivery failed",
        oauthRequired: isOauthPending,
        oauthLoginUrl: "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev/oauth/login"
      });
    }
  });

  // Production Server-side Email Dispatch Route with Idempotency & Provider Fallback
  app.post("/api/send-email", async (req, res) => {
    try {
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
      } = req.body;

      const recipient = (to || to_email || email || user_email || "").trim();
      const recipientName = to_name || name || customer_name || "Customer";
      const emailSubject = subject || "Mughal Dynasty Notification";
      const htmlBody = html || html_message || "";
      const textBody = text || message || (htmlBody ? htmlToPlainText(htmlBody) : "");

      if (!recipient) {
        return res.status(400).json({ error: "Recipient email is required" });
      }

      const cleanEntityId = entityId || order_id || "";
      const cleanEntityType = entityType || (notificationType === "reservation-confirmation" ? "reservation" : "order");
      const cleanNotifType = notificationType || "general-notification";

      // Verify authorization: check auth token or valid entity in Firestore
      const authCheck = await verifyRequester(req, cleanEntityId, cleanEntityType);
      if (!authCheck.authorized) {
        console.warn(`[EMAIL AUTH REJECTED] Unverified requester for ${recipient}. Reason: ${authCheck.reason}`);
        return res.status(401).json({ error: "Unauthorized: Requester is not permitted to trigger notifications" });
      }

      // Idempotency: Construct deterministic key
      const finalIdempotencyKey = (idempotencyKey || (cleanEntityId ? `${cleanEntityType}_${cleanEntityId}_${cleanNotifType}` : "")).trim();

      // 1. Check fast in-memory cache
      if (finalIdempotencyKey) {
        const cached = sentNotificationsCache.get(finalIdempotencyKey);
        if (cached && cached.status === "sent") {
          console.log(`[IDEMPOTENCY] Email already sent (in-memory) for key '${finalIdempotencyKey}'. Skipping duplicate.`);
          return res.json({
            success: true,
            alreadySent: true,
            idempotencyKey: finalIdempotencyKey,
            provider: cached.provider,
            messageId: cached.messageId,
          });
        }
        if (cached && cached.status === "sending" && Date.now() - cached.timestamp < 20000) {
          console.log(`[IDEMPOTENCY] Email dispatch in progress (in-memory) for '${finalIdempotencyKey}'. Skipping concurrent duplicate.`);
          return res.json({
            success: true,
            sending: true,
            idempotencyKey: finalIdempotencyKey,
          });
        }
        sentNotificationsCache.set(finalIdempotencyKey, {
          status: "sending",
          provider: "pending",
          messageId: "",
          timestamp: Date.now(),
        });
      }

      const db = await getServerDb();

      // Check if this exact notification has already been sent in Firestore
      if (db && finalIdempotencyKey) {
        try {
          const notifRef = doc(db, "email_notifications", finalIdempotencyKey);
          const notifSnap = await getDoc(notifRef);

          if (notifSnap.exists()) {
            const notifData = notifSnap.data();
            if (notifData.status === "sent") {
              console.log(`[IDEMPOTENCY] Email already sent for key '${finalIdempotencyKey}'. Skipping duplicate.`);
              sentNotificationsCache.set(finalIdempotencyKey, {
                status: "sent",
                provider: notifData.provider,
                messageId: notifData.providerMessageId || notifData.messageId,
                timestamp: Date.now(),
              });
              return res.json({
                success: true,
                alreadySent: true,
                idempotencyKey: finalIdempotencyKey,
                provider: notifData.provider,
                messageId: notifData.providerMessageId || notifData.messageId,
                sentAt: notifData.sentAt,
              });
            }

            // Concurrency guard: if currently sending within the last 20 seconds, avoid duplicate parallel request
            if (notifData.status === "sending" && notifData.updatedAt) {
              const updatedAtMs = notifData.updatedAt?.toMillis ? notifData.updatedAt.toMillis() : Date.now();
              if (Date.now() - updatedAtMs < 20000) {
                console.log(`[IDEMPOTENCY] Email dispatch already in progress for '${finalIdempotencyKey}'. Skipping concurrent call.`);
                return res.json({
                  success: true,
                  sending: true,
                  idempotencyKey: finalIdempotencyKey,
                  provider: notifData.provider,
                });
              }
            }
          }

          // Write claim document with status 'sending'
          await setDoc(notifRef, {
            idempotencyKey: finalIdempotencyKey,
            entityId: cleanEntityId,
            entityType: cleanEntityType,
            notificationType: cleanNotifType,
            recipient,
            subject: emailSubject,
            status: "sending",
            updatedAt: serverTimestamp(),
            attempts: (notifSnap.exists() ? (notifSnap.data()?.attempts || 0) + 1 : 1),
          }, { merge: true });
        } catch (idemErr) {
          console.warn("[IDEMPOTENCY] Firestore read/write error, proceeding with send:", idemErr);
        }
      }

      console.log(`[EMAIL DISPATCH] Attempting to send to ${recipient} (Subject: ${emailSubject})`);

      const cfSecret = process.env.SEND_API_SECRET || process.env.CLOUDFLARE_WORKER_SECRET;
      let sendResult: any = null;
      let dispatchError: any = null;

      // 1. Primary Method: Cloudflare Gmail API Worker
      if (cfSecret) {
        try {
          sendResult = await sendViaCloudflareWorker({
            to: recipient,
            subject: emailSubject,
            text: textBody,
            html: htmlBody,
          });
          console.log(`[EMAIL SUCCESS] Dispatched via Cloudflare Gmail Worker to ${recipient}: ${sendResult.messageId}`);
        } catch (workerErr: any) {
          console.error("[EMAIL DISPATCH] Cloudflare Worker dispatch error:", workerErr.message);
          dispatchError = workerErr;
        }
      }

      // 2. Secondary Method: Server SMTP (if worker was not configured or failed)
      if (!sendResult) {
        const transporter = getMailTransporter();
        if (transporter) {
          try {
            sendResult = await sendViaSmtp({
              to: recipient,
              toName: recipientName,
              subject: emailSubject,
              text: textBody,
              html: htmlBody,
            });
            console.log(`[EMAIL SUCCESS] Dispatched via SMTP to ${recipient}: ${sendResult.messageId}`);
          } catch (smtpErr: any) {
            console.error("[EMAIL DISPATCH] SMTP dispatch error:", smtpErr.message);
            dispatchError = smtpErr;
          }
        }
      }

      // 3. Fallback Response for EmailJS (only if server providers are unconfigured)
      if (!sendResult && !cfSecret && !getMailTransporter()) {
        console.warn("[EMAIL DISPATCH] Server email providers not configured, offering client emailjs fallback");
        return res.status(503).json({
          error: "No server email provider configured (Worker secret or SMTP)",
          fallback: "emailjs",
        });
      }

      // If sending failed after all attempts
      if (!sendResult) {
        if (db && finalIdempotencyKey) {
          try {
            await setDoc(doc(db, "email_notifications", finalIdempotencyKey), {
              status: "failed",
              error: dispatchError?.message || "All email dispatch methods failed",
              failedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }, { merge: true });
          } catch (e) {}
        }
        if (finalIdempotencyKey) {
          sentNotificationsCache.delete(finalIdempotencyKey);
        }
        return res.status(502).json({
          error: dispatchError?.message || "Failed to deliver email through configured providers",
        });
      }

      // Record in fast in-memory cache
      if (finalIdempotencyKey) {
        sentNotificationsCache.set(finalIdempotencyKey, {
          status: "sent",
          provider: sendResult.provider,
          messageId: sendResult.messageId,
          timestamp: Date.now(),
        });
      }

      // 4. Update Firestore Idempotency Record & Entity Document
      if (db) {
        try {
          if (finalIdempotencyKey) {
            await setDoc(doc(db, "email_notifications", finalIdempotencyKey), {
              status: "sent",
              provider: sendResult.provider,
              providerMessageId: sendResult.messageId,
              sentAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }, { merge: true });
          }

          // Record notification details in parent order or reservation document
          if (cleanEntityId && cleanNotifType) {
            const coll = cleanEntityType === "reservation" ? "reservations" : "orders";
            const updatePayload: Record<string, any> = {
              [`emailNotifications.${cleanNotifType}`]: {
                sentAt: serverTimestamp(),
                provider: sendResult.provider,
                messageId: sendResult.messageId,
                recipient,
              }
            };
            await updateDoc(doc(db, coll, cleanEntityId), updatePayload).catch(() => {});
          }
        } catch (dbErr) {
          console.warn("[EMAIL RECORD] Failed to record send in Firestore:", dbErr);
        }
      }

      return res.json({
        success: true,
        provider: sendResult.provider,
        messageId: sendResult.messageId,
        idempotencyKey: finalIdempotencyKey,
      });
    } catch (err: any) {
      console.error("[EMAIL DISPATCH FATAL ERROR]:", err);
      return res.status(500).json({ error: err.message || "Failed to process email dispatch" });
    }
  });

  // Stripe Payment Intent Route with complete Order Metadata
  app.post("/api/create-payment-intent", async (req, res) => {
    console.log("Received payment intent request:", req.body);
    try {
      const { amount, orderData } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const stripeClient = getStripe();
      
      // Amount in cents
      const amountInCents = Math.round(amount * 100);

      // Create metadata fields (keeping within Stripe's 500 char limit per value)
      const metadata: Record<string, string> = {
        customerName: orderData?.customerName ? String(orderData.customerName).slice(0, 100) : "Guest",
        phone: orderData?.phone ? String(orderData.phone).slice(0, 30) : "",
        email: orderData?.email ? String(orderData.email).slice(0, 100) : "",
        orderType: orderData?.orderType || "delivery",
        timeSlot: orderData?.selectedTimeSlot || orderData?.timeSlot || "ASAP",
        postcode: orderData?.postcode ? String(orderData.postcode).slice(0, 20) : "",
        total: String(amount),
        deliveryFee: String(orderData?.deliveryFee || 0),
        discountAmount: String(orderData?.discountAmount || 0),
      };

      if (orderData?.address) {
        metadata.address = String(orderData.address).replace(/\n/g, ", ").slice(0, 300);
      }
      if (orderData?.orderNotes) {
        metadata.notes = String(orderData.orderNotes).slice(0, 200);
      }
      if (orderData?.items && Array.isArray(orderData.items)) {
        const itemsSummary = orderData.items
          .map((i: any) => `${i.quantity}x ${i.name}${i.variant ? ` (${i.variant})` : ''}`)
          .join("; ");
        metadata.itemsSummary = itemsSummary.slice(0, 450);
      }

      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: amountInCents,
        currency: "gbp",
        automatic_payment_methods: {
          enabled: true,
        },
        metadata,
      });

      // Cache the full order payload in memory
      if (orderData) {
        pendingOrdersCache.set(paymentIntent.id, {
          ...orderData,
          total: amount,
          paymentIntentId: paymentIntent.id,
          timestamp: Date.now(),
        });
        if (paymentIntent.client_secret) {
          pendingOrdersCache.set(paymentIntent.client_secret, {
            ...orderData,
            total: amount,
            paymentIntentId: paymentIntent.id,
            timestamp: Date.now(),
          });
        }
      }

      res.json({ 
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error: any) {
      console.error("Stripe Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Verify and Confirm Order Payment (Called by Client or Background Verification)
  app.post("/api/confirm-order-payment", async (req, res) => {
    try {
      const { paymentIntentId, clientSecret, orderData } = req.body;
      const stripeClient = getStripe();

      let piId = paymentIntentId;
      if (!piId && clientSecret) {
        piId = clientSecret.split("_secret_")[0];
      }

      if (!piId) {
        return res.status(400).json({ error: "Missing payment intent identifier" });
      }

      const cleanPiId = String(piId).trim();

      // Check if there is already an in-flight confirmation for this payment
      if (inFlightPaymentConfirmations.has(cleanPiId)) {
        console.log(`[CONCURRENCY] Awaiting in-flight confirmation for ${cleanPiId}`);
        const existingOrderId = await inFlightPaymentConfirmations.get(cleanPiId)!;
        return res.json({
          success: true,
          orderId: existingOrderId,
          paymentStatus: "succeeded",
        });
      }

      // Create new confirmation promise and register in map
      const confirmationPromise = (async () => {
        const paymentIntent = await stripeClient.paymentIntents.retrieve(cleanPiId);
        if (!paymentIntent) {
          throw new Error("Payment Intent not found");
        }

        if (paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing") {
          throw new Error(`Payment has not succeeded. Current status: ${paymentIntent.status}`);
        }

        // Reconstruct order data
        const cached = pendingOrdersCache.get(cleanPiId) || (clientSecret ? pendingOrdersCache.get(clientSecret) : null);
        const effectiveOrderData = orderData || cached || {
          customerName: paymentIntent.metadata?.customerName || "Customer",
          email: paymentIntent.metadata?.email || "",
          phone: paymentIntent.metadata?.phone || "",
          orderType: paymentIntent.metadata?.orderType || "delivery",
          address: paymentIntent.metadata?.address || "",
          postcode: paymentIntent.metadata?.postcode || "",
          selectedTimeSlot: paymentIntent.metadata?.timeSlot || "ASAP",
          orderNotes: paymentIntent.metadata?.notes || "",
          total: paymentIntent.amount / 100,
          subtotal: (paymentIntent.amount / 100) - (Number(paymentIntent.metadata?.deliveryFee) || 0) + (Number(paymentIntent.metadata?.discountAmount) || 0),
          deliveryFee: Number(paymentIntent.metadata?.deliveryFee) || 0,
          discountAmount: Number(paymentIntent.metadata?.discountAmount) || 0,
          items: paymentIntent.metadata?.itemsSummary ? [
            { name: paymentIntent.metadata.itemsSummary, price: paymentIntent.amount / 100, quantity: 1 }
          ] : [
            { name: "Online Order (Apple Pay / Stripe)", price: paymentIntent.amount / 100, quantity: 1 }
          ]
        };

        const createdId = await saveOrderToFirestore(effectiveOrderData, cleanPiId);
        return createdId || cleanPiId;
      })();

      inFlightPaymentConfirmations.set(cleanPiId, confirmationPromise);

      const orderId = await confirmationPromise;
      setTimeout(() => inFlightPaymentConfirmations.delete(cleanPiId), 5000);

      res.json({
        success: true,
        orderId,
        paymentStatus: "succeeded"
      });
    } catch (error: any) {
      console.error("Error confirming order payment:", error);
      res.status(500).json({ error: error.message || "Failed to confirm payment" });
    }
  });

  // Stripe Webhook handler for instant background payment processing
  app.post("/api/stripe-webhook", async (req, res) => {
    try {
      const event = req.body;
      console.log(`[STRIPE WEBHOOK] Received event: ${event?.type}`);

      if (event?.type === "payment_intent.succeeded") {
        const paymentIntent = event.data?.object as Stripe.PaymentIntent;
        if (paymentIntent) {
          console.log(`[STRIPE WEBHOOK] Payment succeeded for ${paymentIntent.id}, amount: £${paymentIntent.amount / 100}`);
          
          const cached = pendingOrdersCache.get(paymentIntent.id);
          const orderData = cached || {
            customerName: paymentIntent.metadata?.customerName || "Customer",
            email: paymentIntent.metadata?.email || "",
            phone: paymentIntent.metadata?.phone || "",
            orderType: paymentIntent.metadata?.orderType || "delivery",
            address: paymentIntent.metadata?.address || "",
            postcode: paymentIntent.metadata?.postcode || "",
            selectedTimeSlot: paymentIntent.metadata?.timeSlot || "ASAP",
            orderNotes: paymentIntent.metadata?.notes || "",
            total: paymentIntent.amount / 100,
            deliveryFee: Number(paymentIntent.metadata?.deliveryFee) || 0,
            discountAmount: Number(paymentIntent.metadata?.discountAmount) || 0,
            items: paymentIntent.metadata?.itemsSummary ? [
              { name: paymentIntent.metadata.itemsSummary, price: paymentIntent.amount / 100, quantity: 1 }
            ] : [
              { name: "Online Order (Apple Pay / Card)", price: paymentIntent.amount / 100, quantity: 1 }
            ]
          };

          await saveOrderToFirestore(orderData, paymentIntent.id);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook processing error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin Duplicate Cleanup Endpoint
  app.all(["/api/cleanup-duplicate-orders"], async (req, res) => {
    try {
      const deletedIds = await cleanupDuplicateOrders();
      res.json({
        success: true,
        deletedCount: deletedIds?.length || 0,
        deletedIds
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin Recovery Endpoint to scan recent Stripe payments and ensure all are in Firestore
  app.all(["/api/recover-missing-stripe-orders", "/api/sync-stripe-orders"], async (req, res) => {
    try {
      const stripeClient = getStripe();
      const db = await getServerDb();
      if (!db) {
        return res.status(500).json({ error: "Firestore not initialized on server" });
      }

      console.log("[RECOVERY] Scanning recent Stripe payments for missing orders...");
      
      // First clean up any existing duplicate records
      await cleanupDuplicateOrders();

      // Fetch latest succeeded payments from Stripe
      const payments = await stripeClient.paymentIntents.list({
        limit: 50,
      });

      const recoveredOrders: any[] = [];
      const succeededPayments = payments.data.filter(p => p.status === "succeeded");

      for (const pi of succeededPayments) {
        // Check if order exists in Firestore by ID or paymentId field
        const directSnap = await getDoc(doc(db, "orders", pi.id));
        if (!directSnap.exists()) {
          const existingQ = query(collection(db, "orders"), where("paymentId", "==", pi.id));
          const existingSnap = await getDocs(existingQ);

          if (existingSnap.empty) {
            console.log(`[RECOVERY] Found missing order for payment ${pi.id} (Amount: £${pi.amount / 100})! Reconstructing...`);
            
            const cached = pendingOrdersCache.get(pi.id);
            const orderData = cached || {
              customerName: pi.metadata?.customerName || "Customer (Apple Pay)",
              email: pi.metadata?.email || "",
              phone: pi.metadata?.phone || "07000000000",
              orderType: pi.metadata?.orderType || "delivery",
              address: pi.metadata?.address || "",
              postcode: pi.metadata?.postcode || "",
              selectedTimeSlot: pi.metadata?.timeSlot || "ASAP",
              orderNotes: pi.metadata?.notes || "",
              total: pi.amount / 100,
              deliveryFee: Number(pi.metadata?.deliveryFee) || 0,
              discountAmount: Number(pi.metadata?.discountAmount) || 0,
              items: pi.metadata?.itemsSummary ? [
                { name: pi.metadata.itemsSummary, price: pi.amount / 100, quantity: 1 }
              ] : [
                { name: `Online Order (Paid via Stripe/Apple Pay £${(pi.amount / 100).toFixed(2)})`, price: pi.amount / 100, quantity: 1 }
              ]
            };

            const docId = await saveOrderToFirestore(orderData, pi.id);
            recoveredOrders.push({
              id: docId,
              paymentId: pi.id,
              amount: pi.amount / 100,
              customerName: orderData.customerName,
              createdAt: new Date(pi.created * 1000).toISOString()
            });
          }
        }
      }

      console.log(`[RECOVERY] Scan complete. Recovered ${recoveredOrders.length} missing order(s).`);
      res.json({
        success: true,
        checkedCount: succeededPayments.length,
        recoveredCount: recoveredOrders.length,
        recoveredOrders
      });
    } catch (error: any) {
      console.error("Error during Stripe recovery scan:", error);
      res.status(500).json({ error: error.message || "Failed to scan Stripe payments" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

