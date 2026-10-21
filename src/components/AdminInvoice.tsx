import React, { useState } from "react";
import { collection, query, where, getDocs, Timestamp, orderBy } from "../firebase";
import { db } from "../firebase";
import { Order } from "../types";
import { Calendar, Printer, ArrowLeft, FileText, CheckCircle2, ShieldCheck, Loader2 } from "lucide-react";
import { formatPrice } from "../lib/utils";

interface AdminInvoiceProps {
  onBack?: () => void;
}

export const AdminInvoice: React.FC<AdminInvoiceProps> = ({ onBack }) => {
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    // Default to start of current month
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    return startOfMonth.toISOString().split("T")[0];
  });

  const [toDate, setToDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });

  const [isGenerated, setIsGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [invoiceOrders, setInvoiceOrders] = useState<Order[]>([]);
  const [generatedAt, setGeneratedAt] = useState<Date>(new Date());
  const [recordNumber, setRecordNumber] = useState<string>("");

  const generateNumericalOrderNumber = (order: Order, index: number): string => {
    if (order.id && /^\d{10,14}$/.test(order.id)) {
      return order.id;
    }
    const createdAtMs = order.createdAt?.toMillis 
      ? order.createdAt.toMillis() 
      : (order.createdAt?.seconds ? order.createdAt.seconds * 1000 : Date.now());
    const dateObj = new Date(createdAtMs);
    const day = String(dateObj.getDate()).padStart(2, "0");
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const hours = String(dateObj.getHours()).padStart(2, "0");
    const mins = String(dateObj.getMinutes()).padStart(2, "0");
    
    // Deterministic hash from doc id
    let hash = 0;
    for (let i = 0; i < (order.id || "").length; i++) {
      hash = ((hash << 5) - hash) + order.id.charCodeAt(i);
      hash |= 0;
    }
    const suffix = String(Math.abs(hash) % 100000).padStart(5, "0");
    return `${day}${month}${hours}${mins}${suffix}`;
  };

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromDate || !toDate) return;

    setLoading(true);
    try {
      const start = new Date(fromDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);

      const startTimestamp = Timestamp.fromDate(start);
      const endTimestamp = Timestamp.fromDate(end);

      const q = query(
        collection(db, "orders"),
        where("createdAt", ">=", startTimestamp),
        where("createdAt", "<=", endTimestamp),
        orderBy("createdAt", "asc")
      );

      const snap = await getDocs(q);
      const fetched: Order[] = [];
      const seenPaymentIds = new Set<string>();
      const seenIds = new Set<string>();

      snap.forEach((docSnap) => {
        if (seenIds.has(docSnap.id)) return;
        seenIds.add(docSnap.id);

        const data = docSnap.data();
        const ord = { id: docSnap.id, ...data } as Order;

        if (ord.paymentId) {
          if (seenPaymentIds.has(ord.paymentId)) return;
          seenPaymentIds.add(ord.paymentId);
        }
        fetched.push(ord);
      });

      // Sort by creation date ascending
      fetched.sort((a, b) => {
        const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return aMs - bMs;
      });

      setInvoiceOrders(fetched);
      const now = new Date();
      setGeneratedAt(now);

      // Create realistic Record No e.g. MU/5604/30/0826
      const randomSeed = Math.floor(1000 + Math.random() * 9000);
      const dayStr = String(now.getDate()).padStart(2, "0");
      const monthStr = String(now.getMonth() + 1).padStart(2, "0");
      const yearStr = String(now.getFullYear()).slice(-2);
      setRecordNumber(`MU/${randomSeed}/${dayStr}/${monthStr}${yearStr}`);

      setIsGenerated(true);
    } catch (error) {
      console.error("Error generating invoice:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDisplayDate = (dStr: string) => {
    if (!dStr) return "";
    const [y, m, d] = dStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const formatOrderDateTime = (createdAt: any) => {
    if (!createdAt) return { dateStr: "", timeStr: "" };
    const dateObj = createdAt.toDate 
      ? createdAt.toDate() 
      : (createdAt.seconds ? new Date(createdAt.seconds * 1000) : new Date(createdAt));
    
    const day = String(dateObj.getDate()).padStart(2, "0");
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const year = dateObj.getFullYear();
    const dateStr = `${day}/${month}/${year}`;

    let hours = dateObj.getHours();
    const minutes = String(dateObj.getMinutes()).padStart(2, "0");
    const seconds = String(dateObj.getSeconds()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timeStr = `${String(hours).padStart(2, "0")}.${minutes}.${seconds} ${ampm}`;

    return { dateStr, timeStr };
  };

  const getOrderTypeFormatted = (order: Order) => {
    const isDelivery = order.type === "delivery";
    const isOnlineCard = order.paymentMethod === "card" || !!order.paymentId;
    const isCardOnCollection = order.paymentMethod === "card_collection";
    
    if (isOnlineCard) {
      return isDelivery ? "Card-Delivery" : "Card-Collection";
    }
    if (isCardOnCollection) {
      return "Card-on-Collection";
    }
    return isDelivery ? "Cash-Delivery" : "Cash-Collection";
  };

  const getPaymentStatus = (order: Order) => {
    const isOnlineCard = order.paymentMethod === "card" || !!order.paymentId;
    const isCardOnCollection = order.paymentMethod === "card_collection";
    if (isOnlineCard) {
      return { text: "PAID ONLINE", color: "text-emerald-600 font-semibold" };
    }
    if (isCardOnCollection) {
      return { text: "NOT PAID", color: "text-gray-500 font-medium" };
    }
    return { text: "CASH PAYMENT", color: "text-gray-600 font-medium" };
  };

  const getOrderStatus = (order: Order) => {
    if (order.status === "cancelled") return "Cancelled";
    return "Accepted";
  };

  // Calculations for Charge Details & Payment Details
  const totalOrdersCount = invoiceOrders.length;
  const cancelledOrders = invoiceOrders.filter((o) => o.status === "cancelled");
  const cancelledCount = cancelledOrders.length;
  const cancelledTotal = cancelledOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  const acceptedOrders = invoiceOrders.filter((o) => o.status !== "cancelled");
  const acceptedOrderTotal = acceptedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Online payments (non-cancelled orders paid with card online)
  const onlinePaymentOrders = acceptedOrders.filter(
    (o) => o.paymentMethod === "card" || !!o.paymentId
  );
  const onlinePaymentsCount = onlinePaymentOrders.length;
  const onlinePaymentTotal = onlinePaymentOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Gateway fees: £0.60 per online card payment
  const gatewayFeeRate = 0.60;
  const gatewayFeesTotal = onlinePaymentsCount * gatewayFeeRate;

  // Commission: 5% of Order Total
  const commissionRate = 0.05;
  const commissionTotal = acceptedOrderTotal * commissionRate;

  // VAT: 20% of (Gateway fees + Commission)
  const chargesSubtotal = gatewayFeesTotal + commissionTotal;
  const vatRate = 0.20;
  const vatTotal = chargesSubtotal * vatRate;

  // Total charges
  const totalChargesDeducted = gatewayFeesTotal + commissionTotal + vatTotal;

  // Net total for this period
  const netTotalForPeriod = onlinePaymentTotal - totalChargesDeducted;

  return (
    <div className="w-full">
      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            background-color: #ffffff !important;
            color: #000000 !important;
          }
          nav, aside, header, button, .no-print {
            display: none !important;
          }
          .invoice-paper {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
          }
          .print-container {
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
          }
        }
      `}</style>

      {!isGenerated ? (
        /* Date Selection Screen (Matches Capture.JPG) */
        <div className="min-h-[580px] flex flex-col items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md bg-[#ebebeb] text-slate-800 rounded-2xl p-8 sm:p-10 shadow-xl border border-slate-300">
            <h2 className="text-xl sm:text-2xl font-bold text-center text-slate-900 mb-8">
              Business name : Mughal Dynasty
            </h2>

            <form onSubmit={handleGenerateInvoice} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  From date *:
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white text-slate-800 border border-slate-300 rounded-md shadow-inner text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  To date *:
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white text-slate-800 border border-slate-300 rounded-md shadow-inner text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="pt-2 text-center">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto px-8 py-3 bg-[#0f6b3b] hover:bg-[#0d5931] text-white font-bold text-base rounded-md shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={18} />
                      Generating...
                    </>
                  ) : (
                    "Generate invoice >>"
                  )}
                </button>
              </div>

              <p className="text-center text-xs text-slate-600 font-medium pt-2">
                Type dates or click on calendar icon to select date
              </p>

              {/* Biznext Technology Logo Badge */}
              <div className="pt-6 flex flex-col items-center justify-center">
                <div className="flex items-center gap-3 px-5 py-2.5 bg-white/90 rounded-2xl border border-slate-300 shadow-sm">
                  <img
                    src="/biznext_logo.png"
                    alt="Biznext Technology Ltd"
                    className="h-10 w-auto object-contain"
                    onError={(e) => {
                      // Fallback if image path fails
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="text-left">
                    <span className="text-xs font-black tracking-tight text-slate-900 block leading-none">
                      BIZNEXT
                    </span>
                    <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase block mt-0.5">
                      TECHNOLOGY LTD
                    </span>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* Generated Invoice / Order History Document (Matches Capture2.JPG & Capture3.JPG) */
        <div className="print-container w-full max-w-5xl mx-auto py-6 px-2 sm:px-4 space-y-6">
          {/* Top Actions Bar (Hidden in Print) */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-lg border border-white/10">
            <button
              onClick={() => setIsGenerated(false)}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all"
            >
              <ArrowLeft size={16} />
              Back to Date Selection
            </button>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-300 font-medium hidden sm:inline">
                Period: {formatDisplayDate(fromDate)} to {formatDisplayDate(toDate)}
              </span>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95"
              >
                <Printer size={16} />
                Print History
              </button>
            </div>
          </div>

          {/* Printable Paper Document */}
          <div className="invoice-paper bg-white text-slate-800 p-8 sm:p-12 rounded-2xl shadow-2xl border border-slate-200 font-sans text-xs sm:text-sm">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 border-b border-slate-100 pb-8">
              {/* Left Logo / Company (Logo in place of text) */}
              <div className="flex items-center">
                <img
                  src="/biznext_logo.png"
                  alt="Biznext Technology Ltd"
                  className="h-20 sm:h-24 w-auto object-contain max-w-[240px]"
                />
              </div>

              {/* Right Order History For */}
              <div className="text-left sm:text-right">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 uppercase">
                  ORDER HISTORY FOR
                </h2>
                <p className="font-bold text-slate-800 text-sm sm:text-base mt-0.5">
                  Mughal Dynasty
                </p>
                <p className="text-slate-500 text-xs mt-0.5">
                  17 High Street, Raunds NN9 6HS
                </p>
              </div>
            </div>

            {/* Billing Period Banner */}
            <div className="text-center py-6">
              <span className="text-sm sm:text-base font-bold text-slate-800">
                Billing period : {formatDisplayDate(fromDate)} to {formatDisplayDate(toDate)}
              </span>
            </div>

            {/* Section 1: Order Details */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2 border-b-2 border-slate-800 pb-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  Order Details
                </h3>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                  <span>
                    <strong>Record no :</strong> {recordNumber}
                  </span>
                  <span>
                    <strong>Created on</strong> {formatOrderDateTime(generatedAt).dateStr} @ {formatOrderDateTime(generatedAt).timeStr}
                  </span>
                </div>
              </div>

              {/* Orders Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-50 text-slate-700 font-bold">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Order Type</th>
                      <th className="py-2.5 px-3">Order Status</th>
                      <th className="py-2.5 px-3">Payment Status</th>
                      <th className="py-2.5 px-3">Order Number</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoiceOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                          No orders found for the selected billing period.
                        </td>
                      </tr>
                    ) : (
                      invoiceOrders.map((order, idx) => {
                        const { dateStr } = formatOrderDateTime(order.createdAt);
                        const orderTypeStr = getOrderTypeFormatted(order);
                        const statusStr = getOrderStatus(order);
                        const paymentStatusObj = getPaymentStatus(order);
                        const orderNum = generateNumericalOrderNumber(order, idx);

                        return (
                          <tr
                            key={order.id || idx}
                            className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                          >
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              {dateStr}
                            </td>
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              {orderTypeStr}
                            </td>
                            <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                              <span
                                className={
                                  statusStr === "Cancelled"
                                    ? "text-red-600 font-bold"
                                    : "text-slate-700"
                                }
                              >
                                {statusStr}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={paymentStatusObj.color}>
                                {paymentStatusObj.text}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-sky-700 font-medium whitespace-nowrap">
                              {orderNum}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-800 font-semibold whitespace-nowrap">
                              £{(order.total || 0).toFixed(2)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 2: Charge Details (Matches Capture3.JPG) */}
            <div className="mt-10 space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 border-b-2 border-slate-800 pb-2">
                Charge Details
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-center border-collapse text-xs border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
                      <th className="py-2.5 px-3 border-r border-slate-300">Total Orders</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">Cancelled</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">Order Total</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">Online Payments</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">Payment Gateway Fees</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">Commission</th>
                      <th className="py-2.5 px-3 border-r border-slate-300">VAT</th>
                      <th className="py-2.5 px-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="divide-x divide-slate-300 font-medium text-slate-800">
                      <td className="py-3 px-3 font-bold">{totalOrdersCount}</td>
                      <td className="py-3 px-3">
                        {cancelledCount} = £{cancelledTotal.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 font-bold">
                        £{acceptedOrderTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3 font-bold">{onlinePaymentsCount}</td>
                      <td className="py-3 px-3">
                        {onlinePaymentsCount} X £{gatewayFeeRate.toFixed(2)} ={" "}
                        <span className="font-bold">£{gatewayFeesTotal.toFixed(2)}</span>
                      </td>
                      <td className="py-3 px-3">
                        5% @ £{acceptedOrderTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ={" "}
                        <span className="font-bold">£{commissionTotal.toFixed(2)}</span>
                      </td>
                      <td className="py-3 px-3">
                        20% @ £{chargesSubtotal.toFixed(2)} ={" "}
                        <span className="font-bold">£{vatTotal.toFixed(2)}</span>
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900">
                        £{totalChargesDeducted.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3: Payment Details (Matches Capture3.JPG) */}
            <div className="mt-8 space-y-3">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 border-b-2 border-slate-800 pb-2">
                Payment Details
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-slate-300 divide-y divide-slate-200">
                  <tbody>
                    <tr>
                      <td className="py-2.5 px-6 font-semibold text-slate-600 text-right w-2/3">
                        Online payment total :
                      </td>
                      <td className="py-2.5 px-6 font-bold text-slate-900 text-right w-1/3">
                        £{onlinePaymentTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr className="bg-slate-50/50">
                      <td className="py-2.5 px-6 font-semibold text-slate-600 text-right">
                        Charges deducted :
                      </td>
                      <td className="py-2.5 px-6 font-bold text-red-600 text-right">
                        £{totalChargesDeducted.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="bg-slate-100/60 border-t border-slate-300">
                      <td className="py-3 px-6 font-bold text-slate-800 text-right">
                        Net total for this period :
                      </td>
                      <td className="py-3 px-6 font-extrabold text-emerald-700 text-right text-sm">
                        £{netTotalForPeriod.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="mt-6 p-3 bg-slate-50 border border-slate-200 rounded text-center text-xs text-slate-600 font-medium">
              This order history is generated by customer for viewing purpose only.
            </div>

            {/* Footer Company Details (Matches Prompt Specs) */}
            <div className="mt-12 pt-8 border-t border-slate-200 text-center space-y-2 text-xs text-slate-600">
              <p className="font-bold text-slate-900 text-sm">
                Biznext Technology Ltd
              </p>
              <p>
                17 High street raunds NN9 6HS | Email : biznexttechnologyltd@gmail.com
              </p>
              <p className="text-[11px] text-slate-400">
                Biznext Technology Ltd is registered in England & Wales.
              </p>

              <div className="pt-4 no-print flex justify-center">
                <button
                  onClick={handlePrint}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-slate-800 text-xs font-bold transition-all flex items-center gap-2"
                >
                  <Printer size={14} />
                  Print History
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
