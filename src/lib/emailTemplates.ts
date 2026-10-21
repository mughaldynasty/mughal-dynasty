
export const emailBrandColor = "#ea580c";
export const emailHeaderBg = "#0d0d0d";

const wrapperStyle = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  border: 1px solid #1f2937;
  border-top: 4px solid ${emailBrandColor};
  border-radius: 12px;
  overflow: hidden;
  background-color: #ffffff;
  color: #111827;
`;

const headerStyle = `
  padding: 32px 24px;
  text-align: center;
  background-color: ${emailHeaderBg};
`;

const contentStyle = `
  padding: 40px 32px;
`;

const footerStyle = `
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #e5e7eb;
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
`;

const buttonStyle = `
  display: inline-block;
  padding: 12px 24px;
  background-color: ${emailBrandColor};
  color: #ffffff;
  text-decoration: none;
  border-radius: 8px;
  font-weight: bold;
  margin-top: 20px;
`;

export const getOrderAcceptedTemplate = (name: string, orderId: string, estimate: string, type: string) => `
  <div style="${wrapperStyle}">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <h2 style="color: #c2410c; margin-top: 0; font-size: 24px;">Order Accepted!</h2>
      <p style="font-size: 16px; line-height: 1.6;">Hi ${name},</p>
      <p style="font-size: 16px; line-height: 1.6;">Your order has been accepted and is now being prepared.</p>
      
      <div style="background-color: #fff7ed; border: 1px solid #ffedd5; padding: 24px; border-radius: 16px; margin: 24px 0;">
         <p style="font-size: 18px; margin: 0; color: #9a3412;"><strong>Estimated Time:</strong> ${estimate}</p>
         <p style="font-size: 14px; margin: 8px 0 0 0; color: #c2410c;">Order ID: ${orderId}</p>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6;">We will notify you once it's ${type === "collection" ? "ready for collection" : "on its way to you"}.</p>
      
      <div style="${footerStyle}">
        <p>Thank you for choosing Mughal Dynasty Restaurant.</p>
        <p>01933 626351 | High Street, Raunds</p>
      </div>
    </div>
  </div>
`;

export const getOrderUpdateTemplate = (name: string, orderId: string, message: string) => `
  <div style="${wrapperStyle}">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <p style="font-size: 16px; line-height: 1.6;">Hi ${name},</p>
      <div style="background-color: #fff7ed; border: 1px solid #ffedd5; padding: 32px 24px; border-radius: 16px; margin: 24px 0; text-align: center;">
         <p style="font-size: 22px; font-weight: bold; color: #c2410c; margin: 0; line-height: 1.4;">${message}</p>
      </div>
      <p style="font-size: 14px; color: #64748b; text-align: center;">Order ID: ${orderId}</p>
      <div style="${footerStyle}">
        <p>Enjoy your meal! Please leave us a review if you enjoyed it.</p>
        <p>&copy; 2026 Mughal Dynasty Restaurant.</p>
      </div>
    </div>
  </div>
`;

export const getOrderCancelledTemplate = (name: string, orderId: string) => `
  <div style="${wrapperStyle}; border-top-color: #ef4444;">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <h2 style="color: #b91c1c; margin-top: 0; font-size: 24px;">Order Cancelled</h2>
      <p style="font-size: 16px; line-height: 1.6;">Hi ${name},</p>
      <p style="font-size: 16px; line-height: 1.6;">We're sorry, but your order <strong>${orderId}</strong> has been cancelled.</p>
      <p style="font-size: 16px; line-height: 1.6;">If you have already paid online, a refund will be processed automatically within 3-5 working days.</p>
      <p style="font-size: 16px; line-height: 1.6;">Please contact the restaurant at 01933 626351 for more details.</p>
      <div style="${footerStyle}">
        <p>Mughal Dynasty Raunds</p>
      </div>
    </div>
  </div>
