import emailjs from '@emailjs/browser';
import { auth } from '../firebase';

/**
 * Universal email delivery service
 * 1. Primary delivery: Server-side dispatch (/api/send-email) with Cloudflare Gmail API Worker
 * 2. Secondary delivery: Server-side SMTP
 * 3. Fallback delivery: EmailJS browser client (only if server providers are unconfigured)
 */

export interface SendEmailParams {
  to_email?: string;
  to?: string;
  email?: string;
  user_email?: string;
  to_name?: string;
  name?: string;
  customer_name?: string;
  subject: string;
  message?: string;
  text?: string;
  html_message?: string;
  html?: string;
  order_id?: string;
  order_details?: string;
  entityId?: string;
  entityType?: 'order' | 'reservation' | 'test';
  notificationType?: 'order-confirmation' | 'reservation-confirmation' | 'collection-ready' | 'delivery-on-the-way' | 'test';
  idempotencyKey?: string;
  [key: string]: any;
}

export interface SendEmailResult {
  success: boolean;
  provider?: string;
  messageId?: string;
  alreadySent?: boolean;
  error?: any;
  response?: any;
}

export const sendEmail = async (params: SendEmailParams): Promise<SendEmailResult> => {
  const recipient = (params.to_email || params.to || params.email || params.user_email || "").trim();
  const recipientName = params.to_name || params.name || params.customer_name || "Customer";
  const subject = params.subject || "Notification - Mughal Dynasty";
  const htmlContent = params.html_message || params.html || "";
  const textContent = params.message || params.text || "";

  if (!recipient) {
    console.warn("[EMAIL WARNING] sendEmail called without recipient email address");
    return { success: false, error: "Recipient email is missing" };
  }

  // 1. Primary delivery attempt: Server-side route (handles Cloudflare Gmail Worker + SMTP + Idempotency)
  try {
    let token: string | null = null;
    try {
      if (auth.currentUser) {
        token = await auth.currentUser.getIdToken();
      }
    } catch (tokenErr) {
      console.warn("[EMAIL AUTH] Could not obtain Firebase user token:", tokenErr);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const apiRes = await fetch("/api/send-email", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...params,
        to_email: recipient,
        to: recipient,
        email: recipient,
        to_name: recipientName,
        name: recipientName,
        subject,
        html_message: htmlContent,
        html: htmlContent,
        message: textContent,
        text: textContent,
      }),
    });

    const data = await apiRes.json().catch(() => ({}));

    if (apiRes.ok && data.success) {
      if (data.alreadySent) {
        console.log(`[EMAIL IDEMPOTENCY] Email already sent for key '${data.idempotencyKey}' via ${data.provider}. Duplicate prevented.`);
      } else {
        console.log(`[EMAIL SUCCESS] Dispatched via server provider [${data.provider}]:`, data.messageId);
      }
      return {
        success: true,
        response: data,
        provider: data.provider || "server",
        messageId: data.messageId,
        alreadySent: data.alreadySent,
      };
    }

    // If server specifically returned fallback: 'emailjs' (providers unconfigured on server)
    if (apiRes.status === 503 && data.fallback === "emailjs") {
      console.warn("[EMAIL DISPATCH] Server providers unconfigured, proceeding to EmailJS rollback fallback");
    } else {
      // Server is configured with Worker or SMTP, but the provider returned an error
      console.error("[EMAIL ERROR] Server email dispatch failed:", data.error || `HTTP ${apiRes.status}`);
      return {
        success: false,
        error: data.error || `HTTP ${apiRes.status}`,
        provider: data.provider,
      };
    }
  } catch (apiErr) {
    console.warn("[EMAIL API] Server endpoint unreachable, checking client EmailJS fallback:", apiErr);
  }

  // 2. Secondary/Rollback delivery attempt: EmailJS browser integration
  // @ts-ignore
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  // @ts-ignore
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  // @ts-ignore
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

  if (!serviceId || !templateId || !publicKey) {
    console.warn("EmailJS configuration missing and server dispatch was not available.");
    return { success: false, error: "No email dispatch method configured" };
  }

  try {
    const response = await emailjs.send(
      serviceId,
      templateId,
      {
        ...params,
        to_email: recipient,
        email: recipient,
        to_name: recipientName,
        name: recipientName,
        subject: subject,
        message: textContent || (htmlContent ? htmlContent.replace(/<[^>]+>/g, " ") : ""),
        html_message: htmlContent,
      },
      {
        publicKey: publicKey,
      }
    );

    console.log("[EMAIL SUCCESS] Dispatched via EmailJS client fallback:", response.status, response.text);
    return { success: true, response, provider: "emailjs" };
  } catch (error) {
    console.error("[EMAIL ERROR] EmailJS dispatch failure:", error);
    return { success: false, error };
  }
};
