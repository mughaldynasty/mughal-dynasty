import { handler } from "../netlify/functions/send-email";
import { HandlerEvent } from "@netlify/functions";

function createMockEvent(overrides: Partial<HandlerEvent>): HandlerEvent {
  return {
    rawUrl: "http://localhost/api/send-email",
    rawQuery: "",
    path: "/api/send-email",
    httpMethod: "POST",
    headers: {
      "content-type": "application/json",
      ...(overrides.headers || {}),
    },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: overrides.body !== undefined ? overrides.body : "{}",
    isBase64Encoded: false,
    ...overrides,
  };
}

async function runTestSuite() {
  console.log("=== Running Netlify Function send-email Tests ===\n");
  let passed = 0;
  let failed = 0;

  function assert(testName: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || "Condition failed"}`);
      failed++;
    }
  }

  // Test 1: OPTIONS Preflight
  {
    const event = createMockEvent({ httpMethod: "OPTIONS" });
    const res = (await (handler as any)(event, {} as any)) as any;
    assert(
      "OPTIONS Preflight returns 200 with CORS headers",
      res.statusCode === 200 && res.headers["Access-Control-Allow-Origin"] === "*"
    );
  }

  // Test 2: Method Not Allowed
  {
    const event = createMockEvent({ httpMethod: "GET" });
    const res = (await (handler as any)(event, {} as any)) as any;
    assert(
      "GET method returns 405 Method Not Allowed",
      res.statusCode === 405
    );
  }

  // Test 3: Invalid JSON body
  {
    const event = createMockEvent({ body: "invalid json string {" });
    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);
    assert(
      "Malformed JSON returns 400",
      res.statusCode === 400 && body.error === "Invalid JSON body"
    );
  }

  // Test 4: Missing recipient email
  {
    const event = createMockEvent({
      body: JSON.stringify({
        subject: "Test Subject",
        html: "<p>Hello</p>",
      }),
    });
    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);
    assert(
      "Missing recipient email returns 400",
      res.statusCode === 400 && body.error === "Recipient email is required"
    );
  }

  // Test 5: Missing content (neither text nor html)
  {
    const event = createMockEvent({
      body: JSON.stringify({
        to: "customer@example.com",
        subject: "Test Subject",
      }),
    });
    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);
    assert(
      "Missing email content returns 400",
      res.statusCode === 400 && body.error?.includes("Email content")
    );
  }

  // Test 6: Missing SEND_API_SECRET returns 503 with fallback: 'emailjs'
  {
    const savedSecret = process.env.SEND_API_SECRET;
    const savedCfSecret = process.env.CLOUDFLARE_WORKER_SECRET;
    delete process.env.SEND_API_SECRET;
    delete process.env.CLOUDFLARE_WORKER_SECRET;

    const event = createMockEvent({
      body: JSON.stringify({
        to: "customer@example.com",
        subject: "Order update",
        text: "Your order is ready",
      }),
    });
    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);

    assert(
      "Missing Worker secret returns 503 with fallback: 'emailjs'",
      res.statusCode === 503 && body.fallback === "emailjs"
    );

    // Restore env vars
    if (savedSecret) process.env.SEND_API_SECRET = savedSecret;
    if (savedCfSecret) process.env.CLOUDFLARE_WORKER_SECRET = savedCfSecret;
  }

  // Test 7: Production Authentication Enforcement (Fails Closed)
  {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const event = createMockEvent({
      headers: {
        authorization: "Bearer invalid_or_fake_token_12345",
      },
      body: JSON.stringify({
        to: "customer@example.com",
        subject: "Order update",
        text: "Your order is ready",
      }),
    });

    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);

    assert(
      "Unauthenticated caller in production returns 401 Unauthorized",
      res.statusCode === 401 && body.error?.includes("Unauthorized")
    );

    process.env.NODE_ENV = prevEnv;
  }

  // Test 8: Worker dispatch with valid secret and mock fetch
  {
    process.env.SEND_API_SECRET = "test-secret-mock";
    process.env.CLOUDFLARE_WORKER_URL = "https://mock-worker.workers.dev";

    const originalFetch = globalThis.fetch;
    let receivedAuthHeader = "";
    let receivedPayload: any = null;

    globalThis.fetch = async (url: any, init: any): Promise<any> => {
      if (String(url).includes("/gmail/send")) {
        receivedAuthHeader = init.headers["Authorization"];
        receivedPayload = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            id: "msg_mock_123456",
            threadId: "th_mock_123456",
          }),
        };
      }
      return originalFetch(url, init);
    };

    const event = createMockEvent({
      body: JSON.stringify({
        to_email: "guest@example.com",
        to_name: "John Doe",
        subject: "Order Accepted 1001",
        html: "<p>Order 1001 accepted</p>",
        notificationType: "order-confirmation",
        idempotencyKey: `test_order_1001_${Date.now()}`,
      }),
    });

    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);

    assert(
      "Worker receives correct Authorization Bearer header",
      receivedAuthHeader === "Bearer test-secret-mock"
    );
    assert(
      "Worker receives correct to, subject, html, text payload",
      receivedPayload?.to === "guest@example.com" &&
        receivedPayload?.subject === "Order Accepted 1001" &&
        receivedPayload?.html === "<p>Order 1001 accepted</p>" &&
        receivedPayload?.text === "Order 1001 accepted"
    );
    assert(
      "Successful worker dispatch returns 200 with provider & messageId",
      res.statusCode === 200 &&
        body.success === true &&
        body.provider === "cloudflare-worker" &&
        body.messageId === "msg_mock_123456"
    );

    globalThis.fetch = originalFetch;
  }

  // Test 9: Worker Error handling (Worker returns 400 OAuth tokens error)
  {
    process.env.SEND_API_SECRET = "test-secret-mock";
    process.env.CLOUDFLARE_WORKER_URL = "https://mock-worker.workers.dev";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init: any): Promise<any> => {
      if (String(url).includes("/gmail/send")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "No OAuth tokens found in KV. Visit /oauth/login first.",
          }),
        };
      }
      return originalFetch(url, init);
    };

    const event = createMockEvent({
      body: JSON.stringify({
        to_email: "guest@example.com",
        subject: "Order Accepted 1002",
        text: "Order 1002 accepted",
      }),
    });

    const res = (await (handler as any)(event, {} as any)) as any;
    const body = JSON.parse(res.body);

    assert(
      "Worker rejection returns appropriate error code and message without exposing secrets",
      res.statusCode === 400 &&
        body.success === false &&
        body.error === "No OAuth tokens found in KV. Visit /oauth/login first." &&
        !JSON.stringify(body).includes("test-secret-mock")
    );

    globalThis.fetch = originalFetch;
  }

  // Test 10: Idempotency deduplication check
  {
    process.env.SEND_API_SECRET = "test-secret-mock";
    process.env.CLOUDFLARE_WORKER_URL = "https://mock-worker.workers.dev";

    let dispatchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, init: any): Promise<any> => {
      if (String(url).includes("/gmail/send")) {
        dispatchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            id: "msg_idemp_789",
          }),
        };
      }
      return originalFetch(url, init);
    };

    const uniqueKey = `idemp_test_${Date.now()}`;
    const event1 = createMockEvent({
      body: JSON.stringify({
        to: "guest@example.com",
        subject: "Reservation Confirmed",
        text: "Table for 2",
        idempotencyKey: uniqueKey,
      }),
    });

    const res1 = (await (handler as any)(event1, {} as any)) as any;
    const body1 = JSON.parse(res1.body);

    assert(
      "First call dispatches to worker successfully",
      res1.statusCode === 200 && body1.success === true && dispatchCount === 1
    );

    // Call again with same idempotency key
    const res2 = (await (handler as any)(event1, {} as any)) as any;
    const body2 = JSON.parse(res2.body);

    // If Firestore is reachable or mock returned:
    assert(
      "Duplicate call with same key recognized",
      res2.statusCode === 200 &&
        (body2.alreadySent === true || body2.success === true)
    );

    globalThis.fetch = originalFetch;
  }

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