`;

export const getOrderConfirmationTemplate = (name: string, orderId: string, details: string, total: string) => `
  <div style="${wrapperStyle}">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <h2 style="color: #c2410c; margin-top: 0; font-size: 24px;">Order Received</h2>
      <p style="font-size: 16px; line-height: 1.6;">Hi ${name},</p>
      <p style="font-size: 16px; line-height: 1.6;">Thank you for your order! We have received it and it's currently awaiting approval from our kitchen staff.</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 24px; border-radius: 16px; margin: 24px 0;">
        <p style="font-size: 14px; text-transform: uppercase; color: #64748b; font-weight: bold; margin-bottom: 12px; letter-spacing: 1px;">Order Summary</p>
        <div style="font-family: monospace; white-space: pre-wrap; margin-bottom: 16px; font-size: 15px;">${details}</div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 12px; display: flex; justify-content: space-between;">
          <span style="font-weight: bold; font-size: 18px;">Total</span>
          <span style="font-weight: bold; font-size: 18px; color: ${emailBrandColor};">${total}</span>
        </div>
      </div>
      
      <p style="font-size: 14px; color: #64748b;">Order ID: ${orderId}</p>
      <p style="font-size: 16px; line-height: 1.6;">We will send you another email as soon as we accept your order and give you an estimated time.</p>
      
      <div style="${footerStyle}">
        <p>Mughal Dynasty Restaurant - Traditional Indian Cuisine</p>
      </div>
    </div>
  </div>
`;

export const getAdminNewOrderTemplate = (orderId: string, customerName: string, phone: string, type: string, total: string, details: string, address: string | null, timeSlot: string, notes: string | null) => `
  <div style="${wrapperStyle}; border-top-color: #ea580c;">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <h2 style="color: #c2410c; margin-top: 0; font-size: 24px;">New ${type.toUpperCase()} Order!</h2>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 24px; border-radius: 16px; margin: 24px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Order ID:</strong> ${orderId}</p>
        <p style="margin: 0 0 8px 0;"><strong>Customer:</strong> ${customerName}</p>
        <p style="margin: 0 0 8px 0;"><strong>Phone:</strong> ${phone}</p>
        <p style="margin: 0 0 8px 0;"><strong>Time Slot:</strong> ${timeSlot}</p>
        ${address ? `<p style="margin: 0 0 8px 0;"><strong>Address:</strong> ${address}</p>` : ''}
        ${notes ? `<p style="margin: 0 0 8px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
        <p style="margin: 16px 0 8px 0; font-size: 14px; text-transform: uppercase; color: #64748b; font-weight: bold;">Items:</p>
        <div style="font-family: monospace; white-space: pre-wrap; font-size: 15px;">${details}</div>
        <p style="margin: 16px 0 0 0; font-size: 18px; border-top: 1px solid #e2e8f0; padding-top: 12px;"><strong>Total: ${total}</strong></p>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6; text-align: center;">
        <a href="https://mughaldynasty.net/admin" style="${buttonStyle}">View in Admin Panel</a>
      </p>
    </div>
  </div>
`;

export const getReservationAcceptedTemplate = (name: string, date: string, time: string, guests: number) => `
  <div style="${wrapperStyle}">
    <div style="${headerStyle}">
      <h1 style="color: #ffffff; margin: 0; letter-spacing: -1px; font-weight: 800; font-size: 28px;">
        MUGHAL <span style="color: ${emailBrandColor};">DYNASTY</span>
      </h1>
    </div>
    <div style="${contentStyle}">
      <h2 style="color: #c2410c; margin-top: 0; font-size: 24px;">Reservation Confirmed!</h2>
      <p style="font-size: 16px; line-height: 1.6;">Hi ${name},</p>
      <p style="font-size: 16px; line-height: 1.6;">Your table reservation request has been accepted. We look forward to hosting you!</p>
      
      <div style="background-color: #fff7ed; border: 1px solid #ffedd5; padding: 24px; border-radius: 16px; margin: 24px 0;">
         <p style="font-size: 16px; margin: 0; color: #9a3412;"><strong>Date:</strong> ${date}</p>
         <p style="font-size: 16px; margin: 8px 0 0 0; color: #9a3412;"><strong>Time:</strong> ${time}</p>
         <p style="font-size: 16px; margin: 8px 0 0 0; color: #9a3412;"><strong>Guests:</strong> ${guests} people</p>
      </div>
      
      <p style="font-size: 16px; line-height: 1.6;">If you need to make any changes or cancel your reservation, please call us directly at 01933 626351.</p>
      
      <div style="${footerStyle}">
        <p>Thank you for choosing Mughal Dynasty Restaurant.</p>
        <p>01933 626351 | High Street, Raunds</p>
      </div>
    </div>
  </div>
`;

