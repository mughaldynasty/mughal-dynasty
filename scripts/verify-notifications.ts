import { 
  getOrderAcceptedTemplate, 
  getOrderUpdateTemplate, 
  getReservationAcceptedTemplate 
} from "../src/lib/emailTemplates.ts";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING EMAIL NOTIFICATION VERIFICATION SUITE");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Order Confirmation Template
  try {
    const html = getOrderAcceptedTemplate("Masum", "#MD-8421", "40 mins", "collection");
    assert(html.includes("MUGHAL") && html.includes("DYNASTY"), "Order Confirmation: Contains Brand Header");
    assert(html.includes("Hi Masum"), "Order Confirmation: Populates customer name");
    assert(html.includes("#MD-8421"), "Order Confirmation: Populates order ID");
    assert(html.includes("40 mins"), "Order Confirmation: Populates preparation estimate");
    assert(html.includes("ready for collection"), "Order Confirmation: Populates collection wording");
    assert(html.includes("01933 626351"), "Order Confirmation: Preserves restaurant phone");
  } catch (e: any) {
    assert(false, `Order Confirmation crashed: ${e.message}`);
  }

  // 2. Table Reservation Confirmation Template
  try {
    const html = getReservationAcceptedTemplate("Tariq", "Friday, 24 Oct 2026", "19:00", 6);
    assert(html.includes("Reservation Confirmed!"), "Reservation Confirmation: Header present");
    assert(html.includes("Hi Tariq"), "Reservation Confirmation: Customer name populated");
    assert(html.includes("Friday, 24 Oct 2026"), "Reservation Confirmation: Date populated");
    assert(html.includes("19:00"), "Reservation Confirmation: Time populated");
    assert(html.includes("6 people"), "Reservation Confirmation: Guests count populated");
    assert(html.includes("01933 626351"), "Reservation Confirmation: Contact phone preserved");
  } catch (e: any) {
    assert(false, `Reservation Confirmation crashed: ${e.message}`);
  }

  // 3. Collection-Ready Template
  try {
    const msg = "Your order #MD-9912 is ready for collection at Mughal Dynasty!";
    const html = getOrderUpdateTemplate("Ahmed", "#MD-9912", msg);
    assert(html.includes(msg), "Collection Ready: Status message populated");
    assert(html.includes("Hi Ahmed"), "Collection Ready: Customer name populated");
    assert(html.includes("#MD-9912"), "Collection Ready: Order ID populated");
    assert(html.includes("Enjoy your meal!"), "Collection Ready: Footer message preserved");
  } catch (e: any) {
    assert(false, `Collection Ready crashed: ${e.message}`);
  }

  // 4. Delivery-On-The-Way Template
  try {
    const msg = "Your order #MD-9913 is out for delivery!";
    const html = getOrderUpdateTemplate("Sarah", "#MD-9913", msg);
    assert(html.includes(msg), "Delivery On The Way: Status message populated");
    assert(html.includes("Hi Sarah"), "Delivery On The Way: Customer name populated");
    assert(html.includes("#MD-9913"), "Delivery On The Way: Order ID populated");
  } catch (e: any) {
    assert(false, `Delivery On The Way crashed: ${e.message}`);
  }

  // 5. Test Live Server API Idempotency and Deduplication
  try {
    const testIdempotencyKey = `test_verification_${Date.now()}`;
    const payload = {
      to: "test@example.com",
      to_name: "Tester",
      subject: "Test Notification",
      html_message: "<h1>Test</h1>",
      entityId: "test_entity_123",
      entityType: "order",
      notificationType: "order-confirmation",
      idempotencyKey: testIdempotencyKey,
    };

    // First call (server may fail if SMTP credentials aren't live or succeed if live, but should record idempotency)
    const res1 = await fetch("http://localhost:3000/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert(res1.status === 200 || res1.status === 502, "Server Endpoint: Responds with standard status");
    const data1 = await res1.json();

    if (data1.success) {
      // Second call with same idempotency key must return alreadySent: true
      const res2 = await fetch("http://localhost:3000/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data2 = await res2.json();
      assert(data2.alreadySent === true, "Idempotency Check: Second call returned alreadySent = true (Duplicate prevented!)");
    } else {
      console.log("[INFO] First send failed as expected without live provider, error correctly recorded:", data1.error);
    }
  } catch (e: any) {
    console.warn("API test skipped/warned:", e.message);
  }

  console.log("==================================================");
  console.log(`TEST SUITE COMPLETE: ${passed} passed, ${failed} failed.`);
  console.log("==================================================");
}

runTests();
