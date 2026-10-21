import { Handler } from "@netlify/functions";
import Stripe from "stripe";

let stripe: Stripe | null = null;

const getStripe = () => {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error("STRIPE_SECRET_KEY is missing!");
      throw new Error("STRIPE_SECRET_KEY is missing in environment variables");
    }
    stripe = new Stripe(key, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }
  return stripe;
};

export const handler: Handler = async (event) => {
  console.log("Function called:", event.httpMethod, event.path);

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Preflight OK" })
    };
  }

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }) 
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { amount, orderData } = body;

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid amount. Amount must be at least £0.30." }),
      };
    }

    const stripeInstance = getStripe();

    // Amount should be in cents
    const amountInCents = Math.round(amount * 100);

    // Minimum amount for GBP is 30p (30 cents)
    if (amountInCents < 30) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Amount must be at least £0.30" }),
      };
    }

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

    // Using automatic_payment_methods is recommended. 
    // You can manage which ones are active (Google Pay, Apple Pay, etc.) in your Stripe Dashboard.
    const paymentIntent = await stripeInstance.paymentIntents.create({
      amount: amountInCents,
      currency: "gbp",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };
  } catch (error: any) {
    console.error("Stripe Function Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal Server Error" }),
    };
  }
};
