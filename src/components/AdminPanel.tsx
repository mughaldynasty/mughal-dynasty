import React, { useState, useEffect, useRef } from "react";
import { sendEmail } from "../services/emailService";
import { getOrderAcceptedTemplate, getOrderCancelledTemplate, getOrderUpdateTemplate, getReservationAcceptedTemplate } from "../lib/emailTemplates";
import {
  db,
  reservationDb,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  setDoc,
  getDoc,
  where,
  serverTimestamp,
  writeBatch,
} from "../firebase";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Minus,
  Edit2,
  Trash2,
  Check,
  X,
  LayoutGrid,
  ClipboardList,
  Settings,
  Image as ImageIcon,
  Loader2,
  Printer,
  Bell,
  Clock,
  Zap,
  Smartphone,
  ExternalLink,
  Shield,
  ChevronRight,
  ChevronDown,
  History,
  ShoppingBag,
  PackageCheck,
  Search,
  CreditCard,
  Banknote,
  ReceiptText,
  Calendar,
  CalendarCheck,
  CalendarX,
  Mail,
  RefreshCw,
  FileText,
  Send,
  AlertCircle,
} from "lucide-react";
import { AdminInvoice } from "./AdminInvoice";
import { formatPrice, cn, formatOrderId, formatPostcode, removeAllergyBrackets } from "../lib/utils";
import {
  DEFAULT_BUSINESS_HOURS,
  DAY_NAMES,
  ClosedDateSetting,
} from "../lib/businessHours";
import { toast } from "sonner";
import { qzService } from "../lib/qz-service";
import { bluetoothPrinter } from "../lib/bluetooth-printer";
import { EscPosEncoder } from "../lib/escpos-encoder";

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  order: number;
  isTraditional?: boolean;
}

interface Category {
  id: string;
  name: string;
  order: number;
}

interface Order {
  id: string;
  userId: string;
  email?: string;
  items: any[];
  total: number;
  status: string;
  type: string;
  phone: string;
  customerName?: string;
  address?: string;
  houseNumber?: string;
  houseName?: string;
  streetName?: string;
  areaName?: string;
  postcode?: string;
  timeSlot?: string;
  paymentMethod?: string;
  paymentId?: string;
  estimate?: string;
  notes?: string;
  createdAt: any;
  acceptedAt?: any;
  completedAt?: any;
}

interface DiscountRule {
  enabled: boolean;
  minOrder: number;
  percentage: number;
}

interface DeliveryFeeRule {
  postcode: string;
  fee: number;
}

interface ReceiptSettings {
  showOnPremiseNumber: boolean;
  showContactDetails: boolean;
  showTime: boolean;
  showItems: boolean;
  showIsPaid: boolean;
  showPaymentMethod: boolean;
  showClientInfo: boolean;
  showDirection: boolean;
  showClientComment: boolean;
  showOrderDetails: boolean;
  showInfoBox1: boolean;
  showInfoBox2: boolean;
  showInfoBox3: boolean;
  showOrderOnline: boolean;
  allowCashOrders: boolean;
  minCollectionOrder: number;
  minDeliveryOrder: number;
  freeDeliveryEnabled: boolean;
  freeDeliveryMinOrder: number;
  businessName: string;
  tagline: string;
  headerAddress: string;
  headerPhone: string;
  infoBox1: string;
  infoBox2: string;
  infoBox3: string;
  collectionDiscount: DiscountRule;
  deliveryDiscount: DiscountRule;
  cashDiscount?: DiscountRule;
  localDeliveryFee: number;
  deliveryFees: DeliveryFeeRule[];
  businessHours?: Record<number, { open: string; close: string; openMins: number; closeMins: number }>;
  closedDates?: ClosedDateSetting[];
  adminPasscodeHash?: string;
}

interface MeatOption {
  id: string;
  name: string;
  extra: number;
  order: number;
}

interface AdminPanelProps {
  initialEditingItemId?: string | null;
  clearInitialEditing?: () => void;
}

export default function AdminPanel({
  initialEditingItemId,
  clearInitialEditing,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<
    | "menu"
    | "orders"
    | "history"
    | "invoice"
    | "categories"
    | "settings"
    | "traditional"
    | "reservations"
  >("orders");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [meatOptions, setMeatOptions] = useState<MeatOption[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(true);
  const [isResettingOrders, setIsResettingOrders] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [isEditingMeat, setIsEditingMeat] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newMeatOption, setNewMeatOption] = useState<Partial<MeatOption>>({
    name: "",
    extra: 0,
  });
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    name: "",
    description: "",
    price: 0,
    category: "",
    available: true,
  });
  const [newOrdersQueue, setNewOrdersQueue] = useState<Order[]>([]);
  const newOrderPopup = newOrdersQueue[0] || null;
  const [estimateInput, setEstimateInput] = useState("30-45 mins");
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [reservations, setReservations] = useState<any[]>([]);
  const [newReservationsQueue, setNewReservationsQueue] = useState<any[]>([]);
  const reservationPopup = newReservationsQueue[0] || null;
  const [activeReservationSubTab, setActiveReservationSubTab] = useState<"pending" | "accepted" | "rejected">("pending");
  const [activeOrderSubTab, setActiveOrderSubTab] = useState<
    "incoming" | "transit" | "completed"
  >("incoming");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isSyncingStripe, setIsSyncingStripe] = useState(false);

  const handleSyncStripeOrders = async (isManual = true) => {
    if (isSyncingStripe) return;
    setIsSyncingStripe(true);
    try {
      const resp = await fetch("/api/sync-stripe-orders");
      if (resp.ok) {
        const data = await resp.json();
        if (data.recoveredCount > 0) {
          toast.success(`Recovered ${data.recoveredCount} paid order(s) from Stripe!`);
        } else if (isManual) {
          toast.info(`Checked Stripe (${data.checkedCount} recent payments). All paid orders are synced!`);
        }
      }
    } catch (err: any) {
      if (isManual) {
        console.error("Stripe sync error:", err);
        toast.error("Failed to check Stripe payments.");
      }
    } finally {
      setIsSyncingStripe(false);
    }
  };

  // Email Notification & Cloudflare Worker Testing State (Phase 7)
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [testEmailAddress, setTestEmailAddress] = useState("mughaldynastyrestaurant@gmail.com");
  const [testTemplateType, setTestTemplateType] = useState<
    "order-confirmation" | "reservation-confirmation" | "collection-ready" | "delivery-on-the-way"
  >("order-confirmation");
  const [testProvider, setTestProvider] = useState<"auto" | "cloudflare" | "smtp">("auto");
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{
    success: boolean;
    provider?: string;
    messageId?: string;
    subject?: string;
    error?: string;
    oauthRequired?: boolean;
    oauthLoginUrl?: string;
    note?: string;
  } | null>(null);

  const fetchEmailStatus = async () => {
    try {
      const res = await fetch("/api/email-status");
      if (res.ok) {
        const data = await res.json();
        setEmailStatus(data);
      }
    } catch (e) {
      console.warn("Could not fetch email status:", e);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes("@")) {
      toast.error("Please enter a valid email address for testing.");
      return;
    }
    setIsSendingTestEmail(true);
    setTestEmailResult(null);
    try {
      const res = await fetch("/api/send-email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testEmail: testEmailAddress.trim(),
          templateType: testTemplateType,
          provider: testProvider,
          customData: {
            customerName: "Valued Customer",
            orderId: "#TEST-8842",
          },
        }),
      });
      const data = await res.json();
      setTestEmailResult(data);
      if (data.success) {
        if (data.oauthRequired) {
          toast.success(`Test email sent via ${data.provider}! (Worker OAuth pending)`);
        } else {
          toast.success(`Live test email dispatched via ${data.provider}! (ID: ${data.messageId || "ok"})`);
        }
        fetchEmailStatus();
      } else {
        if (data.oauthRequired) {
          toast.error("Cloudflare Worker requires one-time Google OAuth authorization.");
        } else {
          toast.error(`Test email failed: ${data.error || "Unknown error"}`);
        }
      }
    } catch (err: any) {
      setTestEmailResult({ success: false, error: err.message });
      toast.error(`Test email error: ${err.message}`);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  // Auto-sync Stripe orders and fetch email status on mount
  useEffect(() => {
    handleSyncStripeOrders(false);
    fetchEmailStatus();
    const interval = setInterval(() => {
      handleSyncStripeOrders(false);
    }, 120000);
    return () => clearInterval(interval);
  }, []);
  const defaultReceiptSettings: ReceiptSettings = {
    showOnPremiseNumber: true,
    showContactDetails: true,
    showTime: true,
    showItems: true,
    showIsPaid: false,
    showPaymentMethod: true,
    showClientInfo: true,
    showDirection: true,
    showClientComment: true,
    showOrderDetails: true,
    showInfoBox1: false,
    showInfoBox2: false,
    showInfoBox3: false,
    showOrderOnline: false,
    allowCashOrders: true,
    minCollectionOrder: 15,
    minDeliveryOrder: 20,
    freeDeliveryEnabled: false,
    freeDeliveryMinOrder: 50,
    businessName: "Mughal Dynasty",
    tagline: "MUGHAL DYNASTY",
    headerAddress: "17 High Street, Raunds NN9 6HS",
    headerPhone: "01933 626351",
    infoBox1: "Indian Finest Cuisine",
    infoBox2: "Follow us on Instagram @mughaldynasty",
    infoBox3: "Visit mughaldynasty.net for more.",
    collectionDiscount: { enabled: false, minOrder: 20, percentage: 10 },
    deliveryDiscount: { enabled: false, minOrder: 30, percentage: 5 },
    cashDiscount: { enabled: false, minOrder: 15, percentage: 5 },
    localDeliveryFee: 1.5,
    deliveryFees: [
      { postcode: "NN9 5", fee: 2.5 },
      { postcode: "NN10", fee: 3.5 },
      { postcode: "NN8", fee: 4.5 },
    ],
    closedDates: [],
  };

  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(
    defaultReceiptSettings,
  );

  const [newPasscode, setNewPasscode] = useState("");
  const [isUpdatingPasscode, setIsUpdatingPasscode] = useState(false);

  // Restaurant & Reservation Closure Date Management
  const [newClosedDate, setNewClosedDate] = useState("");
  const [newClosedReason, setNewClosedReason] = useState("");
  const [newClosedType, setNewClosedType] = useState<"all" | "reservations">("all");

  const handleAddClosedDate = async () => {
    if (!newClosedDate) {
      toast.error("Please choose a date to close");
      return;
    }
    const currentList = receiptSettings.closedDates || [];
    if (currentList.some((item) => item.date === newClosedDate)) {
      toast.error(`Date ${newClosedDate} is already added to closed dates`);
      return;
    }

    const newEntry: ClosedDateSetting = {
      id: `close_${newClosedDate}_${Date.now()}`,
      date: newClosedDate,
      reason: newClosedReason.trim() || (newClosedType === "all" ? "Restaurant Closed" : "Table Reservations Closed"),
      closeRestaurant: newClosedType === "all",
      closeReservations: true,
      createdAt: new Date().toISOString(),
    };

    const updatedList = [...currentList, newEntry].sort((a, b) => a.date.localeCompare(b.date));
    await updateReceiptSetting("closedDates" as any, updatedList);
    setNewClosedDate("");
    setNewClosedReason("");
    toast.success(`Closed date set for ${newClosedDate}!`);
  };

  const handleRemoveClosedDate = async (id: string) => {
    const currentList = receiptSettings.closedDates || [];
    const updatedList = currentList.filter((item) => item.id !== id);
    await updateReceiptSetting("closedDates" as any, updatedList);
    toast.success("Closure date removed");
  };

  const handleSavePasscode = async () => {
    if (!newPasscode) return;
    setIsUpdatingPasscode(true);
    try {
      const msgBuffer = new TextEncoder().encode(newPasscode);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      await updateReceiptSetting("adminPasscodeHash" as any, hashHex);
      setNewPasscode("");
      toast.success("Admin passcode updated successfully!");
    } catch (err: any) {
      console.error("Failed to hash or save passcode:", err);
      toast.error("Failed to update passcode.");
    } finally {
      setIsUpdatingPasscode(false);
    }
  };

  useEffect(() => {
    // Initial fetch of shared settings
    const fetchSettings = async () => {
      const snap = await getDoc(doc(db, "settings", "receipt"));
      if (snap.exists()) {
        const data = snap.data();
        setReceiptSettings((prev) => ({ ...prev, ...data }));
      }
    };
    fetchSettings();

    // Listen for changes from other devices
    const unsub = onSnapshot(doc(db, "settings", "receipt"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setReceiptSettings((prev) => ({ ...prev, ...data }));
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlock = () => {
      if (audioContext.current && audioContext.current.state === "suspended") {
        audioContext.current.resume().catch((err) => console.warn("Audio resume failed:", err));
      }
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    if (initialEditingItemId && menuItems.length > 0) {
      const item = menuItems.find((i) => i.id === initialEditingItemId);
      if (item) {
        setActiveTab("menu");
        startEditing(item);
        clearInitialEditing?.();
      }
    }
  }, [initialEditingItemId, menuItems]);

  useEffect(() => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const startTimestamp = Timestamp.fromDate(start);
    const endTimestamp = Timestamp.fromDate(end);

    const unsubHistory = onSnapshot(
      query(
        collection(db, "orders"),
        where("createdAt", ">=", startTimestamp),
        where("createdAt", "<=", endTimestamp),
        orderBy("createdAt", "desc")
      ),
      (snapshot) => {
        const seenPaymentIds = new Set<string>();
        const seenIds = new Set<string>();
        const deduplicatedHistory: Order[] = [];

        for (const doc of snapshot.docs) {
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);

          const data = doc.data();
          const order = { id: doc.id, ...data } as Order;

          if (order.paymentId) {
            if (seenPaymentIds.has(order.paymentId)) {
              continue; // Skip duplicate payment intent
            }
            seenPaymentIds.add(order.paymentId);
          }
          deduplicatedHistory.push(order);
        }

        setHistoryOrders(deduplicatedHistory);
      },
      (error) => {
        console.error("Error fetching history orders:", error);
      }
    );

    return () => unsubHistory();
  }, [startDate, endDate]);

  const updateReceiptSetting = async (
    key: keyof ReceiptSettings,
    value: any,
  ) => {
    const newSettings = { ...receiptSettings, [key]: value };
    setReceiptSettings(newSettings);
    try {
      await setDoc(doc(db, "settings", "receipt"), newSettings);
    } catch (e) {
      console.error("Settings sync failed:", e);
    }
  };

  const getOrderTargetTimeMs = (order: Order, now: Date): number => {
    const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : (order.createdAt?.seconds ? new Date(order.createdAt.seconds * 1000) : now);
    const acceptedAt = order.acceptedAt?.toDate ? order.acceptedAt.toDate() : (order.acceptedAt?.seconds ? new Date(order.acceptedAt.seconds * 1000) : null);
    const baseTime = acceptedAt || createdAt;

    if (order.estimate && order.estimate.includes("min")) {
      const matches = order.estimate.match(/(\d+)\s*mins?/i);
      const lastMatch = order.estimate.match(/(\d+)(?=\s*mins?)/gi);
      const mins = lastMatch
        ? parseInt(lastMatch[lastMatch.length - 1])
        : matches
          ? parseInt(matches[1])
          : 45;
      return (baseTime ? baseTime.getTime() : now.getTime()) + mins * 60000;
    }

    if (order.timeSlot && order.timeSlot !== "ASAP") {
      const isTomorrow = order.timeSlot.includes("Tomorrow");
      const startTimeStr = order.timeSlot.replace("Tomorrow ", "").split(" - ")[0];
      const [hours, minutes] = startTimeStr.split(":").map(Number);
      if (!isNaN(hours)) {
        const scheduledDate = new Date(now);
        if (isTomorrow) {
          scheduledDate.setDate(scheduledDate.getDate() + 1);
        }
        scheduledDate.setHours(hours, minutes, 0, 0);
        return scheduledDate.getTime();
      }
    }

    return (baseTime ? baseTime.getTime() : now.getTime()) + 45 * 60000;
  };

  const renderOrderCard = (order: Order, compact: boolean = false) => {
    const isExpanded = expandedOrderId === order.id;

    const getHeaderAction = () => {
      if (order.status === "pending") {
        return {
          text: (
            <>
              <span className="hidden sm:inline">Accept Order</span>
              <span className="inline sm:hidden">Accept</span>
            </>
          ),
          icon: <Check size={14} />,
          className: "bg-green-600 hover:bg-green-700 text-white shadow-green-600/20",
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            handleUpdateStatus(order.id, "confirmed");
          }
        };
      }
      if (order.status === "confirmed") {
        if (order.type === "collection") {
          return {
            text: (
              <>
                <span className="hidden sm:inline">Ready to Collect</span>
                <span className="inline sm:hidden">Ready</span>
              </>
            ),
            icon: <ShoppingBag size={14} />,
            className: "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20 animate-pulse",
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              handleNotifyCustomer(order, "ready");
            }
          };
        } else {
          return {
            text: (
              <>
                <span className="hidden sm:inline">Out for Delivery</span>
                <span className="inline sm:hidden">Delivery</span>
              </>
            ),
            icon: <Zap size={14} />,
            className: "bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/20 animate-pulse",
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              handleNotifyCustomer(order, "shipped");
            }
          };
        }
      }
      if (order.status === "ready" || order.status === "shipped") {
        const isCollection = order.type === "collection";
        return {
          text: (
            <>
              {isCollection ? (
                <>
                  <span className="hidden sm:inline">Mark Collected</span>
                  <span className="inline sm:hidden">Collected</span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">Mark Completed</span>
                  <span className="inline sm:hidden">Complete</span>
                </>
              )}
            </>
          ),
          icon: <PackageCheck size={14} />,
          className: "bg-green-600 hover:bg-green-700 text-white shadow-green-600/20",
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            handleUpdateStatus(
              order.id,
              isCollection ? "collected" : "delivered"
            );
          }
        };
      }
      return null;
    };

    const headerAction = getHeaderAction();

     // Countdown Logic
    let countdownText = "";
    let isLate = false;
    let isUrgent = false; // < 15 mins
    let showCountdown = false;
    // Dynamic Backgrounds and Borders
    let cardBg = activeTab === "orders" ? "bg-white" : "bg-white/[0.03]";
    let cardBorder = activeTab === "orders" ? "border-slate-200" : "border-white/10";
    let timerColor = activeTab === "orders" ? "text-amber-600 font-extrabold" : "text-yellow-500";
    let targetTime: Date | null = null;

    if (["pending", "confirmed"].includes(order.status)) {
      const createdAt = order.createdAt?.toDate();
      const acceptedAt = order.acceptedAt?.toDate();
      const baseTime = acceptedAt || createdAt;

      // Determine target time
      if (order.estimate && order.estimate.includes("min")) {
        // Parse estimate e.g. "20-25 mins" -> take 25
        const matches = order.estimate.match(/(\d+)\s*mins?/i);
        const lastMatch = order.estimate.match(/(\d+)(?=\s*mins?)/gi);
        const mins = lastMatch
          ? parseInt(lastMatch[lastMatch.length - 1])
          : matches
            ? parseInt(matches[1])
            : 45;
        targetTime = baseTime
          ? new Date(baseTime.getTime() + mins * 60000)
          : null;
      } else if (order.timeSlot && order.timeSlot !== "ASAP") {
        // Scheduled order
        const isTomorrow = order.timeSlot.includes("Tomorrow");
        const startTimeStr = order.timeSlot.replace("Tomorrow ", "").split(" - ")[0];
        const [hours, minutes] = startTimeStr.split(":").map(Number);
        
        if (!isNaN(hours)) {
          const scheduledDate = new Date();
          if (isTomorrow) {
            scheduledDate.setDate(scheduledDate.getDate() + 1);
          }
          scheduledDate.setHours(hours, minutes, 0, 0);

          const diffToScheduled =
            (scheduledDate.getTime() - currentTime.getTime()) / 60000;
          
          // Countdown thresholds: 60m for delivery, 20m for collection
          const threshold = order.type === 'delivery' ? 60 : 20;
          
          if (diffToScheduled <= threshold) {
            targetTime = scheduledDate;
          } else {
            countdownText = "Scheduled";
            showCountdown = true;
            timerColor = "text-blue-500";
            targetTime = null; // Don't show countdown minutes yet
          }
        }
      } else {
        // Default 45 mins for ASAP without estimate yet
        targetTime = baseTime
          ? new Date(baseTime.getTime() + 45 * 60000)
          : null;
      }

      if (targetTime) {
        showCountdown = true;
        const diffValue = Math.floor(
          (targetTime.getTime() - currentTime.getTime()) / 60000,
        );
        isUrgent = diffValue <= 15;
        isLate = diffValue <= 0;

        if (diffValue > 0) {
          countdownText = `${diffValue}m left`;
        } else {
          countdownText = `${Math.abs(diffValue)}m late`;
        }
      }
    } else if (["ready", "shipped"].includes(order.status)) {
      showCountdown = true;
      const readyTime = (order as any).readyAt?.toDate?.()
        || (order as any).statusUpdatedAt?.toDate?.()
        || (order as any).updatedAt?.toDate?.()
        || order.acceptedAt?.toDate?.()
        || order.createdAt?.toDate?.()
        || new Date();

      const diffMs = Math.max(0, currentTime.getTime() - readyTime.getTime());
      const minsAgo = Math.floor(diffMs / 60000);

      if (minsAgo < 1) {
        countdownText = "Just now";
      } else if (minsAgo === 1) {
        countdownText = "1 min ago";
      } else {
        countdownText = `${minsAgo} mins ago`;
      }

      timerColor = order.type === "collection"
        ? (activeTab === "orders" ? "text-blue-600 font-extrabold" : "text-blue-400 font-extrabold")
        : (activeTab === "orders" ? "text-purple-600 font-extrabold" : "text-purple-400 font-extrabold");
    }

    if (isLate) {
      cardBg = activeTab === "orders" ? "bg-red-50 border-red-200" : "bg-red-600/20";
      cardBorder = activeTab === "orders" ? "border-red-400 shadow-md" : "border-red-500/50 shadow-[inset_0_0_40px_rgba(239,68,68,0.1)]";
      timerColor = activeTab === "orders" ? "text-red-600 animate-pulse font-extrabold" : "text-red-500 animate-pulse";
    } else if (isUrgent) {
      const diffValue = Math.floor(
        (targetTime!.getTime() - currentTime.getTime()) / 60000,
      );
      if (diffValue <= 5) {
        cardBg = activeTab === "orders" ? "bg-red-50 border-red-200" : "bg-red-500/10";
        cardBorder = activeTab === "orders" ? "border-red-300" : "border-red-500/30 shadow-[inset_0_0_20px_rgba(239,68,68,0.05)]";
        timerColor = activeTab === "orders" ? "text-red-500 font-extrabold" : "text-red-400";
      } else if (diffValue <= 10) {
        cardBg = activeTab === "orders" ? "bg-orange-50 border-orange-200" : "bg-orange-600/15";
        cardBorder = activeTab === "orders" ? "border-orange-300" : "border-orange-500/40";
        timerColor = activeTab === "orders" ? "text-orange-600 font-extrabold" : "text-orange-500";
      } else {
        cardBg = activeTab === "orders" ? "bg-orange-50/50 border-orange-100" : "bg-orange-500/5";
        cardBorder = activeTab === "orders" ? "border-orange-200" : "border-orange-500/20";
        timerColor = activeTab === "orders" ? "text-orange-500 font-extrabold" : "text-orange-400";
      }
    }

    return (
      <div
        key={order.id}
        className={cn(
          "rounded-2xl transition-all duration-500 overflow-hidden border",
          isExpanded
            ? "border-orange-500/50 shadow-2xl shadow-orange-500/20"
            : cardBorder,
          cardBg,
          compact && "opacity-90",
        )}
      >
        {/* Header Area - Clickable to Toggle */}
        <div
          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
          className="p-4 sm:p-6 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 select-none"
        >
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
            {showCountdown && (
              <div className={cn(
                "flex flex-col items-center justify-center px-4 py-2 rounded-2xl min-w-[90px] shadow-sm border",
                activeTab === "orders" ? "bg-slate-100 border-slate-200" : "bg-black/60 border-white/5 shadow-xl"
              )}>
                <span
                  className={cn(
                    "text-lg font-black tracking-tighter uppercase italic",
                    timerColor,
                  )}
                >
                  {countdownText}
                </span>
                <span className={cn(
                  "text-[8px] font-black uppercase tracking-widest mt-[-2px]",
                  activeTab === "orders" ? "text-slate-500" : "text-gray-400"
                )}>
                  {["ready", "shipped"].includes(order.status) 
                    ? (order.type === "collection" ? "Ready" : "Dispatched") 
                    : "Prep Time"}
                </span>
              </div>
            )}

            <div className="flex flex-col min-w-[120px] max-w-[200px] sm:max-w-[350px] md:max-w-[500px]">
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                {formatOrderId(order.id)} {order.type === "delivery" && "• DELIVERY ADDRESS"}
              </span>
              {order.type === "delivery" ? (
                <div className="flex flex-col">
                  {/* First line: Postcode */}
                  <p className={cn(
                    "text-base font-black italic tracking-tighter truncate",
                    activeTab === "orders" ? "text-slate-900" : "text-white"
                  )} title={order.postcode ? formatPostcode(order.postcode) : "No Postcode"}>
                    {order.postcode 
                      ? formatPostcode(order.postcode) 
                      : (() => {
                          const parts = order.address ? order.address.split('\n') : [];
                          const lastPart = parts[parts.length - 1] || "";
                          if (lastPart.trim().length >= 5 && lastPart.trim().length <= 9) {
                            return formatPostcode(lastPart);
                          }
                          return "No Postcode";
                        })()
                    }
                  </p>
                  {/* Second line: Rest of the address */}
                  <p className={cn(
                    "text-xs font-bold italic tracking-tighter truncate opacity-80 mt-0.5",
                    activeTab === "orders" ? "text-slate-700" : "text-gray-300"
                  )} title={order.streetName ? [order.houseName, `${order.houseNumber ? order.houseNumber + " " : ""}${order.streetName}`, order.areaName].filter(Boolean).join(", ") : (order.address || "No Address")}>
                    {order.streetName 
                      ? [
                          order.houseName, 
                          `${order.houseNumber ? order.houseNumber + " " : ""}${order.streetName}`, 
                          order.areaName
                        ].filter(Boolean).join(", ")
                      : (() => {
                          const parts = order.address ? order.address.split('\n') : [];
                          const lastPart = parts[parts.length - 1] || "";
                          if (lastPart.trim().length >= 5 && lastPart.trim().length <= 9) {
                            return parts.slice(0, -1).join(', ') || "No Address";
                          }
                          return order.address || "No Address";
                        })()
                    }
                  </p>
                </div>
              ) : (
                <p className={cn(
                  "text-base font-black italic tracking-tighter truncate",
                  activeTab === "orders" ? "text-slate-900" : "text-white"
                )} title={order.customerName || "No Name"}>
                  {order.customerName || "No Name"}
                </p>
              )}
            </div>

            <div className={cn(
              "h-8 w-px mx-2 hidden sm:block",
              activeTab === "orders" ? "bg-slate-200" : "bg-white/5"
            )} />

            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                Type
              </span>
              <span
                className={cn(
                  "text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest w-fit",
                  order.type === "collection"
                    ? "bg-blue-500/10 text-blue-500"
                    : "bg-purple-500/10 text-purple-500",
                )}
              >
                {order.type}
              </span>
            </div>

            {activeTab !== "orders" && (
              <>
                <div className={cn(
                  "h-8 w-px mx-2 hidden md:block",
                  activeTab === "orders" ? "bg-slate-200" : "bg-white/5"
                )} />

                <div className="hidden md:flex flex-col">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                    Time
                  </span>
                  <span className={cn(
                    "text-xs font-bold",
                    activeTab === "orders" ? "text-slate-800" : "text-white"
                  )}>
                    {order.timeSlot && order.timeSlot !== "ASAP"
                      ? order.timeSlot
                      : order.createdAt
                          ?.toDate()
                          .toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className={cn(
            "flex items-center justify-between md:justify-end gap-3 sm:gap-6 pt-3 md:pt-0 border-t md:border-0",
            activeTab === "orders" ? "border-slate-100" : "border-white/5"
          )}>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                Payment
              </span>
              <div
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  order.status === "cancelled" && "bg-red-500/10 text-red-500",
                  order.status !== "cancelled" &&
                    order.paymentMethod === "pay_online" &&
                    "bg-green-500/10 text-green-500",
                  order.status !== "cancelled" &&
                    order.paymentMethod === "card_on_collection" &&
                    "bg-blue-500/10 text-blue-500",
                  order.status !== "cancelled" &&
                    (order.paymentMethod === "cash" || !order.paymentMethod) &&
                    "bg-yellow-500/10 text-yellow-500",
                )}
              >
                {order.status === "cancelled"
                  ? "CANCELLED"
                  : order.paymentMethod === "pay_online"
                    ? "PAID"
                    : order.paymentMethod === "card_on_collection"
                      ? "CARD"
                      : "CASH"}
              </div>
            </div>

            {headerAction && (
              <button
                onClick={headerAction.onClick}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all duration-200 shadow-lg select-none shrink-0 whitespace-nowrap",
                  headerAction.className
                )}
              >
                {headerAction.icon}
                {headerAction.text}
              </button>
            )}

            <ChevronDown
              size={20}
              className={cn(
                "text-gray-600 transition-transform duration-300",
                isExpanded && "rotate-180",
              )}
            />
          </div>
        </div>

        {/* Details Area - Expandable */}
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className={cn(
              "px-6 pb-6 border-t",
              activeTab === "orders"
                ? "border-slate-100 bg-slate-50/50"
                : "border-white/5 bg-white/[0.02]"
            )}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pt-6">
              {/* Column 1: Contact & Address */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">
                    Contact Details
                  </h4>
                  <p className={cn(
                    "text-base font-bold mb-1",
                    activeTab === "orders" ? "text-slate-950" : "text-white"
                  )}>
                    {order.phone}
                  </p>
                  {order.timeSlot && (
                    <div className="flex items-center gap-2 mt-2">
                      <Clock size={12} className="text-orange-500" />
                      <span className="text-xs font-bold text-orange-500 uppercase italic">
                        Requested: {order.timeSlot}
                      </span>
                    </div>
                  )}
                </div>

                {order.address && (
                  <div className={cn(
                    "pt-4 border-t",
                    activeTab === "orders" ? "border-slate-200/60" : "border-white/5"
                  )}>
                    <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
                      Delivery Address
                    </h4>
                    <p className={cn(
                      "text-sm font-medium italic",
                      activeTab === "orders" ? "text-slate-700" : "text-gray-400"
                    )}>
                      {order.address}
                    </p>
                  </div>
                )}

                {order.notes && (
                  <div className={cn(
                    "pt-4 border-t",
                    activeTab === "orders" ? "border-slate-200/60" : "border-white/5"
                  )}>
                    <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
                      Customer Notes
                    </h4>
                    <div className={cn(
                      "p-3 rounded-xl border",
                      activeTab === "orders" ? "bg-orange-50 border-orange-200" : "bg-orange-500/5 border-orange-500/10"
                    )}>
                      <p className={cn(
                        "text-sm font-medium italic",
                        activeTab === "orders" ? "text-slate-800" : "text-gray-300"
                      )}>
                        "{order.notes}"
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Column 2: Items Summary */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">
                  Order Items
                </h4>
                <ul className="space-y-2">
                  {order.items.map((item: any, i: number) => (
                    <li
                      key={i}
                      className={cn(
                        "flex justify-between items-start text-sm py-1 border-b last:border-0",
                        activeTab === "orders" ? "border-slate-200/60" : "border-white/5"
                      )}
                    >
                      <div className="flex flex-col">
                        <span className={cn(
                          "font-bold",
                          activeTab === "orders" ? "text-slate-900" : "text-white"
                        )}>
                          <span className="text-orange-500 mr-2">
                            {item.quantity}x
                          </span>
                          {item.variant &&
                          !item.name
                            .toLowerCase()
                            .includes(item.variant.toLowerCase())
                            ? `${item.variant} ${item.name}`
                            : item.name}
                        </span>
                        {item.variant && (
                          <span className="text-[10px] text-orange-500 font-black uppercase tracking-widest pl-6">
                            + {item.variant}
                          </span>
                        )}
                      </div>
                      <span className={cn(
                        "font-mono self-start",
                        activeTab === "orders" ? "text-slate-600" : "text-gray-500"
                      )}>
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                  {(order as any).deliveryFee > 0 && (
                    <li className={cn(
                      "flex justify-between items-center text-sm pt-2 border-t",
                      activeTab === "orders" ? "border-slate-200/60" : "border-white/5"
                    )}>
                      <span className="text-purple-500 font-bold">
                        Delivery Fee
                      </span>
                      <span className="text-gray-500 font-mono">
                        {formatPrice((order as any).deliveryFee)}
                      </span>
                    </li>
                  )}
                  {(order as any).distance !== undefined &&
                    (order as any).distance !== null && (
                      <li className="flex justify-between items-center text-xs">
                        <span className="text-gray-500 italic">
                          Delivery Zone
                        </span>
                        <span className="text-gray-500 italic">
                          {(order as any).distance === 0
                            ? "Local"
                            : "Postcode Match"}
                        </span>
                      </li>
                    )}
                </ul>
                <div className={cn(
                  "pt-4 border-t space-y-2",
                  activeTab === "orders" ? "border-slate-200/60" : "border-white/5"
                )}>
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span>Payment Method:</span>
                    <span className="font-bold text-green-500 uppercase tracking-widest">
                      {order.paymentMethod?.replace(/_/g, " ")}
                    </span>
                  </div>
                  {order.estimate && (
                    <div className="flex justify-between items-center text-xs text-gray-500">
                      <span>Estimate:</span>
                      <span className={cn(
                        "font-bold italic",
                        activeTab === "orders" ? "text-slate-900" : "text-white"
                      )}>
                        {order.estimate}
                      </span>
                    </div>
                  )}
                  {(order as any).discountAmount > 0 && (
                    <div className="flex justify-between items-center text-xs text-gray-500 border-t pt-2 mt-1">
                      <span>Discount:</span>
                      <span className="font-bold text-red-500 font-mono">
                        -{formatPrice((order as any).discountAmount)}
                      </span>
                    </div>
                  )}
                  <div className={cn(
                    "flex justify-between items-center pt-2 mt-1 border-t",
                    activeTab === "orders" ? "border-slate-200" : "border-white/10"
                  )}>
                    <span className={cn(
                      "text-xs font-black uppercase tracking-wider",
                      activeTab === "orders" ? "text-slate-800" : "text-gray-200"
                    )}>
                      Total Amount:
                    </span>
                    <span className="text-base font-black text-orange-500 italic font-mono">
                      {formatPrice(order.total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Column 3: Actions */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">
                  Quick Actions
                </h4>

                <div className="flex flex-col gap-2">
                  {order.status === "pending" && (
                    <button
                      onClick={() => handleUpdateStatus(order.id, "confirmed")}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-xs font-black tracking-widest uppercase hover:bg-green-700 transition-all shadow-lg shadow-green-600/20"
                    >
                      <Check size={16} />
                      ACCEPT ORDER
                    </button>
                  )}

                  {order.status === "confirmed" &&
                    order.type === "collection" && (
                      <button
                        onClick={() => handleNotifyCustomer(order, "ready")}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl text-xs font-black tracking-widest uppercase hover:bg-blue-700 transition-all animate-pulse shadow-lg shadow-blue-600/20"
                      >
                        <ShoppingBag size={16} />
                        READY FOR COLLECTION
                      </button>
                    )}

                  {order.status === "confirmed" &&
                    order.type === "delivery" && (
                      <button
                        onClick={() => handleNotifyCustomer(order, "shipped")}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl text-xs font-black tracking-widest uppercase hover:bg-purple-700 transition-all animate-pulse shadow-lg shadow-purple-600/20"
                      >
                        <Zap size={16} />
                        OUT FOR DELIVERY
                      </button>
                    )}

                  {(order.status === "ready" || order.status === "shipped") && (
                    <button
                      onClick={() =>
                        handleUpdateStatus(
                          order.id,
                          order.type === "collection"
                            ? "collected"
                            : "delivered",
                        )
                      }
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-xs font-black tracking-widest uppercase hover:bg-green-700 transition-all shadow-lg shadow-green-600/20"
                    >
                      <PackageCheck size={16} />
                      {order.type === "collection"
                        ? "MARK COLLECTED"
                        : "MARK COMPLETED"}
                    </button>
                  )}

                  <button
                    onClick={() => handlePrint(order)}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-xl text-xs font-black tracking-widest uppercase hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20"
                  >
                    <Printer size={16} />
                    PRINT ORDERPAD
                  </button>

                  <button
                    onClick={() => handleCancelOrder(order)}
                    className="flex items-center justify-center gap-2 px-6 py-3 bg-red-600/10 text-red-500 border border-red-500/20 rounded-xl text-[10px] font-black tracking-widest uppercase hover:bg-red-600 hover:text-white transition-all"
                  >
                    <X size={16} />
                    CANCEL ORDER
                  </button>

                  <div className="pt-2" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    );
  };
  const isFirstLoad = useRef(true);
  const isFirstReservationsLoad = useRef(true);
  const audioContext = useRef<AudioContext | null>(null);
  const soundInterval = useRef<NodeJS.Timeout | null>(null);

  const playNotificationSound = () => {
    try {
      if (!audioContext.current) {
        audioContext.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      }
      const ctx = audioContext.current;

      // Resume context if suspended (browser policy)
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const playBeep = (freq: number, startTime: number, duration: number) => {
        const gainNode = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();

        // Multi-oscillator setup for maximum "thickness" and volume
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();

        osc1.type = "square";
        osc1.frequency.setValueAtTime(freq, startTime);

        osc2.type = "sawtooth";
        osc2.frequency.setValueAtTime(freq + 2, startTime); // Slight detune for richness

        // Sustain the high volume for a bit before dropping
        gainNode.gain.setValueAtTime(1.0, startTime);
        gainNode.gain.setValueAtTime(1.0, startTime + duration * 0.8);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        // Compression to make it sound "fatter"
        compressor.threshold.setValueAtTime(-24, startTime);
        compressor.knee.setValueAtTime(30, startTime);
        compressor.ratio.setValueAtTime(12, startTime);
        compressor.attack.setValueAtTime(0.003, startTime);
        compressor.release.setValueAtTime(0.25, startTime);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(compressor);
        compressor.connect(ctx.destination);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + duration);
        osc2.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      // High-frequency siren-like pattern that stands out
      playBeep(987.77, now, 0.1); // B5
      playBeep(1318.51, now + 0.15, 0.1); // E6
      playBeep(987.77, now + 0.3, 0.1); // B5
      playBeep(1318.51, now + 0.45, 0.4); // E6 long
    } catch (e) {
      console.error("Audio play failed:", e);
    }
  };

  const enableAudio = () => {
    if (!audioContext.current) {
      audioContext.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }
    if (audioContext.current.state === "suspended") {
      audioContext.current.resume();
    }
    setIsAudioEnabled(true);
    playNotificationSound();
    toast.success("Audio notifications enabled");
  };

  useEffect(() => {
    if ((newOrderPopup || reservationPopup) && isAudioEnabled) {
      // Play immediately
      playNotificationSound();

      // Then repeat every 2 seconds
      soundInterval.current = setInterval(() => {
        playNotificationSound();
      }, 2000);
    } else {
      if (soundInterval.current) {
        clearInterval(soundInterval.current);
        soundInterval.current = null;
      }
    }

    return () => {
      if (soundInterval.current) {
        clearInterval(soundInterval.current);
      }
    };
  }, [newOrderPopup, reservationPopup, isAudioEnabled]);

  useEffect(() => {
    const unsubMenu = onSnapshot(
      query(collection(db, "menu"), orderBy("order", "asc")),
      (snapshot) => {
        setMenuItems(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              order: data.order ?? 0, // Default order to 0 if not present
            } as MenuItem;
          }),
        );
      },
    );

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(startOfToday);

    const liveWindow = new Date();
    liveWindow.setHours(liveWindow.getHours() - 48); // 48 hour window for live orders to catch pre-orders
    const liveTimestamp = Timestamp.fromDate(liveWindow);

    const unsubOrders = onSnapshot(
      query(
        collection(db, "orders"),
        where("createdAt", ">=", liveTimestamp),
        orderBy("createdAt", "desc"),
      ),
      (snapshot) => {
        const seenPaymentIds = new Set<string>();
        const seenIds = new Set<string>();
        const newOrders: Order[] = [];

        for (const doc of snapshot.docs) {
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);

          const data = doc.data();
          const order = { id: doc.id, ...data } as Order;

          if (order.paymentId) {
            if (seenPaymentIds.has(order.paymentId)) {
              continue; // Skip rendering duplicate payment
            }
            seenPaymentIds.add(order.paymentId);
          }
          newOrders.push(order);
        }

        // Check for new orders
        snapshot.docChanges().forEach((change) => {
          // Only trigger for NEW documents added AFTER initial load
          if (change.type === "added" && !isFirstLoad.current) {
            const order = { id: change.doc.id, ...change.doc.data() } as Order;
            // Ensure it's a pending order and not just an old one being re-synced
            if (order.status === "pending") {
              setNewOrdersQueue((prev) => {
                if (prev.find((o) => o.id === order.id || (order.paymentId && o.paymentId === order.paymentId))) return prev;
                return [...prev, order];
              });
              toast.info("NEW ORDER RECEIVED!", {
                description: `Order ${formatOrderId(order.id)} from ${order.customerName || "Guest"}`,
                duration: 15000,
                icon: <Bell className="text-orange-500 animate-bounce" />,
              });
            }
          }
        });

        setOrders(newOrders);
        setLoading(false);

        // Sync queue: Only allow pending orders without estimates
        setNewOrdersQueue((prev) => {
          const stillPending = newOrders.filter(
            (o) => o.status === "pending" && !o.estimate,
          );
          // Keep order of existing queue but filter out stale ones
          const updated = prev.filter((po) =>
            stillPending.find((sp) => sp.id === po.id),
          );
          // Add new ones not in queue
          stillPending.forEach((sp) => {
            if (!updated.find((u) => u.id === sp.id)) updated.push(sp);
          });
          return updated;
        });

        // Mark as loaded after the first snapshot is processed
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
        }
      },
    );

    const unsubCategories = onSnapshot(
      query(collection(db, "categories"), orderBy("order", "asc")),
      (snapshot) => {
        const catList = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Category,
        );
        setCategories(catList);
        if (catList.length > 0 && !newItem.category) {
          setNewItem((prev) => ({ ...prev, category: catList[0].name }));
        }
      },
    );

    const unsubMeat = onSnapshot(
      query(collection(db, "meatOptions"), orderBy("order", "asc")),
      (snapshot) => {
        setMeatOptions(
          snapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as MeatOption,
          ),
        );
      },
    );

    const unsubReservations = onSnapshot(
      query(collection(db, "reservations"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        snapshot.docChanges().forEach((change) => {
          if (change.type === "added" && !isFirstReservationsLoad.current) {
            const res = { id: change.doc.id, ...change.doc.data() } as any;
            if (res.status === "pending") {
              setNewReservationsQueue((prev) => {
                if (prev.find((r) => r.id === res.id)) return prev;
                return [...prev, res];
              });
              toast.info("NEW RESERVATION REQUEST!", {
                description: `Table for ${res.name} (${res.guests} guests)`,
                duration: 15000,
                icon: <Bell className="text-orange-500 animate-bounce" />,
              });
            }
          }
        });

        if (isFirstReservationsLoad.current) {
          isFirstReservationsLoad.current = false;
        }

        setReservations(list);

        setNewReservationsQueue((prev) => {
          const stillPending = list.filter((r: any) => r.status === "pending");
          const updated = prev.filter((pr) => stillPending.find((sp) => sp.id === pr.id));
          stillPending.forEach((sp: any) => {
            if (!updated.find((u) => u.id === sp.id)) updated.push(sp);
          });
          return updated;
        });
      },
    );

    return () => {
      unsubMenu();
      unsubOrders();
      unsubCategories();
      unsubMeat();
      unsubReservations();
    };
  }, [isAudioEnabled]);

  const generateReservationEscPosData = (reservation: any) => {
    const encoder = new EscPosEncoder();
    const PRINTER_WIDTH = 48;

    const getReservationNumber = (id: string | undefined): string => {
      if (!id) return "1220698088";
      let hash = 0;
      for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) % 1000000000;
      }
      return String(1000000000 + Math.abs(hash));
    };

    const formatReservationDate = (dateStr: string, timeStr?: string) => {
      if (!dateStr) return "";
      const parts = dateStr.split(/[-/]/);
      let day = "";
      let month = "";
      let year = "";
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          year = parts[0];
          month = parts[1];
          day = parts[2];
        } else {
          day = parts[0];
          month = parts[1];
          year = parts[2];
        }
      } else {
        return dateStr + (timeStr ? ` at ${timeStr}` : "");
      }

      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const monthIndex = parseInt(month, 10) - 1;
      const monthName = months[monthIndex] || month;
      const formattedDay = parseInt(day, 10).toString();

      const baseDate = `${formattedDay} ${monthName}`;
      if (timeStr) {
        return `${baseDate} at ${timeStr}`;
      }
      return baseDate;
    };

    const formatRow = (left: string, right: string, width: number = PRINTER_WIDTH): string => {
      const spaceCount = width - left.length - right.length;
      if (spaceCount <= 0) {
        return left.slice(0, Math.max(5, width - right.length - 1)) + " " + right;
      }
      return left + " ".repeat(spaceCount) + right;
    };

    // Initialize
    encoder.initialize();
    
    // Top Black Band (Inverted): "Later" left-aligned, "Fulfillment date/time" right-aligned
    const fulfillmentStr = formatReservationDate(reservation.date, reservation.time);
    const topBandText = formatRow("Later", fulfillmentStr, PRINTER_WIDTH);
    
    encoder.bold(true).invert(true).line(topBandText).invert(false).bold(false);
    encoder.feed(1);

    // Client Info Section
    encoder.align("left").bold(true).line("Client info:").bold(false);
    
    // Split name into First name and Last name
    const nameParts = (reservation.name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    
    encoder.line(formatRow("First name:", firstName, PRINTER_WIDTH));
    encoder.line(formatRow("Last name:", lastName, PRINTER_WIDTH));
    encoder.line(formatRow("Email:", reservation.email || "", PRINTER_WIDTH));
    encoder.line(formatRow("Phone:", reservation.phone || "", PRINTER_WIDTH));
    encoder.feed(1);

    // Table Reservation Band (Inverted)
    const guestsStr = `${reservation.guests} guests`;
    const middleBandText = formatRow("Table reservation:", guestsStr, PRINTER_WIDTH);
    encoder.bold(true).invert(true).line(middleBandText).invert(false).bold(false);
    encoder.feed(1);

    // Order Details Section
    encoder.align("left").bold(true).line("Order details:").bold(false);
    
    // Reservation Number
    const reservationNumber = getReservationNumber(reservation.id);
    encoder.line(formatRow("Number:", reservationNumber, PRINTER_WIDTH));

    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    // Placed at: reservation.createdAt (fallback to current time if missing)
    const createdDate = reservation.createdAt?.toDate ? reservation.createdAt.toDate() : new Date();
    const placedDay = createdDate.getDate();
    const placedMonth = months[createdDate.getMonth()];
    const placedTime = createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const placedStr = `${placedDay} ${placedMonth} at ${placedTime}`;
    encoder.line(formatRow("Placed at:", placedStr, PRINTER_WIDTH));

    // Accepted at: Use reservation.acceptedAt or current time
    const acceptedDate = reservation.acceptedAt?.toDate ? reservation.acceptedAt.toDate() : new Date();
    const acceptedDay = acceptedDate.getDate();
    const acceptedMonth = months[acceptedDate.getMonth()];
    const acceptedTime = acceptedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const acceptedStr = `${acceptedDay} ${acceptedMonth} at ${acceptedTime}`;
    encoder.line(formatRow("Accepted at:", acceptedStr, PRINTER_WIDTH));

    // Fulfillment at: reservation date and time
    encoder.line(formatRow("Fulfillment at:", fulfillmentStr, PRINTER_WIDTH));
    
    // Notes if present
    if (reservation.notes) {
      encoder.feed(1).bold(true).line("SPECIAL NOTES:");
      const wrapLines = (text: string, limit: number): string[] => {
        if (!text) return [];
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let currentLine = "";

        words.forEach((word) => {
          if ((currentLine + (currentLine ? " " : "") + word).length <= limit) {
            currentLine += (currentLine ? " " : "") + word;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        });
        if (currentLine) lines.push(currentLine);
        return lines;
      };
      wrapLines(reservation.notes, PRINTER_WIDTH).forEach((line) => {
        encoder.line(line);
      });
    }

    encoder.feed(2).cut();
    return encoder.encode();
  };

  const formatDateToDDMMYYYY = (dateStr: string) => {
    if (!dateStr) return "";
    if (dateStr.includes("/")) return dateStr;
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const cleanTimeForNetlify = (timeStr: string) => {
    if (!timeStr) return "";
    return timeStr.replace(/(am|pm)/gi, "").trim();
  };

  const handleAcceptReservation = async (reservation: any) => {
    const toastId = toast.loading("Accepting reservation...");
    try {
      const formattedDate = formatDateToDDMMYYYY(reservation.date);
      const cleanedTime = cleanTimeForNetlify(reservation.time);

      // 1. Update status in /reservations
      await updateDoc(doc(db, "reservations", reservation.id), {
        status: "accepted",
        formattedDate: formattedDate,
        cleanedTime: cleanedTime
      });

      // 2. Sync to bookings / booking collections for the external app
      const bookingData = {
        name: reservation.name,
        guests: Number(reservation.guests),
        guestsStr: String(reservation.guests),
        date: formattedDate, // "17/07/2026"
        time: cleanedTime, // "7:15"
        email: reservation.email || "",
        phone: reservation.phone || "",
        notes: reservation.notes || "",
        status: "accepted",
        tableNo: "",
        table: "",
        createdAt: reservation.createdAt || serverTimestamp(),
        acceptedAt: serverTimestamp(),
        
        // Include fallback original fields just in case
        isoDate: reservation.date,
        originalDate: reservation.date,
        originalTime: reservation.time,
        timeSlot: reservation.time,
      };
      
      try {
        await setDoc(doc(db, "bookings", reservation.id), bookingData);
      } catch (err) {
        console.warn("Failed to save to /bookings:", err);
      }

      try {
        await setDoc(doc(db, "booking", reservation.id), bookingData);
      } catch (err) {
        console.warn("Failed to save to /booking:", err);
      }

      // Sync to the external reservation app's database ID
      try {
        await setDoc(doc(reservationDb, "bookings", reservation.id), bookingData);
      } catch (err) {
        console.warn("Failed to save to reservationDb /bookings:", err);
      }

      try {
        await setDoc(doc(reservationDb, "booking", reservation.id), bookingData);
      } catch (err) {
        console.warn("Failed to save to reservationDb /booking:", err);
      }

      // 3. Send confirmation email to customer
      const customerEmail = (
        reservation.email ||
        reservation.customerEmail ||
        reservation.userEmail ||
        ""
      ).trim();
      const customerName = reservation.name || "Customer";
      const displayDate = reservation.formattedDate || formattedDate || reservation.date;
      const displayTime = reservation.cleanedTime || cleanedTime || reservation.time;
      const guestsCount = Number(reservation.guests) || 2;

      let emailSent = false;
      if (customerEmail) {
        try {
          const htmlMessage = getReservationAcceptedTemplate(
            customerName,
            displayDate,
            displayTime,
            guestsCount
          );
          const plainTextMessage = `Dear ${customerName},\n\nYour table reservation at Mughal Dynasty has been confirmed!\n\nDate: ${displayDate}\nTime: ${displayTime}\nGuests: ${guestsCount} people\n\nIf you need to make changes or cancel, please call us directly at 01933 626351.\n\nThank you for choosing Mughal Dynasty Restaurant.\nHigh Street, Raunds`;

          const reservationEntityId = reservation.id || `${displayDate}_${displayTime}_${customerEmail}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const reservationIdempotencyKey = `reservation_${reservationEntityId}_reservation-confirmation`;

          console.log("[RESERVATION] Dispatching confirmation email to:", customerEmail);
          const res = await sendEmail({
            to_email: customerEmail,
            email: customerEmail,
            to: customerEmail,
            user_email: customerEmail,
            to_name: customerName,
            name: customerName,
            customer_name: customerName,
            subject: "Table Reservation Confirmed - Mughal Dynasty Raunds",
            message: plainTextMessage,
            text: plainTextMessage,
            html_message: htmlMessage,
            html: htmlMessage,
            date: displayDate,
            time: displayTime,
            guests: guestsCount,
            reservation_date: displayDate,
            reservation_time: displayTime,
            reservation_guests: guestsCount,
            order_details: `Table reservation on ${displayDate} at ${displayTime} for ${guestsCount} guests`,
            entityId: reservation.id || reservationEntityId,
            entityType: "reservation",
            notificationType: "reservation-confirmation",
            idempotencyKey: reservationIdempotencyKey,
          });

          if (res?.success) {
            emailSent = true;
            if (res.alreadySent) {
              console.log("[RESERVATION] Confirmation email was already delivered previously for", reservationEntityId);
            } else {
              console.log(`[RESERVATION] Confirmation email delivered via ${res.provider || "provider"} to ${customerEmail}`);
            }
          } else {
            console.warn("[RESERVATION] Confirmation email response not ok:", res?.error);
          }
        } catch (emailErr) {
          console.error("[RESERVATION] Error during confirmation email dispatch:", emailErr);
        }
      }

      if (emailSent) {
        toast.success(`Reservation accepted & confirmation email sent to ${customerEmail}!`, { id: toastId });
      } else if (customerEmail) {
        toast.success("Reservation accepted (notification email dispatched)!", { id: toastId });
      } else {
        toast.success("Reservation accepted successfully!", { id: toastId });
      }
      setNewReservationsQueue((prev) => prev.filter((r) => r.id !== reservation.id));
    } catch (err: any) {
      console.error("Failed to accept reservation:", err);
      toast.error("Failed to accept reservation.", { id: toastId });
    }
  };

  const handleRejectReservation = async (reservationId: string) => {
    const toastId = toast.loading("Declining reservation...");
    try {
      await updateDoc(doc(db, "reservations", reservationId), {
        status: "rejected"
      });
      toast.success("Reservation declined successfully.", { id: toastId });
      setNewReservationsQueue((prev) => prev.filter((r) => r.id !== reservationId));
    } catch (err: any) {
      console.error("Failed to decline reservation:", err);
      toast.error("Failed to decline reservation.", { id: toastId });
    }
  };

  const handleAddMeatOption = async () => {
    if (!newMeatOption.name) {
      toast.error("Please enter a name");
      return;
    }

    try {
      if (isEditingMeat) {
        await updateDoc(doc(db, "meatOptions", isEditingMeat), {
          ...newMeatOption,
        });
        setIsEditingMeat(null);
        toast.success("Meat option updated");
      } else {
        await addDoc(collection(db, "meatOptions"), {
          ...newMeatOption,
          order: meatOptions.length,
        });
        toast.success("Meat option added");
      }
      setNewMeatOption({ name: "", extra: 0 });
    } catch (error) {
      toast.error("Failed to save meat option");
    }
  };

  const handleDeleteMeatOption = async (id: string) => {
    try {
      await deleteDoc(doc(db, "meatOptions", id));
      toast.success("Meat option deleted");
    } catch (error) {
      toast.error("Failed to delete");
    }
  };

  const handleMoveMeatOption = async (id: string, direction: "up" | "down") => {
    const currentIndex = meatOptions.findIndex((m) => m.id === id);
    if (currentIndex === -1) return;

    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= meatOptions.length) return;

    const currentMeat = meatOptions[currentIndex];
    const targetMeat = meatOptions[targetIndex];

    try {
      await updateDoc(doc(db, "meatOptions", currentMeat.id), {
        order: targetMeat.order,
      });
      await updateDoc(doc(db, "meatOptions", targetMeat.id), {
        order: currentMeat.order,
      });
      toast.success("Order updated");
    } catch (error) {
      toast.error("Failed to update order");
    }
  };

  const startEditingMeat = (meat: MeatOption) => {
    setIsEditingMeat(meat.id);
    setNewMeatOption({ name: meat.name, extra: meat.extra });
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error("Please enter a category name");
      return;
    }

    // Check for duplicates
    if (
      categories.some(
        (c) => c.name.toLowerCase() === newCategoryName.trim().toLowerCase(),
      )
    ) {
      toast.error("Category already exists");
      return;
    }

    try {
      await addDoc(collection(db, "categories"), {
        name: newCategoryName.trim(),
        order: categories.length,
      });
      setNewCategoryName("");
      toast.success("Category added");
    } catch (error) {
      toast.error("Failed to add category");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    toast("Delete category?", {
      description:
        "This will not delete items in this category, but they will become uncategorized.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, "categories", id));
            toast.success("Category deleted");
          } catch (error) {
            toast.error("Failed to delete category");
          }
        },
      },
    });
  };

  const handleMoveCategory = async (id: string, direction: "up" | "down") => {
    const currentIndex = categories.findIndex((c) => c.id === id);
    if (currentIndex === -1) return;

    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const currentCat = categories[currentIndex];
    const targetCat = categories[targetIndex];

    try {
      await updateDoc(doc(db, "categories", currentCat.id), {
        order: targetCat.order,
      });
      await updateDoc(doc(db, "categories", targetCat.id), {
        order: currentCat.order,
      });
      toast.success("Order updated");
    } catch (error) {
      toast.error("Failed to update order");
    }
  };

  const handleAcceptOrder = async (orderId: string, estimate: string) => {
    try {
      const orderToAccept =
        orders.find((o) => o.id === orderId) ||
        historyOrders.find((o) => o.id === orderId);

      await updateDoc(doc(db, "orders", orderId), {
        status: "confirmed",
        estimate: estimate,
        acceptedAt: serverTimestamp(),
      });

      if (orderToAccept) {
        setNewOrdersQueue((prev) => prev.filter((o) => o.id !== orderId)); // Advance queue

        // Send Email Confirmation
        if (orderToAccept.email) {
          try {
            const formattedId = formatOrderId(orderId);
            const customerName = orderToAccept.customerName || "Customer";
            const htmlMessage = getOrderAcceptedTemplate(
              customerName,
              formattedId,
              estimate,
              orderToAccept.type
            );
            const plainTextMessage = `Hi ${customerName},\n\nYour order ${formattedId} has been accepted and is now being prepared.\n\nEstimated Time: ${estimate}\nOrder ID: ${formattedId}\n\nWe will notify you once it's ${orderToAccept.type === "collection" ? "ready for collection" : "on its way to you"}.\n\nThank you for choosing Mughal Dynasty Restaurant.\n01933 626351 | High Street, Raunds`;

            await sendEmail({
              to_email: orderToAccept.email,
              to_name: customerName,
              subject: `Order Accepted ${formattedId} - Mughal Dynasty`,
              html_message: htmlMessage,
              message: plainTextMessage,
              order_id: formattedId,
              entityId: orderId,
              entityType: "order",
              notificationType: "order-confirmation",
              idempotencyKey: `order_${orderId}_order-confirmation`,
            });
          } catch (e) {
            console.error("Initial acceptance email failed:", e);
          }
        }

        // Automatically print when accepted
        try {
          handlePrint({ ...orderToAccept, estimate });
        } catch (printError) {
          console.error("Auto-print failed:", printError);
        }
      }

      setNewOrdersQueue((prev) => prev.filter((o) => o.id !== orderId));
      toast.success("Order accepted and email sent!");
    } catch (error) {
      toast.error("Failed to accept order");
    }
  };

  const handleCancelOrder = async (order: Order) => {
    toast("Cancel Order?", {
      description: `Wait, are you sure you want to cancel order ${formatOrderId(order.id)}?`,
      action: {
        label: "YES, CANCEL",
        onClick: async () => {
          try {
            await updateDoc(doc(db, "orders", order.id), {
              status: "cancelled",
            });

            setNewOrdersQueue((prev) => prev.filter((o) => o.id !== order.id));
            toast.success("Order cancelled");
          } catch (e) {
            toast.error("Failed to cancel order");
          }
        },
      },
    });
  };

  const handleAddMenuItem = async () => {
    if (!newItem.name || !newItem.price || !newItem.category) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Check for duplicates
    const isDuplicate = menuItems.some(
      (item) =>
        item.name.toLowerCase() === newItem.name?.toLowerCase() &&
        (isEditing ? item.id !== isEditing : true),
    );

    if (isDuplicate) {
      toast.error("A dish with this name already exists");
      return;
    }

    try {
      if (isEditing) {
        await updateDoc(doc(db, "menu", isEditing), {
          ...newItem,
        });
        setIsEditing(null);
        toast.success("Menu item updated");
      } else {
        const itemsInCategory = menuItems.filter(
          (i) => i.category === newItem.category,
        );
        const maxOrder = itemsInCategory.reduce(
          (max, item) => Math.max(max, item.order),
          -1,
        );

        await addDoc(collection(db, "menu"), {
          ...newItem,
          order: maxOrder + 1,
          available: true,
        });
        toast.success("Menu item added");
      }
      setNewItem({
        name: "",
        description: "",
        price: 0,
        category: categories[0]?.name || "",
        available: true,
        order: 0,
      });
    } catch (error) {
      toast.error(
        isEditing ? "Failed to update menu item" : "Failed to add menu item",
      );
    }
  };

  const startEditing = (item: MenuItem) => {
    setIsEditing(item.id);
    setNewItem({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      available: item.available,
      order: item.order,
      isTraditional: item.isTraditional || false,
    });
    // Scroll to form
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleMoveMenuItem = async (
    item: MenuItem,
    direction: "up" | "down",
  ) => {
    const itemsInCategory = menuItems
      .filter((i) => i.category === item.category)
      .sort((a, b) => a.order - b.order);

    const currentIndex = itemsInCategory.findIndex((i) => i.id === item.id);
    if (currentIndex === -1) return;

    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= itemsInCategory.length) return;

    const targetItem = itemsInCategory[targetIndex];

    try {
      await updateDoc(doc(db, "menu", item.id), { order: targetItem.order });
      await updateDoc(doc(db, "menu", targetItem.id), { order: item.order });
      toast.success("Position updated");
    } catch (error) {
      toast.error("Failed to update position");
    }
  };

  const cancelEditing = () => {
    setIsEditing(null);
    setNewItem({
      name: "",
      description: "",
      price: 0,
      category: categories[0]?.name || "",
      available: true,
    });
  };

  const handleUpdateStatus = async (orderId: string, status: string) => {
    try {
      const updateData: any = { 
        status,
        statusUpdatedAt: serverTimestamp()
      };
      if (["delivered", "collected", "cancelled"].includes(status)) {
        updateData.completedAt = serverTimestamp();
      }
      if (["ready", "shipped"].includes(status)) {
        updateData.readyAt = serverTimestamp();
      }
      await updateDoc(doc(db, "orders", orderId), updateData);
      toast.success(`Order status updated to ${status}`);
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const handleDeleteAllOrders = async () => {
    if (!showResetConfirm) {
      setShowResetConfirm(true);
      toast.info("Click again to confirm PERMANENT deletion of ALL orders.");
      setTimeout(() => setShowResetConfirm(false), 5000);
      return;
    }

    setIsResettingOrders(true);
    setShowResetConfirm(false);
    try {
      const q = query(collection(db, "orders"));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        toast.info("No orders to delete.");
        return;
      }

      // Use batches for efficiency (limit 500 per batch)
      const batchSize = 500;
      const totalDocs = snap.docs.length;
      let deletedCount = 0;

      for (let i = 0; i < totalDocs; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = snap.docs.slice(i, i + batchSize);
        chunk.forEach((d) => {
          batch.delete(d.ref);
          deletedCount++;
        });
        await batch.commit();
      }
      
      toast.success(`Success! ${deletedCount} orders have been permanently deleted.`);
    } catch (error: any) {
      console.error("Error deleting orders:", error);
      if (error.code === 'permission-denied') {
        toast.error("Permission Denied: You do not have authority to delete orders.");
      } else {
        toast.error(`Error: ${error.message || "Failed to delete orders"}`);
      }
    } finally {
      setIsResettingOrders(false);
    }
  };

  const handleNotifyCustomer = async (order: Order, newStatus: string) => {
    try {
      await updateDoc(doc(db, "orders", order.id), { 
        status: newStatus,
        statusUpdatedAt: serverTimestamp(),
        readyAt: serverTimestamp()
      });

      // Strict check: Only send collection-ready for collection orders, and delivery-on-the-way for delivery orders
      const isCollectionReady = newStatus === "ready" && order.type === "collection";
      const isDeliveryShipped = newStatus === "shipped" && order.type === "delivery";

      if (!isCollectionReady && !isDeliveryShipped) {
        toast.success(`Order marked as ${newStatus}`);
        return;
      }

      const notifType = isCollectionReady ? "collection-ready" : "delivery-on-the-way";
      const formattedId = formatOrderId(order.id);
      const customerName = order.customerName || "Customer";

      const notificationMsg = isCollectionReady
        ? `Your order ${formattedId} is ready for collection at Mughal Dynasty!`
        : `Your order ${formattedId} is out for delivery!`;

      if (order.email) {
        try {
          const plainTextMessage = `Hi ${customerName},\n\n${notificationMsg}\n\nOrder ID: ${formattedId}\n\nEnjoy your meal! Please leave us a review if you enjoyed it.\n\n© 2026 Mughal Dynasty Restaurant.\n01933 626351 | High Street, Raunds`;

          const res = await sendEmail({
            to_email: order.email,
            to_name: customerName,
            subject: `Order Update ${formattedId} - Mughal Dynasty`,
            html_message: getOrderUpdateTemplate(
              customerName,
              formattedId,
              notificationMsg
            ),
            message: plainTextMessage,
            order_id: formattedId,
            entityId: order.id,
            entityType: "order",
            notificationType: notifType,
            idempotencyKey: `order_${order.id}_${notifType}`,
          });

          if (res?.alreadySent) {
            toast.info(`Notification previously sent to ${order.email} (duplicate prevented)`);
          } else if (res?.success) {
            toast.success(`Email notification sent to ${order.email} via ${res.provider || "Gmail"}`);
          } else {
            toast.error("Status updated, but email delivery failed.");
          }
        } catch (emailError) {
          console.error("Email Notification Error:", emailError);
          toast.error("Status updated, but email failure.");
        }
      } else {
        toast.success(`Order marked as ${newStatus}`);
      }
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  useEffect(() => {
    if (newOrderPopup) {
      if (newOrderPopup.timeSlot && newOrderPopup.timeSlot !== "ASAP") {
        setEstimateInput(newOrderPopup.timeSlot);
      } else {
        const defaultTime = newOrderPopup.type === "delivery" ? 60 : 20;
        setEstimateInput(`${defaultTime} mins`);
      }
    }
  }, [newOrderPopup?.id]);

  const adjustEstimate = (delta: number) => {
    const currentMins = parseInt(estimateInput) || 20;
    const newMins = Math.max(5, currentMins + delta);
    setEstimateInput(`${newMins} mins`);
  };

  const generateReceiptHtml = (
    order: Order,
    copyType: "KITCHEN" | "CUSTOMER" = "CUSTOMER",
  ) => {
    const _s = receiptSettings;

    const subtotalVal =
      (order as any).subtotal ||
      order.total + ((order as any).discountAmount || 0);
    const stampDiscount = (order as any).stampCardDiscount || 0;
    const itemDiscount = (order as any).discountAmount || 0;
    const intermediateTotal = subtotalVal - stampDiscount - itemDiscount;
    const finalTotal = order.total;

    return `
      <div class="receipt-preview-wrapper">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');
          
          .receipt-preview-wrapper { 
            font-family: 'JetBrains Mono', monospace; 
            padding: 0; 
            margin: 0; 
            color: #000 !important; 
            line-height: 1.15; 
            width: 100%; 
            background: #fff;
          }
          .receipt-container { 
            background: #fff; 
            width: 100%; 
            max-width: 400px; 
            margin: 0 auto; 
            padding: 20px; 
            color: #000 !important;
          }
          .divider { border-top: 2px dashed #000; margin: 12px 0; width: 100%; }
          
          .order-id { font-size: 24pt; font-weight: 800; text-align: center; margin: 15px 0; color: #000 !important; }

          .receipt-table { width: 100%; border-collapse: collapse; table-layout: fixed; color: #000 !important; }
          .col-label { text-align: left; vertical-align: top; padding: 6px 0; font-size: 13pt; color: #000 !important; }
          .col-price { text-align: right; vertical-align: top; padding: 6px 0; width: 100px; font-size: 13pt; color: #000 !important; }
          
          .header-gbp { font-weight: 700; font-size: 11pt; padding-bottom: 8px; color: #000 !important; }
          .item-name { font-weight: 700; display: block; color: #000 !important; }
          .item-sub { font-size: 11pt; font-weight: 400; color: #000 !important; margin-top: 4px; }

          .spacer-row td { height: 15px; }
          .separator-row td { border-top: 2px dashed #000; padding: 10px 0; }

          .grand-total-label { font-size: 15pt; font-weight: 800; padding-top: 20px; color: #000 !important; }
          .grand-total-value { font-size: 18pt; font-weight: 800; border-top: 3px solid #000; padding-top: 8px; text-align: right; width: 100px; color: #000 !important; }

          .payment-info { width: 100%; margin: 25px auto 0; font-size: 14pt; color: #000 !important; }
          .payment-label { font-weight: 800; display: block; margin-bottom: 4px; }
          .payment-value { font-weight: 400; }
          
          .client-section { width: 100%; margin: 35px auto 0; border-top: 2px solid #000; padding-top: 20px; text-align: left; color: #000 !important; }
          .client-label { font-size: 11pt; font-weight: 400; margin-bottom: 6px; color: #444 !important; text-align: left; }
          .client-name { font-size: 17pt; font-weight: 800; margin: 8px 0; text-align: left; color: #000 !important; }
          .client-address { font-size: 14pt; font-weight: 400; line-height: 1.3; margin-bottom: 12px; text-align: left; color: #000 !important; }
          .client-notes { font-family: Arial, sans-serif; font-style: italic; font-size: 24pt; font-weight: bold; line-height: 1.2; margin-bottom: 20px; border: 3px solid #000; padding: 12px; text-align: left; width: 100%; box-sizing: border-box; color: #000 !important; }
          .contact-number { font-size: 18pt; font-weight: 800; text-align: left; color: #000 !important; }
        </style>
        <div class="receipt-container">
          <div class="header">
            <img src="/logo.png" style="width: 180px; height: auto; display: block; margin: 0 auto 15px;" referrerPolicy="no-referrer" />
          </div>
          <div class="divider"></div>
          <div class="order-id">${formatOrderId(order.id)}</div>
          <div style="font-size: 22pt; font-weight: 800; text-align: center; margin: 12px 0; background-color: #000; color: #fff !important; padding: 10px 0; border-radius: 4px; text-transform: uppercase; letter-spacing: 2px;">
            ${(order.type || "collection").toUpperCase()}
          </div>
          <div class="divider"></div>
          ${order.notes ? `<div class="client-notes">Notes: ${order.notes}</div>` : ""}
          
          <table class="receipt-table">
            <thead>
              <tr>
                <th></th>
                <th class="col-price header-gbp">GBP</th>
              </tr>
            </thead>
            <tbody>
              ${order.items
                .map((item) => {
                  let cleanedName = item.name;
                  let displayVariant = item.variant || "";

                  if (
                    displayVariant &&
                    cleanedName.includes(`(${displayVariant})`)
                  ) {
                    cleanedName = cleanedName
                      .replace(`(${displayVariant})`, "")
                      .trim();
                  } else if (
                    displayVariant &&
                    cleanedName
                      .toLowerCase()
                      .includes(displayVariant.toLowerCase())
                  ) {
                    displayVariant = "";
                  }

                  let finalDisplayName =
                    (displayVariant ? displayVariant + " " : "") + cleanedName;
                  let displayNotes = item.notes;

                  if (copyType === "KITCHEN") {
                    finalDisplayName = removeAllergyBrackets(finalDisplayName);
                    if (displayNotes) {
                      displayNotes = removeAllergyBrackets(displayNotes);
                    }
                  }

                  const showNotes =
                    displayNotes &&
                    (!item.variant ||
                      !displayNotes
                        .toLowerCase()
                        .includes(item.variant.toLowerCase())) &&
                    !finalDisplayName
                      .toLowerCase()
                      .includes(displayNotes.toLowerCase());

                  return `
                <tr>
                  <td class="col-label">
                    <span class="item-name">${item.quantity} x ${finalDisplayName}</span>
                    ${showNotes ? `<div class="item-sub">${displayNotes}</div>` : ""}
                  </td>
                  <td class="col-price">${(item.price * item.quantity).toFixed(2)}</td>
                </tr>
              `;
                })
                .join("")}

              <tr class="separator-row"><td colspan="2"></td></tr>

              <tr>
                <td class="col-label">Subtotal</td>
                <td class="col-price">${subtotalVal.toFixed(2)}</td>
              </tr>
              ${
                stampDiscount > 0
                  ? `
                <tr>
                  <td class="col-label">StampCard discount</td>
                  <td class="col-price">-${stampDiscount.toFixed(2)}</td>
                </tr>
              `
                  : ""
              }
              ${
                itemDiscount > 0
                  ? `
                <tr>
                  <td class="col-label">Restaurant discount</td>
                  <td class="col-price">-${itemDiscount.toFixed(2)}</td>
                </tr>
              `
                  : ""
              }

              <tr class="spacer-row"><td colspan="2"></td></tr>

              <tr>
                <td class="col-label">Order total</td>
                <td class="col-price">${intermediateTotal.toFixed(2)}</td>
              </tr>
              
              ${
                (order as any).serviceCharge > 0
                  ? `
                <tr>
                  <td class="col-label">Service charge</td>
                  <td class="col-price">${(order as any).serviceCharge.toFixed(2)}</td>
                </tr>
              `
                  : ""
              }
              ${
                (order as any).deliveryFee > 0
                  ? `
                <tr>
                  <td class="col-label">Delivery charge</td>
                  <td class="col-price">${(order as any).deliveryFee.toFixed(2)}</td>
                </tr>
              `
                  : ""
              }
              ${
                (order as any).bagCharge > 0
                  ? `
                <tr>
                  <td class="col-label">Bag charge</td>
                  <td class="col-price">${(order as any).bagCharge.toFixed(2)}</td>
                </tr>
              `
                  : ""
              }

              <tr>
                <td class="col-label grand-total-label">Total Due</td>
                <td class="col-price">
                  <div style="padding-top: 15px;">
                    <div class="grand-total-value">${finalTotal.toFixed(2)}</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="payment-info">
            <span class="payment-label">Paid by:</span>
            <span class="payment-value">${(order.paymentMethod || "CASH").toUpperCase().replace(/_/g, " ")}</span>
          </div>

          <div class="client-section">
            <div class="client-label">Customer details:</div>
            <div class="client-name">${order.customerName}</div>
            <div class="client-address">
              ${order.houseName ? `<div>${order.houseName}</div>` : ""}
              <div>${order.houseNumber ? order.houseNumber + " " : ""}${order.streetName || ""}</div>
              ${order.areaName ? `<div>${order.areaName}</div>` : ""}
              ${order.postcode ? `<div>${formatPostcode(order.postcode)}</div>` : ""}
              ${
                !order.streetName && order.address
                  ? order.address
                      .split("\n")
                      .map((l, idx, arr) => {
                        const trimmed = l.trim();
                        if (idx === arr.length - 1 && trimmed.length >= 5 && trimmed.length <= 9) {
                          return `<div>${formatPostcode(trimmed)}</div>`;
                        }
                        return `<div>${l}</div>`;
                      })
                      .join("")
                  : ""
              }
            </div>
            <div class="contact-number">${order.phone}</div>
          </div>
        </div>
      </div>
    `;
  };

  const generateEscPosData = (
    order: Order,
    copyType: "KITCHEN" | "CUSTOMER" = "CUSTOMER",
  ) => {
    const encoder = new EscPosEncoder();
    const s = receiptSettings;
    const PRINTER_WIDTH = 48;
    const separator = "=".repeat(PRINTER_WIDTH);
    const dashedSeparator = "-".repeat(PRINTER_WIDTH);

    const formatRow = (
      left: string,
      right: string,
      width: number = PRINTER_WIDTH,
    ): string => {
      const spaces = width - left.length - right.length;
      return left + " ".repeat(Math.max(1, spaces)) + right;
    };

    const wrapLines = (text: string, limit: number): string[] => {
      if (!text) return [];
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let currentLine = "";

      words.forEach((word) => {
        if ((currentLine + (currentLine ? " " : "") + word).length <= limit) {
          currentLine += (currentLine ? " " : "") + word;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });
      if (currentLine) lines.push(currentLine);
      return lines;
    };

    encoder.initialize().align("center");

    if (copyType === "KITCHEN") {
      encoder.bold(true).size(2, 2).line("KITCHEN COPY").size(1, 1).feed(1);
    } else {
      encoder.feed(1);
    }

    // 1. Header & Deterministic ID
    encoder.align("center");
    encoder.line(dashedSeparator);
    encoder
      .size(2, 2)
      .bold(true)
      .line(formatOrderId(order.id))
      .feed(1)
      .line((order.type || "collection").toUpperCase())
      .size(1, 1)
      .bold(false);

    // Timing Information
    if (order.timeSlot && order.timeSlot !== "ASAP") {
      encoder.feed(1).bold(true).size(2, 2).line("SCHEDULED TIME").size(1, 1);
      encoder.size(2, 2).line(order.timeSlot.toUpperCase()).size(1, 1).feed(1);
    } else if (order.estimate) {
      encoder.feed(1).bold(true).size(2, 2).line("PREP TIME:").size(1, 1);
      encoder.size(2, 2).line(order.estimate.toUpperCase()).size(1, 1).feed(1);
    }

    if (order.notes) {
      encoder.align("left").bold(true).line("NOTES:");
      encoder.size(2, 2).bold(true); // Double size for maximum visibility
      wrapLines(
        order.notes,
        Math.floor(PRINTER_WIDTH / 2),
      ).forEach((line) => {
        encoder.line(line);
      });
      encoder.size(1, 1).bold(false).feed(1);
    }

    encoder.line(dashedSeparator).feed(1);

    // 2. Items
    if (copyType !== "KITCHEN") {
      encoder
        .align("left")
        .bold(true)
        .line(formatRow("", "GBP", PRINTER_WIDTH))
        .bold(false);
    } else {
      encoder.align("left").bold(true).line("ITEMS").bold(false);
    }

    order.items.forEach((item) => {
      const qtyStr = `${item.quantity} x `;
      const priceStr = (item.price * item.quantity).toFixed(2);

      let cleanedName = item.name;
      let displayVariant = item.variant || "";

      if (displayVariant && cleanedName.includes(`(${displayVariant})`)) {
        cleanedName = cleanedName.replace(`(${displayVariant})`, "").trim();
      } else if (
        displayVariant &&
        cleanedName.toLowerCase().includes(displayVariant.toLowerCase())
      ) {
        displayVariant = "";
      }

      let finalDisplayName =
        (displayVariant ? displayVariant + " " : "") + cleanedName;
      let displayNotes = item.notes;

      // On Kitchen Copy, remove allergy markers like (N), (D), (G), (N),(D) etc.
      if (copyType === "KITCHEN") {
        finalDisplayName = removeAllergyBrackets(finalDisplayName);
        if (displayNotes) {
          displayNotes = removeAllergyBrackets(displayNotes);
        }
      }

      if (copyType === "KITCHEN") {
        encoder
          .align("left")
          .bold(true)
          .line(formatRow(qtyStr + finalDisplayName, "", PRINTER_WIDTH))
          .bold(false);
      } else {
        encoder
          .align("left")
          .line(formatRow(qtyStr + finalDisplayName, priceStr, PRINTER_WIDTH));
      }

      const showNotes =
        displayNotes &&
        (!item.variant ||
          !displayNotes.toLowerCase().includes(item.variant.toLowerCase())) &&
        !finalDisplayName.toLowerCase().includes(displayNotes.toLowerCase());

      if (showNotes) {
        encoder.line(`  (${displayNotes})`);
      }
    });

    encoder.feed(1);

    // 3. Totals
    if (copyType !== "KITCHEN") {
      const subtotalVal =
        (order as any).subtotal ||
        order.total + ((order as any).discountAmount || 0);
      const stampDiscount = (order as any).stampCardDiscount || 0;
      const itemDiscount = (order as any).discountAmount || 0;
      const intermediateTotal = subtotalVal - stampDiscount - itemDiscount;
      const finalTotal = order.total;

      encoder.align("left");
      encoder.line(formatRow("Subtotal", subtotalVal.toFixed(2), PRINTER_WIDTH));

      if (stampDiscount > 0) {
        encoder.line(
          formatRow(
            "StampCard discount",
            `-${stampDiscount.toFixed(2)}`,
            PRINTER_WIDTH,
          ),
        );
      }
      if (itemDiscount > 0) {
        encoder.line(
          formatRow(
            "Restaurant discount",
            `-${itemDiscount.toFixed(2)}`,
            PRINTER_WIDTH,
          ),
        );
      }

      encoder.feed(1);

      encoder.line(
        formatRow("Order total", intermediateTotal.toFixed(2), PRINTER_WIDTH),
      );

      if ((order as any).serviceCharge > 0) {
        encoder.line(
          formatRow(
            "Service charge",
            (order as any).serviceCharge.toFixed(2),
            PRINTER_WIDTH,
          ),
        );
      }
      if ((order as any).deliveryFee > 0) {
        encoder.line(
          formatRow(
            "Delivery charge",
            (order as any).deliveryFee.toFixed(2),
            PRINTER_WIDTH,
          ),
        );
      }
      if ((order as any).bagCharge > 0) {
        encoder.line(
          formatRow(
            "Bag charge",
            (order as any).bagCharge.toFixed(2),
            PRINTER_WIDTH,
          ),
        );
      }

      encoder.feed(1);
      encoder.align("right").line("----------");
      encoder
        .size(2, 2)
        .bold(true)
        .line(formatRow("Total Due", finalTotal.toFixed(2), 24))
        .size(1, 1)
        .bold(false);
      encoder.feed(1);
    } else {
      encoder.feed(1).line("-".repeat(PRINTER_WIDTH)).feed(1);
    }

    // 4. Payment Info
    encoder.align("left").bold(true).line("Paid by:");
    const payMethod = (order.paymentMethod || "CASH")
      .toUpperCase()
      .replace(/_/g, " ");
    encoder.bold(false).line(payMethod).feed(1);

    // 6. Status Banner
    const bannerText =
      order.paymentMethod === "pay_online"
        ? "ORDER PAID"
        : order.paymentMethod === "card_on_collection"
          ? "CARD ON COLLECTION"
          : "CASH ORDER";

    encoder
      .line(separator)
      .size(2, 2)
      .bold(true)
      .line(bannerText)
      .size(1, 1)
      .bold(false)
      .line(separator)
      .feed(1);

    // 7. Client Info
    encoder
      .align("left")
      .line(`Customer ID ${order.userId.slice(-11).toUpperCase()}`)
      .bold(true)
      .line("Customer details:")
      .bold(false)
      .size(2, 2)
      .bold(true)
      .line(order.customerName || "GUEST")
      .size(1, 1)
      .bold(false);

    if (order.houseName) {
      encoder.size(2, 2).bold(true);
      wrapLines(order.houseName, 21).forEach((line) =>
        encoder.line(line),
      );
      encoder.size(1, 1).bold(false);
    }

    if (order.streetName) {
      encoder.size(2, 2).bold(true);
      const streetLine =
        `${order.houseNumber ? order.houseNumber + " " : ""}${order.streetName}`;
      wrapLines(streetLine, 21).forEach((line) => encoder.line(line));

      if (order.areaName) {
        wrapLines(order.areaName, 21).forEach((line) =>
          encoder.line(line),
        );
      }
      if (order.postcode) {
        wrapLines(formatPostcode(order.postcode), 21).forEach((line) =>
          encoder.line(line),
        );
      }
      encoder.size(1, 1).bold(false);
    } else if (order.address) {
      encoder.size(2, 2).bold(true);
      const addrLines = order.address.split("\n");
      addrLines.forEach((addrPart, idx) => {
        const trimmed = addrPart.trim();
        const isLastLine = idx === addrLines.length - 1;
        let displayPart = addrPart;
        if (isLastLine && trimmed.length >= 5 && trimmed.length <= 9) {
          displayPart = formatPostcode(trimmed);
        } else if (trimmed.length <= 9 && trimmed.length >= 5) {
          displayPart = formatPostcode(trimmed);
        }
        wrapLines(displayPart, 21).forEach((line) => {
          encoder.line(line);
        });
      });
      encoder.size(1, 1).bold(false);
    }

    encoder
      .feed(1)
      .line("To contact customer call:")
      .size(2, 2)
      .bold(true)
      .line(order.phone)
      .size(1, 1)
      .bold(false);

    // 8. Footer
    encoder
      .line(dashedSeparator)
      .bold(true)
      .line(
        `Placed: ${new Date(order.createdAt?.toMillis() || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      )
      .line(
        `Accepted: ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      )
      .bold(false)
      .feed(3)
      .cut();

    return encoder.encode();
  };

  const handlePrint = async (order: Order) => {
    const toastId = toast.loading("Printing...");
    try {
      const kitchenData = generateEscPosData(order, "KITCHEN");
      const customerData = generateEscPosData(order, "CUSTOMER");

      // Combine both sets of data into one single print job
      // This reduces browser "Continue to RawBT?" prompts from 2 to 1
      const combined = new Uint8Array(kitchenData.length + customerData.length);
      combined.set(customerData); // Customer receipt first
      combined.set(kitchenData, customerData.length); // Kitchen receipt second

      const toBase64 = (data: Uint8Array) => {
        let binary = "";
        for (let i = 0; i < data.byteLength; i++) {
          binary += String.fromCharCode(data[i]);
        }
        return window.btoa(binary);
      };

      const combinedB64 = toBase64(combined);

      // Print combined data in one go
      window.location.href = `rawbt:base64,${combinedB64}`;

      toast.success("Printed successfully", { id: toastId });
    } catch (err) {
      console.error("Print failed:", err);
      toast.error("Print failed. Ensure RawBT app is installed.", {
        id: toastId,
      });
    }
  };

  const handleDeleteMenuItem = async (id: string) => {
    toast("Delete this item?", {
      description: "This action cannot be undone.",
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDoc(doc(db, "menu", id));
            toast.success("Item deleted");
          } catch (error) {
            toast.error("Failed to delete item");
          }
        },
      },
    });
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      await updateDoc(doc(db, "menu", item.id), { available: !item.available });
    } catch (error) {
      toast.error("Failed to update availability");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 bg-[#0a0a0a] text-white p-4 sm:p-10 min-h-screen max-w-full w-full overflow-x-hidden relative">
      {/* New Order Popup Modal */}
      <AnimatePresence>
        {newOrderPopup && (
          <motion.div
            key={newOrderPopup.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#1a1a1a] border border-orange-500/40 rounded-[2.5rem] p-8 max-w-4xl w-full shadow-2xl shadow-orange-500/20 max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-orange-600/30">
                    <Bell className="text-white" size={28} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter italic">
                      NEW ORDER!
                    </h3>
                    <p className="text-orange-500 font-bold text-xs tracking-[0.2em] uppercase">
                      Status: Urgent Action Required
                    </p>
                  </div>
                </div>
                {newOrdersQueue.length > 1 && (
                  <div className="px-6 py-3 bg-orange-600/20 border border-orange-500/20 rounded-2xl">
                    <span className="text-orange-500 font-black text-sm italic">
                      QUEUE: 1 OF {newOrdersQueue.length}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                {/* Left Column: Order Details */}
                <div className="space-y-4">
                  <div className="bg-white/5 p-6 rounded-2xl border border-white/10 space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                        Reference
                      </span>
                      <span className="font-mono text-white text-lg font-bold">
                        {formatOrderId(newOrderPopup.id)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                        Customer
                      </span>
                      <span className="font-bold text-white text-lg">
                        {newOrderPopup.customerName || "Guest"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                        Phone
                      </span>
                      <span className="font-bold text-orange-500">
                        {newOrderPopup.phone}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                        Type
                      </span>
                      <span className="bg-orange-600/20 text-orange-500 px-3 py-1 rounded-full text-[10px] font-black uppercase border border-orange-500/20">
                        {newOrderPopup.type}
                      </span>
                    </div>
                    {(newOrderPopup.type === "delivery" ||
                      newOrderPopup.address) && (
                      <div className="flex flex-col gap-1 pt-2 border-t border-white/5">
                        <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                          Delivery Address
                        </span>
                        <div className="text-sm font-bold text-white">
                          {newOrderPopup.houseName && (
                            <div>{newOrderPopup.houseName}</div>
                          )}
                          {newOrderPopup.streetName && (
                            <div>
                              {newOrderPopup.houseNumber
                                ? newOrderPopup.houseNumber + " "
                                : ""}
                              {newOrderPopup.streetName}
                            </div>
                          )}
                          {newOrderPopup.areaName && (
                            <div>{newOrderPopup.areaName}</div>
                          )}
                          {newOrderPopup.postcode && (
                            <div>{newOrderPopup.postcode}</div>
                          )}
                          {!newOrderPopup.streetName &&
                            newOrderPopup.address && (
                              <div className="whitespace-pre-wrap">
                                {newOrderPopup.address}
                              </div>
                            )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                    <label className="text-[10px] font-black text-gray-500 mb-4 block uppercase tracking-widest">
                      Order Items
                    </label>
                    <div className="space-y-3">
                      {newOrderPopup.items?.map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex justify-between items-start pt-3 border-t border-white/5 first:border-0 first:pt-0"
                        >
                          <div>
                            <span className="text-orange-500 font-black mr-2">
                              {item.quantity}x
                            </span>
                            <span className="text-sm font-bold text-gray-300">
                              {item.variant &&
                              !item.name
                                .toLowerCase()
                                .includes(item.variant.toLowerCase())
                                ? `${item.variant} ${item.name}`
                                : item.name}
                            </span>
                          </div>
                          <span className="text-sm font-bold text-white">
                            {formatPrice(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                      <div className="pt-4 mt-4 border-t-2 border-dashed border-white/10 flex justify-between items-center">
                        <span className="text-gray-400 font-black text-xs uppercase tracking-widest">
                          Total Amount
                        </span>
                        <span className="text-xl font-black text-orange-500">
                          {formatPrice(newOrderPopup.total)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Time Selection */}
                <div className="space-y-6 flex flex-col justify-center">
                  <div className="bg-white/5 p-8 rounded-2xl border border-orange-500/20 shadow-inner">
                    {newOrderPopup.timeSlot &&
                    newOrderPopup.timeSlot !== "ASAP" ? (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-500/30">
                          <Clock className="text-blue-500" size={32} />
                        </div>
                        <h4 className="text-xl font-black text-white uppercase tracking-tighter italic mb-2">
                          Scheduled Order
                        </h4>
                        <p className="text-blue-400 font-bold text-lg">
                          {newOrderPopup.timeSlot}
                        </p>
                        <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mt-4">
                          This order is pre-booked by the customer.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <label className="text-[10px] font-black text-orange-500 mb-6 block uppercase tracking-[0.3em]">
                          Estimated Preparation Time
                        </label>

                        <div className="flex items-center gap-6 p-4 bg-white/5 border border-white/10 rounded-[32px] w-full max-w-[280px] justify-between shadow-2xl relative">
                          <button
                            onClick={() => adjustEstimate(-5)}
                            className="w-14 h-14 flex items-center justify-center bg-white/10 rounded-2xl hover:bg-white/20 transition-all text-white group"
                            title="Decrease 5 minutes"
                          >
                            <Minus
                              size={24}
                              className="group-active:scale-90 transition-transform"
                            />
                          </button>

                          <div className="flex flex-col items-center select-none">
                            <span className="text-3xl font-black text-white italic tracking-tighter leading-none">
                              {parseInt(estimateInput) || 20}
                            </span>
                            <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest mt-1">
                              MINS
                            </span>
                          </div>

                          <button
                            onClick={() => adjustEstimate(5)}
                            className="w-14 h-14 flex items-center justify-center bg-orange-600 rounded-2xl hover:bg-orange-700 transition-all text-white shadow-lg shadow-orange-600/30 group"
                            title="Increase 5 minutes"
                          >
                            <Plus
                              size={24}
                              className="group-active:scale-95 transition-transform"
                            />
                          </button>
                        </div>

                        <div className="mt-8 grid grid-cols-3 gap-2 w-full">
                          {[15, 20, 30, 45, 60, 90].map((mins) => (
                            <button
                              key={mins}
                              onClick={() => setEstimateInput(`${mins} mins`)}
                              className={cn(
                                "py-3 rounded-xl text-[10px] font-black transition-all border uppercase tracking-tighter",
                                parseInt(estimateInput) === mins
                                  ? "bg-orange-500/20 border-orange-500/40 text-orange-500"
                                  : "bg-white/5 border-white/10 text-gray-500 hover:border-white/20",
                              )}
                            >
                              {mins}M
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => {
                        const estimate =
                          newOrderPopup.timeSlot &&
                          newOrderPopup.timeSlot !== "ASAP"
                            ? newOrderPopup.timeSlot
                            : estimateInput;
                        handleAcceptOrder(newOrderPopup.id, estimate);
                      }}
                      className="w-full px-6 py-5 bg-orange-600 text-white rounded-2xl text-[13px] font-black hover:bg-orange-700 transition-all shadow-2xl shadow-orange-600/40 uppercase tracking-[0.2em] flex items-center justify-center gap-3"
                    >
                      <Check size={20} />
                      {newOrderPopup.timeSlot &&
                      newOrderPopup.timeSlot !== "ASAP"
                        ? "ACCEPT SCHEDULED"
                        : "ACCEPT & PRINT"}
                      {newOrdersQueue.length > 1 ? " (& NEXT)" : ""}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Reservation Popup Modal */}
      <AnimatePresence>
        {reservationPopup && (
          <motion.div
            key={reservationPopup.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[201] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#1a1a1a] border border-orange-500/40 rounded-[2.5rem] p-8 max-w-2xl w-full shadow-2xl shadow-orange-500/20 max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-orange-600/30">
                    <CalendarCheck className="text-white" size={28} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter italic">
                      NEW RESERVATION REQUEST!
                    </h3>
                    <p className="text-orange-500 font-bold text-xs tracking-[0.2em] uppercase">
                      Requires Confirmation
                    </p>
                  </div>
                </div>
                {newReservationsQueue.length > 1 && (
                  <div className="px-6 py-3 bg-orange-600/20 border border-orange-500/20 rounded-2xl">
                    <span className="text-orange-500 font-black text-sm italic">
                      QUEUE: 1 OF {newReservationsQueue.length}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 mb-8">
                <div className="bg-white/5 p-6 rounded-2xl border border-white/10 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Name</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.name}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Guests</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.guests} People</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Date</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.date}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Time Slot</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.time}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Phone</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.phone}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Email</p>
                      <p className="text-white font-bold text-lg mt-1">{reservationPopup.email}</p>
                    </div>
                  </div>

                  {reservationPopup.notes && (
                    <div className="pt-4 border-t border-white/5">
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Special Notes</p>
                      <p className="text-orange-200 text-sm mt-1 bg-orange-500/10 p-4 rounded-xl border border-orange-500/20">
                        "{reservationPopup.notes}"
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => handleRejectReservation(reservationPopup.id)}
                  className="w-1/3 px-6 py-5 bg-white/5 text-gray-400 rounded-2xl text-[13px] font-black hover:bg-white/10 hover:text-white transition-all uppercase tracking-[0.2em]"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleAcceptReservation(reservationPopup)}
                  className="w-2/3 px-6 py-5 bg-orange-600 text-white rounded-2xl text-[13px] font-black hover:bg-orange-700 transition-all shadow-2xl shadow-orange-600/40 uppercase tracking-[0.2em] flex items-center justify-center gap-3"
                >
                  <Check size={20} />
                  Accept Reservation
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Nav */}
      <aside className="lg:w-80 shrink-0 space-y-10">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-600/30">
              <Shield size={24} className="text-white" />
            </div>
            <h2 className="text-3xl font-black tracking-tighter text-white uppercase italic leading-none">
              ADMIN <span className="text-orange-600">PANEL</span>
            </h2>
          </div>
          <p className="text-gray-500 text-[10px] font-bold tracking-[0.3em] uppercase px-1">
            Control Operations Centre
          </p>
        </div>

        <nav className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-4 lg:pb-0 scrollbar-hide no-scrollbar">
          {[
            { id: "orders", label: "Live Orders", icon: Zap },
            { id: "reservations", label: "Reservations", icon: Calendar },
            { id: "history", label: "Past Week", icon: History },
            { id: "invoice", label: "Invoice", icon: FileText },
            { id: "menu", label: "Menu Editor", icon: LayoutGrid },
            { id: "categories", label: "Categories", icon: ClipboardList },
            { id: "traditional", label: "Meat Pricing", icon: Zap },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex-1 lg:w-full flex items-center justify-between px-6 py-4 lg:py-5 rounded-[1.5rem] text-xs lg:text-sm font-black transition-all uppercase tracking-tighter whitespace-nowrap lg:whitespace-normal min-w-[140px] lg:min-w-0",
                  isActive
                    ? "bg-orange-600 text-white shadow-2xl shadow-orange-600/40 translate-y-[-2px]"
                    : "text-gray-500 hover:text-white hover:bg-white/5",
                )}
              >
                <div className="flex items-center gap-3 lg:gap-4">
                  <Icon
                    size={18}
                    className={
                      isActive && tab.id === "orders" ? "animate-pulse" : ""
                    }
                  />
                  {tab.label}
                </div>
                {isActive && (
                  <ChevronRight size={16} className="hidden lg:block" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="pt-8 mt-8 border-t border-white/5 space-y-4">
          {!isAudioEnabled ? (
            <button
              onClick={enableAudio}
              className="w-full flex items-center gap-3 px-6 py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl text-[10px] font-black hover:bg-red-500/20 transition-all animate-pulse uppercase tracking-[0.1em]"
            >
              <Bell size={16} />
              Audio Alerts Disabled
            </button>
          ) : (
            <div className="flex items-center gap-3 px-6 py-4 bg-green-500/10 text-green-500 border border-green-500/20 rounded-2xl text-[10px] font-black uppercase tracking-[0.1em]">
              <Check size={16} />
              System Monitoring Active
            </div>
          )}
        </div>
      </aside>

      {/* Main Container */}
      <main className={cn(
        "flex-1 min-w-0 rounded-[3rem] p-6 sm:p-10 min-h-[600px] overflow-hidden transition-all duration-300",
        activeTab === "orders" || activeTab === "invoice"
          ? "bg-[#f8fafc] border-2 border-slate-200 text-slate-900 shadow-xl"
          : "bg-white/[0.03] border border-white/5 shadow-inner backdrop-blur-3xl text-white"
      )}>
        <AnimatePresence mode="wait">
          {activeTab === "invoice" ? (
            <motion.div
              key="invoice"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <AdminInvoice onBack={() => setActiveTab("orders")} />
            </motion.div>
          ) : activeTab === "reservations" ? (
            <motion.div
              key="reservations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 text-white"
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                  <h3 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3 italic">
                    <Calendar size={28} className="text-orange-500" />
                    Table <span className="text-orange-500">Reservations</span>
                  </h3>
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-widest leading-none mt-1">
                    Manage guest table bookings and request queue
                  </p>
                </div>

                {/* Sub tabs */}
                <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1 gap-1">
                  {(["pending", "accepted", "rejected"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveReservationSubTab(tab)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tighter transition-all",
                        activeReservationSubTab === tab
                          ? "bg-orange-600 text-white shadow-lg"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {tab} ({reservations.filter((r) => r.status === tab).length})
                    </button>
                  ))}
                </div>
              </div>

              {/* Reservations List */}
              {reservations.filter((r) => r.status === activeReservationSubTab).length === 0 ? (
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-16 text-center">
                  <Calendar size={48} className="text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400 font-bold uppercase text-sm tracking-wider">No {activeReservationSubTab} reservations found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {reservations
                    .filter((r) => r.status === activeReservationSubTab)
                    .map((res) => (
                      <div
                        key={res.id}
                        className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 space-y-4 shadow-xl hover:border-white/20 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex justify-between items-start">
                            <h4 className="font-black text-white text-lg tracking-tight uppercase italic">{res.name}</h4>
                            <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase text-orange-400 tracking-widest">
                              {res.guests} GUESTS
                            </span>
                          </div>

                          <div className="space-y-2 text-sm text-gray-400">
                            <div className="flex items-center gap-2">
                              <Calendar size={14} className="text-orange-500 shrink-0" />
                              <span className="font-bold">{res.date}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock size={14} className="text-orange-500 shrink-0" />
                              <span className="font-bold">{res.time}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Smartphone size={14} className="text-orange-500 shrink-0" />
                              <span>{res.phone}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Mail size={14} className="text-orange-500 shrink-0" />
                              <span className="truncate">{res.email}</span>
                            </div>
                          </div>

                          {res.notes && (
                            <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-xs text-orange-200/80">
                              <strong className="text-orange-400 block text-[9px] uppercase tracking-wider mb-1">Special Notes:</strong>
                              "{res.notes}"
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t border-white/5 flex gap-2">
                          {res.status === "pending" ? (
                            <>
                              <button
                                onClick={() => handleRejectReservation(res.id)}
                                className="flex-1 py-3 bg-white/5 hover:bg-red-950/20 hover:text-red-400 text-gray-400 border border-white/5 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                              >
                                Decline
                              </button>
                              <button
                                onClick={() => handleAcceptReservation(res)}
                                className="flex-[2] py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 shadow-lg shadow-orange-600/10"
                              >
                                <Check size={14} /> Accept
                              </button>
                            </>
                          ) : res.status === "accepted" ? (
                            <button
                              onClick={() => {
                                try {
                                  const escposData = generateReservationEscPosData(res);
                                  const toBase64 = (data: Uint8Array) => {
                                    let binary = "";
                                    for (let i = 0; i < data.byteLength; i++) {
                                      binary += String.fromCharCode(data[i]);
                                    }
                                    return window.btoa(binary);
                                  };
                                  const b64 = toBase64(escposData);
                                  window.location.href = `rawbt:base64,${b64}`;
                                  toast.success("Reprinting receipt...");
                                } catch (err) {
                                  toast.error("Reprint failed.");
                                }
                              }}
                              className="w-full py-3 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                            >
                              <Printer size={14} className="text-orange-500" /> Reprint Receipt
                            </button>
                          ) : (
                            <span className="w-full py-2 text-center text-[10px] font-black uppercase tracking-widest text-red-500/70 bg-red-500/5 border border-red-500/10 rounded-xl">
                              Declined
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </motion.div>
          ) : activeTab === "settings" ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="grid grid-cols-1 xl:grid-cols-12 gap-12 items-start"
            >
              {/* Preview Section */}
              <div className="xl:col-span-12 2xl:col-span-5 space-y-8">
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3 italic">
                    <ImageIcon size={28} className="text-orange-600" />
                    Visual <span className="text-orange-600">Preview</span>
                  </h3>
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-widest leading-none">
                    Live thermal receipt renderer
                  </p>
                </div>

                <div className="bg-[#1a1a1a] rounded-[3rem] p-10 shadow-[0_50px_100px_rgba(0,0,0,0.6)] border border-white/5 flex justify-center bg-gray-900/60 backdrop-blur-3xl relative overflow-visible group min-h-[500px]">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent pointer-events-none rounded-[3rem]" />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/10 rounded-b-xl" />

                  <div className="relative z-10 flex justify-center">
                    <motion.div
                      className="bg-white p-10 shadow-2xl w-[100mm] min-h-[500px] transform scale-75 sm:scale-90 md:scale-100 origin-top overflow-visible border border-gray-100 rounded-sm"
                      initial={{ y: 20 }}
                      animate={{ y: 0 }}
                      dangerouslySetInnerHTML={{
                        __html: generateReceiptHtml({
                          id: "MUG-99X8A",
                          userId: "preview-user",
                          customerName: "Masum Ahmed",
                          phone: "+44 1933 626351",
                          address: "14th Example Street, Raunds\nNN9 6HT",
                          items: [
                            {
                              name: "Traditional Chicken Curry",
                              price: 12.5,
                              quantity: 2,
                              variant: "Lamb",
                              notes: "Extra Spice",
                            },
                            { name: "Pilau Rice", price: 3.5, quantity: 2 },
                            { name: "Garlic Naan", price: 2.8, quantity: 1 },
                          ],
                          total: 34.8,
                          status: "pending",
                          type: "delivery",
                          paymentMethod: "cash",
                          notes: "Gate code 1234.",
                          createdAt: Timestamp.now(),
                        }),
                      }}
                    />
                  </div>
                </div>

                <div className="bg-orange-600/10 border border-orange-600/20 rounded-2xl p-6 flex gap-4">
                  <div className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center shrink-0">
                    <Zap size={24} className="text-white" />
                  </div>
                  <div>
                    <span className="font-black text-xs text-white uppercase block">
                      Wysiwyg Engine
                    </span>
                    <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                      Changes to your settings configuration will reflect
                      instantly in the preview above.
                    </p>
                  </div>
                </div>
              </div>

              {/* Configuration Controls */}
              <div className="xl:col-span-12 2xl:col-span-7 space-y-10">
                <div className="space-y-8">
                  <div className="space-y-2">
                    <h3 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3 italic leading-none">
                      <Settings size={28} className="text-orange-600" />
                      Store <span className="text-orange-600">Identity</span>
                    </h3>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-widest leading-none">
                      Main branding and contact information
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6">
                      <h4 className="text-lg font-black uppercase tracking-tighter text-white">
                        Store Identity
                      </h4>
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <label className="text-[10px] text-gray-500 mb-2 block uppercase font-black tracking-widest">
                            Business Name (TOP OF RECEIPT)
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.businessName || ""}
                            onChange={(e) =>
                              updateReceiptSetting(
                                "businessName",
                                e.target.value,
                              )
                            }
                            placeholder="e.g. Mughal Dynasty"
                            className="w-full bg-black/40 border-orange-500/30 border rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-2xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] text-gray-500 mb-2 block uppercase font-black tracking-widest">
                            Header Address
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.headerAddress || ""}
                            onChange={(e) =>
                              updateReceiptSetting(
                                "headerAddress",
                                e.target.value,
                              )
                            }
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] text-gray-500 mb-2 block uppercase font-black tracking-widest">
                            Header Phone
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.headerPhone || ""}
                            onChange={(e) =>
                              updateReceiptSetting(
                                "headerPhone",
                                e.target.value,
                              )
                            }
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner"
                          />
                        </div>
                        <div className="space-y-2 pt-2 border-t border-white/5">
                          <label className="text-[10px] text-gray-500 mb-2 block uppercase font-black tracking-widest">
                            Admin Passcode (Android Bypass)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              placeholder="Enter new admin passcode"
                              value={newPasscode}
                              onChange={(e) => setNewPasscode(e.target.value)}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner"
                            />
                            <button
                              onClick={handleSavePasscode}
                              disabled={!newPasscode || isUpdatingPasscode}
                              className="px-6 py-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors shrink-0"
                            >
                              Update
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-500 uppercase mt-1">
                            Used to log in to the admin panel from mobile devices where Google Sign-In is blocked. Default is "Mughal786!"
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6">
                      <h4 className="text-lg font-black uppercase tracking-tighter text-white">
                        Marketing Message
                      </h4>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] text-gray-500 mb-2 block uppercase font-black tracking-widest">
                            Footer Tagline/Promo
                          </label>
                          <input
                            type="text"
                            value={receiptSettings.infoBox1 || ""}
                            onChange={(e) =>
                              updateReceiptSetting("infoBox1", e.target.value)
                            }
                            placeholder="e.g. mughaldynasty.net"
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner"
                          />
                        </div>
                        <p className="text-[10px] text-gray-500 leading-relaxed italic">
                          This message appears prominently at the bottom of the
                          Customer Receipt.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-black uppercase tracking-tighter text-white italic leading-none">
                          <Clock
                            size={20}
                            className="inline mr-2 text-orange-500"
                          />
                          Business <span className="text-orange-500">Hours</span>
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {DAY_NAMES.map((dayName, index) => {
                          const hours =
                            receiptSettings.businessHours?.[index] ||
                            DEFAULT_BUSINESS_HOURS[index];
                          return (
                            <div
                              key={dayName}
                              className="bg-black/20 p-5 rounded-2xl border border-white/5 space-y-4"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-xs font-black uppercase tracking-widest text-orange-500">
                                  {dayName}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] text-gray-500 uppercase font-black tracking-widest">
                                    Open
                                  </label>
                                  <input
                                    type="time"
                                    value={hours.open}
                                    onChange={(e) => {
                                      const newOpen = e.target.value;
                                      const [h, m] = newOpen
                                        .split(":")
                                        .map(Number);
                                      const newHours = {
                                        ...(receiptSettings.businessHours ||
                                          DEFAULT_BUSINESS_HOURS),
                                        [index]: {
                                          ...hours,
                                          open: newOpen,
                                          openMins: h * 60 + m,
                                        },
                                      };
                                      updateReceiptSetting(
                                        "businessHours",
                                        newHours,
                                      );
                                    }}
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-xs font-bold text-white outline-none focus:border-orange-500/50"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] text-gray-500 uppercase font-black tracking-widest">
                                    Close
                                  </label>
                                  <input
                                    type="time"
                                    value={hours.close}
                                    onChange={(e) => {
                                      const newClose = e.target.value;
                                      const [h, m] = newClose
                                        .split(":")
                                        .map(Number);
                                      const newHours = {
                                        ...(receiptSettings.businessHours ||
                                          DEFAULT_BUSINESS_HOURS),
                                        [index]: {
                                          ...hours,
                                          close: newClose,
                                          closeMins: h * 60 + m,
                                        },
                                      };
                                      updateReceiptSetting(
                                        "businessHours",
                                        newHours,
                                      );
                                    }}
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-xs font-bold text-white outline-none focus:border-orange-500/50"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Restaurant & Reservation Closure Dates (Special Holidays / Maintenance) */}
                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h4 className="text-lg font-black uppercase tracking-tighter text-white italic leading-none flex items-center gap-2">
                            <CalendarX size={20} className="text-red-500" />
                            Closure Dates <span className="text-red-500">& Holidays</span>
                          </h4>
                          <p className="text-xs text-gray-400 mt-1">
                            Choose specific dates when the restaurant or table reservations are closed.
                          </p>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full w-fit">
                          {(receiptSettings.closedDates || []).length} Scheduled
                        </span>
                      </div>

                      {/* Add New Closure Date Form */}
                      <div className="bg-black/30 border border-white/5 rounded-2xl p-5 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                          <div className="sm:col-span-4 space-y-1.5">
                            <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest block">
                              Select Date
                            </label>
                            <input
                              type="date"
                              min={new Date().toISOString().split("T")[0]}
                              value={newClosedDate}
                              onChange={(e) => setNewClosedDate(e.target.value)}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500 transition-all cursor-pointer"
                            />
                          </div>

                          <div className="sm:col-span-4 space-y-1.5">
                            <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest block">
                              Close What?
                            </label>
                            <select
                              value={newClosedType}
                              onChange={(e) => setNewClosedType(e.target.value as any)}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white outline-none focus:border-red-500 transition-all appearance-none cursor-pointer"
                            >
                              <option value="all" className="bg-[#1a1a1a]">
                                Entire Restaurant (Orders & Bookings)
                              </option>
                              <option value="reservations" className="bg-[#1a1a1a]">
                                Table Reservations Only
                              </option>
                            </select>
                          </div>

                          <div className="sm:col-span-4 space-y-1.5">
                            <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest block">
                              Reason / Note
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="e.g. Christmas, Private Event"
                                value={newClosedReason}
                                onChange={(e) => setNewClosedReason(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-3 text-sm font-bold text-white outline-none focus:border-red-500 transition-all"
                              />
                              <button
                                type="button"
                                onClick={handleAddClosedDate}
                                className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors shrink-0 flex items-center gap-1.5 shadow-lg shadow-red-600/20"
                              >
                                <Plus size={16} />
                                <span>Add</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Scheduled Closed Dates List */}
                      <div className="space-y-3">
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                          Active Scheduled Closures
                        </h5>

                        {(!receiptSettings.closedDates || receiptSettings.closedDates.length === 0) ? (
                          <div className="p-4 bg-black/20 rounded-xl border border-dashed border-white/10 text-center text-xs text-gray-500">
                            No closure dates scheduled. The restaurant operates according to standard weekly opening hours.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {receiptSettings.closedDates.map((item) => (
                              <div
                                key={item.id}
                                className="bg-black/30 border border-white/10 rounded-xl p-4 flex items-start justify-between gap-3 group hover:border-red-500/30 transition-all"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-black text-white">
                                      {item.date}
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider",
                                        item.closeRestaurant
                                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                          : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                      )}
                                    >
                                      {item.closeRestaurant ? "Restaurant Closed" : "Reservations Closed"}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-400 font-medium">
                                    {item.reason || (item.closeRestaurant ? "Entire Restaurant Closed" : "Table Reservations Closed")}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveClosedDate(item.id)}
                                  className="p-1.5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded-lg transition-colors shrink-0"
                                  title="Remove closure date"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2">
                      <h4 className="text-lg font-black uppercase tracking-tighter text-white font-black italic">
                        <span className="text-orange-500">Order</span> Rules &
                        Promotions
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Minimum Orders */}
                        <div className="space-y-4 p-6 bg-black/20 rounded-2xl border border-white/5">
                          <h5 className="text-sm font-bold text-white uppercase tracking-widest mb-2">
                            Minimum Order Thresholds
                          </h5>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Collection (£)
                              </label>
                              <select
                                value={receiptSettings.minCollectionOrder || 0}
                                onChange={(e) =>
                                  updateReceiptSetting(
                                    "minCollectionOrder",
                                    Number(e.target.value),
                                  )
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    £{val}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Delivery (£)
                              </label>
                              <select
                                value={receiptSettings.minDeliveryOrder || 0}
                                onChange={(e) =>
                                  updateReceiptSetting(
                                    "minDeliveryOrder",
                                    Number(e.target.value),
                                  )
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    £{val}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-500 italic">
                            Customers cannot checkout unless their total meets
                            these amounts.
                          </p>
                        </div>

                        {/* Free Delivery */}
                        <div className="space-y-4 p-6 bg-black/20 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-sm font-bold text-white uppercase tracking-widest">
                                Free Delivery Promotion
                              </h5>
                              <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                                Offer free delivery on big orders
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                updateReceiptSetting(
                                  "freeDeliveryEnabled",
                                  !receiptSettings.freeDeliveryEnabled,
                                )
                              }
                              className={cn(
                                "w-10 h-5 rounded-full p-1 transition-all relative border border-white/10",
                                receiptSettings.freeDeliveryEnabled
                                  ? "bg-green-600 border-green-500"
                                  : "bg-black/40",
                              )}
                            >
                              <motion.div
                                className="w-3 h-3 bg-white rounded-full shadow-lg"
                                animate={{
                                  x: receiptSettings.freeDeliveryEnabled
                                    ? 20
                                    : 0,
                                }}
                              />
                            </button>
                          </div>
                          <div className="space-y-2 pt-2">
                            <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                              Free Delivery Over (£)
                            </label>
                            <select
                              disabled={!receiptSettings.freeDeliveryEnabled}
                              value={receiptSettings.freeDeliveryMinOrder || 0}
                              onChange={(e) =>
                                updateReceiptSetting(
                                  "freeDeliveryMinOrder",
                                  Number(e.target.value),
                                )
                              }
                              className={cn(
                                "w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer",
                                !receiptSettings.freeDeliveryEnabled &&
                                  "opacity-50 grayscale",
                              )}
                            >
                              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                <option key={val} value={val} className="bg-[#1a1a1a]">
                                  £{val}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2 lg:col-span-3">
                      <h4 className="text-lg font-black uppercase tracking-tighter text-white font-black italic">
                        <span className="text-orange-500">Discount</span> System
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {/* Collection */}
                        <div className="space-y-4 p-6 bg-black/20 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-sm font-bold text-white uppercase tracking-widest">
                                Collection Discount
                              </h5>
                              <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                                Applied to pick-up orders
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                updateReceiptSetting("collectionDiscount", {
                                  ...receiptSettings.collectionDiscount,
                                  enabled:
                                    !receiptSettings.collectionDiscount
                                      ?.enabled,
                                })
                              }
                              className={cn(
                                "w-10 h-5 rounded-full p-1 transition-all relative border border-white/10",
                                receiptSettings.collectionDiscount?.enabled
                                  ? "bg-orange-600 border-orange-500"
                                  : "bg-black/40",
                              )}
                            >
                              <motion.div
                                className="w-3 h-3 bg-white rounded-full shadow-lg"
                                animate={{
                                  x: receiptSettings.collectionDiscount?.enabled
                                    ? 20
                                    : 0,
                                }}
                              />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Min. Order (£)
                              </label>
                              <select
                                value={
                                  receiptSettings.collectionDiscount
                                    ?.minOrder || 0
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("collectionDiscount", {
                                    ...receiptSettings.collectionDiscount,
                                    minOrder: Number(e.target.value),
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    £{val}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Discount (%)
                              </label>
                              <select
                                value={
                                  receiptSettings.collectionDiscount
                                    ?.percentage || 0
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("collectionDiscount", {
                                    ...receiptSettings.collectionDiscount,
                                    percentage: Number(e.target.value),
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    {val}%
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Delivery */}
                        <div className="space-y-4 p-6 bg-black/20 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-sm font-bold text-white uppercase tracking-widest">
                                Delivery Discount
                              </h5>
                              <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                                Applied to delivery orders
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                updateReceiptSetting("deliveryDiscount", {
                                  ...receiptSettings.deliveryDiscount,
                                  enabled:
                                    !receiptSettings.deliveryDiscount?.enabled,
                                })
                              }
                              className={cn(
                                "w-10 h-5 rounded-full p-1 transition-all relative border border-white/10",
                                receiptSettings.deliveryDiscount?.enabled
                                  ? "bg-orange-600 border-orange-500"
                                  : "bg-black/40",
                              )}
                            >
                              <motion.div
                                className="w-3 h-3 bg-white rounded-full shadow-lg"
                                animate={{
                                  x: receiptSettings.deliveryDiscount?.enabled
                                    ? 20
                                    : 0,
                                }}
                              />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Min. Order (£)
                              </label>
                              <select
                                value={
                                  receiptSettings.deliveryDiscount?.minOrder || 0
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("deliveryDiscount", {
                                    ...receiptSettings.deliveryDiscount,
                                    minOrder: Number(e.target.value),
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    £{val}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Discount (%)
                              </label>
                              <select
                                value={
                                  receiptSettings.deliveryDiscount
                                    ?.percentage || 0
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("deliveryDiscount", {
                                    ...receiptSettings.deliveryDiscount,
                                    percentage: Number(e.target.value),
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    {val}%
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Cash Discount */}
                        <div className="space-y-4 p-6 bg-black/20 rounded-2xl border border-white/5">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className="text-sm font-bold text-white uppercase tracking-widest">
                                Cash Discount
                              </h5>
                              <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                                Applied to cash orders
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                updateReceiptSetting("cashDiscount", {
                                  enabled: !(receiptSettings.cashDiscount?.enabled ?? false),
                                  minOrder: receiptSettings.cashDiscount?.minOrder ?? 15,
                                  percentage: receiptSettings.cashDiscount?.percentage ?? 5,
                                })
                              }
                              className={cn(
                                "w-10 h-5 rounded-full p-1 transition-all relative border border-white/10",
                                receiptSettings.cashDiscount?.enabled
                                  ? "bg-orange-600 border-orange-500"
                                  : "bg-black/40",
                              )}
                            >
                              <motion.div
                                className="w-3 h-3 bg-white rounded-full shadow-lg"
                                animate={{
                                  x: receiptSettings.cashDiscount?.enabled
                                    ? 20
                                    : 0,
                                }}
                              />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Min. Order (£)
                              </label>
                              <select
                                value={
                                  receiptSettings.cashDiscount?.minOrder ?? 15
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("cashDiscount", {
                                    enabled: receiptSettings.cashDiscount?.enabled ?? false,
                                    minOrder: Number(e.target.value),
                                    percentage: receiptSettings.cashDiscount?.percentage ?? 5,
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 100].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    £{val}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest">
                                Discount (%)
                              </label>
                              <select
                                value={
                                  receiptSettings.cashDiscount?.percentage ?? 5
                                }
                                onChange={(e) =>
                                  updateReceiptSetting("cashDiscount", {
                                    enabled: receiptSettings.cashDiscount?.enabled ?? false,
                                    minOrder: receiptSettings.cashDiscount?.minOrder ?? 15,
                                    percentage: Number(e.target.value),
                                  })
                                }
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white shadow-inner appearance-none cursor-pointer"
                              >
                                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((val) => (
                                  <option key={val} value={val} className="bg-[#1a1a1a]">
                                    {val}%
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2">
                    <h4 className="text-lg font-black uppercase tracking-tighter text-white font-black italic">
                      <span className="text-orange-500">Delivery</span> Fee
                      Settings
                    </h4>
                    <div className="space-y-6">
                      <div className="p-6 bg-black/20 rounded-2xl border border-white/5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h5 className="text-sm font-bold text-white uppercase tracking-widest">
                              Local Delivery Charge
                            </h5>
                            <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                              Applied to NN9 6** Postcodes
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 font-bold">£</span>
                            <input
                              type="number"
                              step="0.01"
                              value={receiptSettings.localDeliveryFee || ""}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) =>
                                updateReceiptSetting(
                                  "localDeliveryFee",
                                  e.target.value === ""
                                    ? 0
                                    : Number(e.target.value),
                                )
                              }
                              className="w-24 bg-black/40 border-orange-500/30 border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white text-right"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(receiptSettings.deliveryFees || []).map(
                          (rule, idx) => (
                            <div
                              key={idx}
                              className="p-4 bg-black/20 rounded-2xl border border-white/5 space-y-4"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 space-y-1">
                                  <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-none">
                                    Postcode (e.g. NN10)
                                  </label>
                                  <input
                                    type="text"
                                    value={rule.postcode || ""}
                                    placeholder="NN10"
                                    onChange={(e) => {
                                      const newFees = [
                                        ...receiptSettings.deliveryFees,
                                      ];
                                      newFees[idx] = {
                                        ...newFees[idx],
                                        postcode: e.target.value.toUpperCase(),
                                      };
                                      updateReceiptSetting(
                                        "deliveryFees",
                                        newFees,
                                      );
                                    }}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white uppercase"
                                  />
                                </div>
                                <div className="flex-shrink-0 space-y-1">
                                  <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-none">
                                    Fee (£)
                                  </label>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={rule.fee || ""}
                                      onFocus={(e) => e.target.select()}
                                      onChange={(e) => {
                                        const newFees = [
                                          ...receiptSettings.deliveryFees,
                                        ];
                                        newFees[idx] = {
                                          ...newFees[idx],
                                          fee:
                                            e.target.value === ""
                                              ? 0
                                              : Number(e.target.value),
                                        };
                                        updateReceiptSetting(
                                          "deliveryFees",
                                          newFees,
                                        );
                                      }}
                                      className="w-20 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-orange-500 transition-all font-bold text-white text-right"
                                    />
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    const newFees =
                                      receiptSettings.deliveryFees.filter(
                                        (_, i) => i !== idx,
                                      );
                                    updateReceiptSetting(
                                      "deliveryFees",
                                      newFees,
                                    );
                                  }}
                                  className="p-2 text-gray-500 hover:text-red-500 transition-colors mt-4"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ),
                        )}
                        <button
                          onClick={() => {
                            const newFees = [
                              ...(receiptSettings.deliveryFees || []),
                              { postcode: "", fee: 0 },
                            ];
                            updateReceiptSetting("deliveryFees", newFees);
                          }}
                          className="p-4 bg-dashed border-2 border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-2 text-gray-500 hover:text-orange-500 hover:border-orange-500/30 transition-all group"
                        >
                          <Plus size={20} />
                          <span className="text-sm font-bold uppercase tracking-widest">
                            Add Postcode Rule
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 pt-10 border-t border-white/5">
                    <div className="space-y-2">
                      <h4 className="text-xl font-black text-white uppercase tracking-tighter italic leading-none">
                        Visual Visibility
                      </h4>
                      <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">
                        Toggle sections on or off
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[
                        {
                          id: "showOnPremiseNumber",
                          label: "Premise ID",
                          desc: "Table/Room",
                        },
                        {
                          id: "showContactDetails",
                          label: "Store Address",
                          desc: "Brand info",
                        },
                        {
                          id: "showTime",
                          label: "Order Timing",
                          desc: "Type & Slot",
                        },
                        {
                          id: "showItems",
                          label: "Items List",
                          desc: "Dishes data",
                        },
                        {
                          id: "showPaymentMethod",
                          label: "Payment Method",
                          desc: "Cash/Card",
                        },
                        {
                          id: "showClientInfo",
                          label: "Customer Name",
                          desc: "ID data",
                        },
                        {
                          id: "showDirection",
                          label: "Address Info",
                          desc: "For Delivery",
                        },
                        {
                          id: "showClientComment",
                          label: "Order Notes",
                          desc: "Comments",
                        },
                        {
                          id: "showOrderDetails",
                          label: "Bill Totals",
                          desc: "Math data",
                        },
                        {
                          id: "allowCashOrders",
                          label: "Accept Cash",
                          desc: "Cash Payment",
                        },
                      ].map((opt) => (
                        <div
                          key={opt.id}
                          className="group cursor-pointer p-4 bg-white/[0.04] border border-white/5 rounded-[1.5rem] hover:border-orange-500/40 hover:bg-orange-600/5 transition-all flex items-center justify-between gap-3"
                          onClick={() =>
                            updateReceiptSetting(
                              opt.id as any,
                              !receiptSettings[opt.id as any],
                            )
                          }
                        >
                          <div className="min-w-0">
                            <span
                              className={cn(
                                "text-[10px] font-black uppercase tracking-tight block truncate",
                                receiptSettings[opt.id as any]
                                  ? "text-white"
                                  : "text-gray-500",
                              )}
                            >
                              {opt.label}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "w-8 h-4 rounded-full p-0.5 transition-all relative shrink-0",
                              receiptSettings[opt.id as any]
                                ? "bg-orange-600"
                                : "bg-white/10",
                            )}
                          >
                            <motion.div
                              className="w-3 h-3 bg-white rounded-full transition-all"
                              animate={{
                                x: receiptSettings[opt.id as any] ? 16 : 0,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cloudflare Gmail Worker & Email Notification System */}
                  <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 md:col-span-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h4 className="text-lg font-black uppercase tracking-tighter text-white font-black italic flex items-center gap-2">
                          <Mail className="text-orange-500" size={22} />
                          <span className="text-orange-500">Gmail Worker</span> & Notification Delivery
                        </h4>
                        <p className="text-xs text-gray-400 mt-1">
                          Server-to-server Gmail API delivery via Cloudflare Worker with HTML MIME templates & Firestore duplicate prevention.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={fetchEmailStatus}
                          className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all text-xs font-bold flex items-center gap-1.5"
                          title="Refresh status"
                        >
                          <RefreshCw size={14} />
                          Refresh Status
                        </button>
                      </div>
                    </div>

                    {/* OAuth Authorization Banner */}
                    <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={22} className="text-amber-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h5 className="text-sm font-black text-amber-300 uppercase tracking-wide flex items-center gap-2">
                            <span>Gmail Worker OAuth Setup</span>
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                              emailStatus?.cloudflareWorker?.oauthAuthorized
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            )}>
                              {emailStatus?.cloudflareWorker?.oauthAuthorized ? "Authorized" : "Action Required"}
                            </span>
                          </h5>
                          <p className="text-xs text-amber-200/80 leading-relaxed">
                            {emailStatus?.cloudflareWorker?.oauthAuthorized
                              ? "Cloudflare Worker is successfully connected to Gmail API with stored OAuth refresh tokens."
                              : "To send customer notification emails directly through the Gmail API via Cloudflare Worker, click Authorize once to grant permissions for mughaldynastyrestaurant@gmail.com. Emails deliver via verified Gmail SMTP while authorization is pending."}
                          </p>
                        </div>
                      </div>
                      <a
                        href={emailStatus?.cloudflareWorker?.oauthLoginUrl || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev/oauth/login"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 shadow-lg shadow-orange-600/20 shrink-0 transition-all hover:scale-[1.02]"
                      >
                        <ExternalLink size={15} />
                        Authorize Gmail with Worker
                      </a>
                    </div>

                    {/* Status Badges */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="p-4 bg-black/30 border border-white/5 rounded-2xl">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                          Active Provider
                        </span>
                        <span className="text-sm font-black text-emerald-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          {emailStatus?.activeProvider === "cloudflare-worker"
                            ? "Cloudflare Gmail API"
                            : emailStatus?.activeProvider === "smtp"
                            ? "SMTP Server (Gmail)"
                            : (emailStatus?.activeProvider || "Cloudflare / SMTP")}
                        </span>
                      </div>

                      <div className="p-4 bg-black/30 border border-white/5 rounded-2xl">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                          Worker Secret Bound
                        </span>
                        <span className={cn(
                          "text-sm font-black flex items-center gap-1.5",
                          emailStatus?.cloudflareWorker?.secretConfigured ? "text-emerald-400" : "text-amber-400"
                        )}>
                          {emailStatus?.cloudflareWorker?.secretConfigured ? "Configured (Active)" : "Pending Secret Key"}
                        </span>
                      </div>

                      <div className="p-4 bg-black/30 border border-white/5 rounded-2xl">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                          Duplicate Prevention
                        </span>
                        <span className="text-sm font-black text-blue-400 flex items-center gap-1.5">
                          Firestore Idempotency Active
                        </span>
                      </div>
                    </div>

                    {/* Live Test Console */}
                    <div className="p-6 bg-black/40 border border-orange-500/20 rounded-2xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-black uppercase tracking-widest text-orange-400 flex items-center gap-2">
                          Send Safe Test Notification (Phase 7 Verification)
                        </h5>
                        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                          Does not modify live customer orders
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-4 space-y-1.5">
                          <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                            Template To Verify
                          </label>
                          <select
                            value={testTemplateType}
                            onChange={(e: any) => setTestTemplateType(e.target.value)}
                            className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-xs font-bold text-white focus:outline-none focus:border-orange-500"
                          >
                            <option value="order-confirmation">1. Order Accepted (Customer Confirmation)</option>
                            <option value="reservation-confirmation">2. Table Reservation Confirmed</option>
                            <option value="collection-ready">3. Collection Order Ready</option>
                            <option value="delivery-on-the-way">4. Delivery Order On The Way</option>
                          </select>
                        </div>

                        <div className="md:col-span-3 space-y-1.5">
                          <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                            Destination Email
                          </label>
                          <input
                            type="email"
                            value={testEmailAddress}
                            onChange={(e) => setTestEmailAddress(e.target.value)}
                            placeholder="mughaldynastyrestaurant@gmail.com"
                            className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-xs font-bold text-white focus:outline-none focus:border-orange-500"
                          />
                        </div>

                        <div className="md:col-span-2 space-y-1.5">
                          <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                            Provider
                          </label>
                          <select
                            value={testProvider}
                            onChange={(e: any) => setTestProvider(e.target.value)}
                            className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-3 text-xs font-bold text-white focus:outline-none focus:border-orange-500"
                          >
                            <option value="auto">Auto (Worker + Backup)</option>
                            <option value="cloudflare">Cloudflare Only</option>
                            <option value="smtp">SMTP Backup</option>
                          </select>
                        </div>

                        <div className="md:col-span-3">
                          <button
                            onClick={handleSendTestEmail}
                            disabled={isSendingTestEmail}
                            className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-600/30"
                          >
                            {isSendingTestEmail ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Sending...
                              </>
                            ) : (
                              <>
                                <Send size={14} />
                                Send Test Email
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {testEmailResult && (
                        <div className={cn(
                          "p-4 rounded-xl border text-xs font-bold flex flex-col gap-2 mt-3",
                          testEmailResult.success
                            ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                            : "bg-red-950/40 border-red-500/40 text-red-300"
                        )}>
                          <div className="flex items-start gap-3">
                            <div className="shrink-0 mt-0.5">
                              {testEmailResult.success ? <Check size={16} className="text-emerald-400" /> : <AlertCircle size={16} className="text-red-400" />}
                            </div>
                            <div className="space-y-1 flex-1">
                              <div>
                                {testEmailResult.success
                                  ? `Live Test Email Sent Successfully via ${testEmailResult.provider || "provider"}!`
                                  : `Dispatch Notice: ${testEmailResult.error}`}
                              </div>
                              {testEmailResult.note && (
                                <div className="text-[11px] text-gray-300 font-normal">
                                  {testEmailResult.note}
                                </div>
                              )}
                              {testEmailResult.messageId && (
                                <div className="text-[11px] text-gray-400 font-mono">
                                  Message ID: {testEmailResult.messageId} | Subject: {testEmailResult.subject}
                                </div>
                              )}
                            </div>
                          </div>

                          {(testEmailResult.oauthRequired || testEmailResult.oauthLoginUrl) && (
                            <div className="mt-2 pt-3 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-black/20 p-3 rounded-lg">
                              <span className="text-[11px] text-amber-300">
                                Cloudflare Worker requires one-time Google OAuth authorization:
                              </span>
                              <a
                                href={testEmailResult.oauthLoginUrl || "https://mughal-resend-worker.mughaldynastyrestaurant.workers.dev/oauth/login"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-black font-black text-xs uppercase tracking-wider rounded-lg flex items-center gap-1.5 shadow transition-all shrink-0"
                              >
                                <ExternalLink size={13} />
                                Authorize Gmail Now
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : activeTab === "orders" ? (
            <motion.div
              key="orders"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Daily Summary Section */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
                {[
                  {
                    label: "Total Orders",
                    icon: <ReceiptText size={14} className="text-orange-400" />,
                    value: orders.filter((o) => {
                      const isNotCancelled = o.status !== "cancelled";
                      const createdAt = o.createdAt?.toDate();
                      const acceptedAt = o.acceptedAt?.toDate();
                      const startOfToday = new Date();
                      startOfToday.setHours(0, 0, 0, 0);
                      
                      // Count if created today OR accepted today (covers pre-orders from yesterday accepted today)
                      const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                      return isNotCancelled && isToday;
                    }).length,
                    total: orders
                      .filter((o) => {
                        const isNotCancelled = o.status !== "cancelled";
                        const createdAt = o.createdAt?.toDate();
                        const acceptedAt = o.acceptedAt?.toDate();
                        const startOfToday = new Date();
                        startOfToday.setHours(0, 0, 0, 0);
                        const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                        return isNotCancelled && isToday;
                      })
                      .reduce((sum, o) => sum + o.total, 0),
                    color: "orange",
                  },
                  {
                    label: "Online Paid",
                    icon: <CreditCard size={14} className="text-emerald-400" />,
                    value: orders.filter((o) => {
                      const isMatch = o.paymentMethod === "pay_online" && o.status !== "cancelled";
                      const createdAt = o.createdAt?.toDate();
                      const acceptedAt = o.acceptedAt?.toDate();
                      const startOfToday = new Date();
                      startOfToday.setHours(0, 0, 0, 0);
                      const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                      return isMatch && isToday;
                    }).length,
                    total: orders
                      .filter((o) => {
                        const isMatch = o.paymentMethod === "pay_online" && o.status !== "cancelled";
                        const createdAt = o.createdAt?.toDate();
                        const acceptedAt = o.acceptedAt?.toDate();
                        const startOfToday = new Date();
                        startOfToday.setHours(0, 0, 0, 0);
                        const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                        return isMatch && isToday;
                      })
                      .reduce((sum, o) => sum + o.total, 0),
                    color: "green",
                  },
                  {
                    label: "Cash",
                    icon: <Banknote size={14} className="text-amber-400" />,
                    value: orders.filter((o) => {
                      const isMatch = o.paymentMethod === "cash" && o.status !== "cancelled";
                      const createdAt = o.createdAt?.toDate();
                      const acceptedAt = o.acceptedAt?.toDate();
                      const startOfToday = new Date();
                      startOfToday.setHours(0, 0, 0, 0);
                      const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                      return isMatch && isToday;
                    }).length,
                    total: orders
                      .filter((o) => {
                        const isMatch = o.paymentMethod === "cash" && o.status !== "cancelled";
                        const createdAt = o.createdAt?.toDate();
                        const acceptedAt = o.acceptedAt?.toDate();
                        const startOfToday = new Date();
                        startOfToday.setHours(0, 0, 0, 0);
                        const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                        return isMatch && isToday;
                      })
                      .reduce((sum, o) => sum + o.total, 0),
                    color: "amber",
                  },
                  {
                    label: "Card on Coll.",
                    icon: <Smartphone size={14} className="text-blue-400" />,
                    value: orders.filter((o) => {
                      const isMatch = o.paymentMethod === "card_on_collection" && o.status !== "cancelled";
                      const createdAt = o.createdAt?.toDate();
                      const acceptedAt = o.acceptedAt?.toDate();
                      const startOfToday = new Date();
                      startOfToday.setHours(0, 0, 0, 0);
                      const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                      return isMatch && isToday;
                    }).length,
                    total: orders
                      .filter((o) => {
                        const isMatch = o.paymentMethod === "card_on_collection" && o.status !== "cancelled";
                        const createdAt = o.createdAt?.toDate();
                        const acceptedAt = o.acceptedAt?.toDate();
                        const startOfToday = new Date();
                        startOfToday.setHours(0, 0, 0, 0);
                        const isToday = (createdAt && createdAt >= startOfToday) || (acceptedAt && acceptedAt >= startOfToday);
                        return isMatch && isToday;
                      })
                      .reduce((sum, o) => sum + o.total, 0),
                    color: "blue",
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className={cn(
                      "rounded-2xl p-3 sm:p-5 flex flex-col justify-between group transition-all relative overflow-hidden",
                      activeTab === "orders"
                        ? "bg-white border border-slate-200 hover:border-orange-500/50 shadow-sm"
                        : "bg-white/5 border border-white/10 hover:border-orange-500/30"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0 right-0 w-16 h-16 blur-3xl rounded-full -mr-8 -mt-8",
                      activeTab === "orders" ? "bg-slate-100" : "bg-white/5"
                    )} />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <div className="flex items-center gap-1.5">
                        {stat.icon}
                        <span className={cn(
                          "text-[10px] font-black uppercase tracking-widest",
                          activeTab === "orders" ? "text-slate-500" : "text-gray-400"
                        )}>
                          {stat.label}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          activeTab === "orders" ? "bg-slate-100 text-slate-800 border border-slate-200" : "text-white bg-white/10"
                        )}
                      >
                        {stat.value}
                      </span>
                    </div>
                    <div className={cn(
                      "text-xl sm:text-2xl font-black italic relative z-10 truncate",
                      activeTab === "orders" ? "text-slate-900" : "text-white"
                    )}>
                      {formatPrice(stat.total)}
                    </div>
                  </div>
                ))}
              </div>{" "}
              {orders.filter(o => {
                const createdAt = o.createdAt?.toDate();
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);
                return createdAt >= startOfToday || ["pending", "confirmed", "ready", "shipped"].includes(o.status);
              }).length === 0 ? (
                <div className="text-center py-20 bg-white/5 border border-white/10 rounded-3xl">
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock size={32} className="text-gray-600" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2 uppercase">
                    No orders today
                  </h3>
                  <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">
                    Waiting for the first customer of the day.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Sub-tab Switcher & Sync Toolbar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
                    <div className={cn(
                      "grid grid-cols-3 gap-2 p-1 bg-white/5 rounded-2xl border border-white/10 flex-1",
                      activeTab === "orders" && "bg-slate-200/80 border-slate-300/60"
                    )}>
                    {[
                      {
                        id: "incoming",
                        label: "Incoming",
                        color: "bg-yellow-500",
                        count: orders.filter((o) =>
                          ["pending", "confirmed"].includes(o.status),
                        ).length,
                      },
                      {
                        id: "transit",
                        label: "Processing",
                        color: "bg-orange-500",
                        count: orders.filter((o) =>
                          ["ready", "shipped"].includes(o.status),
                        ).length,
                      },
                      {
                        id: "completed",
                        label: "Completed",
                        color: "bg-green-500",
                        count: orders.filter((o) => {
                          const isMatch = ["delivered", "collected"].includes(o.status);
                          if (!isMatch) return false;
                          const startOfToday = new Date();
                          startOfToday.setHours(0, 0, 0, 0);
                          const orderDate = o.completedAt?.toDate() || o.createdAt?.toDate();
                          return orderDate && orderDate >= startOfToday;
                        }).length,
                      },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveOrderSubTab(tab.id as any)}
                        className={cn(
                          "flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all relative overflow-hidden group",
                          activeOrderSubTab === tab.id
                            ? activeTab === "orders"
                              ? "bg-white text-slate-900 shadow-md border border-slate-200"
                              : "bg-white/10 text-white shadow-lg"
                            : activeTab === "orders"
                              ? "text-slate-600 hover:text-slate-900 hover:bg-white/40"
                              : "text-gray-500 hover:text-gray-300 hover:bg-white/5",
                        )}
                      >
                        <span
                          className={cn(
                            "text-xl sm:text-2xl md:text-3xl font-black transition-all mb-0.5 shrink-0",
                            activeOrderSubTab === tab.id
                              ? activeTab === "orders"
                                ? "text-slate-900"
                                : "text-white"
                              : activeTab === "orders"
                                ? "text-slate-700"
                                : "text-gray-400",
                          )}
                        >
                          {tab.count}
                        </span>
                        <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                          <div
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              tab.color,
                              activeOrderSubTab === tab.id &&
                                "animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.5)]",
                            )}
                          />
                          <span className="text-[9px] sm:text-[11px] font-extrabold uppercase tracking-tight sm:tracking-wider truncate max-w-[55px] xs:max-w-none">
                            {tab.label}
                          </span>
                        </div>
                        {activeOrderSubTab === tab.id && (
                          <motion.div
                            layoutId="activeSubTab"
                            className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500"
                          />
                        )}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleSyncStripeOrders(true)}
                    disabled={isSyncingStripe}
                    title="Sync and recover any Apple Pay / Card payments from Stripe into Live Orders"
                    className={cn(
                      "flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-bold transition-all whitespace-nowrap shadow-sm border shrink-0",
                      activeTab === "orders"
                        ? "bg-white hover:bg-slate-50 text-slate-700 border-slate-300 hover:border-orange-400 active:scale-95"
                        : "bg-white/5 hover:bg-white/10 text-gray-300 border-white/10 hover:border-orange-500/40 active:scale-95"
                    )}
                  >
                    <RefreshCw size={14} className={cn("text-emerald-500", isSyncingStripe && "animate-spin text-orange-500")} />
                    <span>{isSyncingStripe ? "Checking Stripe..." : "Sync Stripe Orders"}</span>
                  </button>
                </div>

                  {/* Sub-tab Content */}
                  <div className="mt-6">
                    {activeOrderSubTab === "incoming" && (
                      <div className="space-y-4">
                        {orders
                          .filter((o) =>
                            ["pending", "confirmed"].includes(o.status),
                          )
                          .sort((a, b) => {
                            const timeA = getOrderTargetTimeMs(a, currentTime);
                            const timeB = getOrderTargetTimeMs(b, currentTime);
                            if (timeA !== timeB) return timeA - timeB; // Least remaining time first
                            const aCreated = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
                            const bCreated = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
                            return aCreated - bCreated;
                          })
                          .map((order) => renderOrderCard(order))}
                        {orders.filter((o) =>
                          ["pending", "confirmed"].includes(o.status),
                        ).length === 0 && (
                          <div className={cn(
                            "text-center py-20 rounded-3xl text-sm text-gray-600 font-bold uppercase tracking-widest border border-dashed",
                            activeTab === "orders" ? "bg-white border-slate-300" : "bg-white/2 border-white/5"
                          )}>
                            No incoming orders at the moment
                          </div>
                        )}
                      </div>
                    )}

                    {activeOrderSubTab === "transit" && (
                      <div className="space-y-4">
                        {orders
                          .filter((o) =>
                            ["ready", "shipped"].includes(o.status),
                          )
                          .sort((a, b) => {
                            const timeA = getOrderTargetTimeMs(a, currentTime);
                            const timeB = getOrderTargetTimeMs(b, currentTime);
                            if (timeA !== timeB) return timeA - timeB;
                            const aCreated = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
                            const bCreated = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
                            return aCreated - bCreated;
                          })
                          .map((order) => renderOrderCard(order))}
                        {orders.filter((o) =>
                          ["ready", "shipped"].includes(o.status),
                        ).length === 0 && (
                          <div className={cn(
                            "text-center py-20 rounded-3xl text-sm text-gray-600 font-bold uppercase tracking-widest border border-dashed",
                            activeTab === "orders" ? "bg-white border-slate-300" : "bg-white/2 border-white/5"
                          )}>
                            No orders currently in processing or ready
                          </div>
                        )}
                      </div>
                    )}

                    {activeOrderSubTab === "completed" && (
                      <div className="space-y-4">
                        {orders
                          .filter((o) => {
                            const isCompletedStatus = ["delivered", "collected"].includes(o.status);
                            if (!isCompletedStatus) return false;
                            
                            // Only show completed orders from today in this tab
                            const dateToCheck = o.completedAt?.toDate() || o.createdAt?.toDate();
                            const startOfToday = new Date();
                            startOfToday.setHours(0, 0, 0, 0);
                            return dateToCheck && dateToCheck >= startOfToday;
                          })
                          .map((order) => renderOrderCard(order, true))}
                        {orders.filter((o) => {
                          const isCompletedStatus = ["delivered", "collected"].includes(o.status);
                          if (!isCompletedStatus) return false;
                          const dateToCheck = o.completedAt?.toDate() || o.createdAt?.toDate();
                          const startOfToday = new Date();
                          startOfToday.setHours(0, 0, 0, 0);
                          return dateToCheck && dateToCheck >= startOfToday;
                        }).length === 0 && (
                          <div className={cn(
                            "text-center py-20 rounded-3xl text-sm text-gray-600 font-bold uppercase tracking-widest border border-dashed",
                            activeTab === "orders" ? "bg-white border-slate-300" : "bg-white/2 border-white/5"
                          )}>
                            No orders completed yet today
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ) : activeTab === "history" ? (
            (() => {
              const successfulOrders = historyOrders.filter((o) => o.status !== "cancelled");
            const totalCount = historyOrders.length;
            const successfulCount = successfulOrders.length;
            const cancelledCount = historyOrders.filter((o) => o.status === "cancelled").length;

            const cashOrders = successfulOrders.filter((o) => o.paymentMethod === "cash" || !o.paymentMethod);
            const cashCount = cashOrders.length;
            const cashSum = cashOrders.reduce((sum, o) => sum + o.total, 0);

            const cardOrders = successfulOrders.filter((o) => o.paymentMethod === "card");
            const cardCount = cardOrders.length;
            const cardSum = cardOrders.reduce((sum, o) => sum + o.total, 0);

            const onlineOrders = successfulOrders.filter((o) => o.paymentMethod === "pay_online");
            const onlineCount = onlineOrders.length;
            const onlineSum = onlineOrders.reduce((sum, o) => sum + o.total, 0);

            const cardOnCollectionOrders = successfulOrders.filter((o) => o.paymentMethod === "card_on_collection");
            const cardOnCollectionCount = cardOnCollectionOrders.length;
            const cardOnCollectionSum = cardOnCollectionOrders.reduce((sum, o) => sum + o.total, 0);

            const totalSum = successfulOrders.reduce((sum, o) => sum + o.total, 0);

            const setPresetRange = (preset: "today" | "yesterday" | "past7" | "thisWeek" | "thisMonth") => {
              const today = new Date();
              const start = new Date();
              const end = new Date();

              if (preset === "today") {
                // start and end already today
              } else if (preset === "yesterday") {
                start.setDate(today.getDate() - 1);
                end.setDate(today.getDate() - 1);
              } else if (preset === "past7") {
                start.setDate(today.getDate() - 7);
              } else if (preset === "thisWeek") {
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                start.setDate(diff);
              } else if (preset === "thisMonth") {
                start.setDate(1);
              }

              setStartDate(start.toISOString().split("T")[0]);
              setEndDate(end.toISOString().split("T")[0]);
            };

            const handlePrintSummary = () => {
              const encoder = new EscPosEncoder();
              const PRINTER_WIDTH = 48;
              const dashedSeparator = "-".repeat(PRINTER_WIDTH);

              const formatRow = (left: string, right: string, width: number = PRINTER_WIDTH): string => {
                const spaces = width - left.length - right.length;
                return left + " ".repeat(Math.max(1, spaces)) + right;
              };

              // Compute delivery and collection order metrics
              const deliveryOrders = successfulOrders.filter(o => o.type === "delivery");
              const deliveryCount = deliveryOrders.length;
              const deliverySum = deliveryOrders.reduce((sum, o) => sum + o.total, 0);

              const collectionOrders = successfulOrders.filter(o => o.type === "collection");
              const collectionCount = collectionOrders.length;
              const collectionSum = collectionOrders.reduce((sum, o) => sum + o.total, 0);

              encoder.initialize().align("center");
              encoder.size(2, 2).bold(true).line("MUGHAL DYNASTY").size(1, 1).bold(false);
              encoder.line("17 High Street, Raunds NN9 6HS");
              encoder.line("Phone: 01933 626351");
              encoder.feed(1);
              encoder.bold(true).line("BUSINESS INVOICE SUMMARY").bold(false);
              encoder.line(`Period: ${startDate} to ${endDate}`);
              encoder.line(`Generated At: ${new Date().toLocaleString()}`);
              encoder.line(dashedSeparator);

              encoder.align("left");
              encoder.bold(true).line(formatRow("Payment Method", "Orders     Amount", PRINTER_WIDTH)).bold(false);
              encoder.line(dashedSeparator);

              encoder.line(formatRow("Cash Paid", `${cashCount}     £${cashSum.toFixed(2)}`));
              encoder.line(formatRow("Card Payments", `${cardCount}     £${cardSum.toFixed(2)}`));
              encoder.line(formatRow("Online Paid", `${onlineCount}     £${onlineSum.toFixed(2)}`));
              encoder.line(formatRow("Card on Collection", `${cardOnCollectionCount}     £${cardOnCollectionSum.toFixed(2)}`));
              encoder.line(dashedSeparator);
              
              encoder.bold(true).line(formatRow("TOTAL REVENUE", `${successfulCount}     £${totalSum.toFixed(2)}`)).bold(false);
              encoder.line(dashedSeparator);

              // Delivery and Collection breakdown (user requested)
              encoder.bold(true).line("ORDER TYPE BREAKDOWN").bold(false);
              encoder.line(formatRow("Delivery Orders", `${deliveryCount}     £${deliverySum.toFixed(2)}`));
              encoder.line(formatRow("Collection Orders", `${collectionCount}     £${collectionSum.toFixed(2)}`));
              encoder.line(dashedSeparator);

              encoder.line(`Total Orders (incl. Cancelled): ${totalCount}`);
              encoder.line(`Cancelled Orders: ${cancelledCount}`);
              encoder.line(dashedSeparator);

              encoder.align("center").italic(true).line("© 2026 Mughal Dynasty");
              encoder.line("Confidential Business Report");
              
              encoder.feed(3).cut();

              const bytes = encoder.encode();
              
              const toBase64 = (data: Uint8Array) => {
                let binary = "";
                for (let i = 0; i < data.byteLength; i++) {
                  binary += String.fromCharCode(data[i]);
                }
                return window.btoa(binary);
              };

              const toastId = toast.loading("Printing summary through RawBT...");
              try {
                const b64 = toBase64(bytes);
                window.location.href = `rawbt:base64,${b64}`;
                toast.success("Printed successfully", { id: toastId });
              } catch (err) {
                console.error("Print failed:", err);
                toast.error("Print failed. Ensure RawBT app is installed.", { id: toastId });
              }
            };

            return (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Date range selector and presets */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-orange-500 mb-1">Invoice Range Settings</h4>
                      <p className="text-sm text-gray-400">Choose custom date range or select a preset below to generate the business summary.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["today", "yesterday", "past7", "thisWeek", "thisMonth"] as const).map((preset) => {
                        const labels = {
                          today: "Today",
                          yesterday: "Yesterday",
                          past7: "Last 7 Days",
                          thisWeek: "This Week",
                          thisMonth: "This Month"
                        };
                        return (
                          <button
                            key={preset}
                            onClick={() => setPresetRange(preset)}
                            className="px-3 py-1.5 bg-white/5 hover:bg-orange-600/20 hover:text-orange-500 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer text-white"
                          >
                            {labels[preset]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end pt-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                      />
                    </div>
                    <div className="md:col-span-2 flex gap-3">
                      <button
                        onClick={handlePrintSummary}
                        className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-orange-600/20"
                      >
                        <ReceiptText size={16} />
                        Print Invoice Summary
                      </button>
                      <button
                        onClick={handleDeleteAllOrders}
                        disabled={isResettingOrders}
                        className={cn(
                          "px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                          isResettingOrders
                            ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                            : showResetConfirm
                            ? "bg-red-600 text-white animate-pulse"
                            : "bg-red-600/15 text-red-500 border border-red-500/20 hover:bg-red-600 hover:text-white"
                        )}
                      >
                        {isResettingOrders ? "Resetting..." : showResetConfirm ? "Confirm Reset?" : "Reset Orders"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Business summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {/* Card 1: Total Revenue */}
                  <div className="bg-gradient-to-br from-orange-600/20 to-orange-800/10 border border-orange-500/30 rounded-2xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/10 blur-2xl rounded-full" />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <span className="text-[10px] font-black uppercase tracking-widest text-orange-400">Total Business</span>
                      <span className="text-[10px] font-bold text-orange-200 bg-orange-500/20 px-2 py-0.5 rounded-full">
                        {successfulCount} orders
                      </span>
                    </div>
                    <p className="text-2xl font-black text-white italic tracking-tight">{formatPrice(totalSum)}</p>
                    <div className="mt-2 text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                      Cancelled: {cancelledCount}
                    </div>
                  </div>

                  {/* Card 2: Cash paid */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-orange-500/20 transition-all">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl rounded-full" />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <div className="flex items-center gap-1">
                        <Banknote size={14} className="text-amber-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Cash paid</span>
                      </div>
                      <span className="text-[10px] font-bold text-white bg-white/10 px-2 py-0.5 rounded-full">
                        {cashCount}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-white italic tracking-tight">{formatPrice(cashSum)}</p>
                    <div className="mt-2 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Invoices paid cash
                    </div>
                  </div>

                  {/* Card 3: Card */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-orange-500/20 transition-all">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl rounded-full" />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <div className="flex items-center gap-1">
                        <CreditCard size={14} className="text-blue-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Card</span>
                      </div>
                      <span className="text-[10px] font-bold text-white bg-white/10 px-2 py-0.5 rounded-full">
                        {cardCount}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-white italic tracking-tight">{formatPrice(cardSum)}</p>
                    <div className="mt-2 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Card transactions
                    </div>
                  </div>

                  {/* Card 4: Online Paid */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-orange-500/20 transition-all">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl rounded-full" />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <div className="flex items-center gap-1">
                        <CreditCard size={14} className="text-emerald-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Online Paid</span>
                      </div>
                      <span className="text-[10px] font-bold text-white bg-white/10 px-2 py-0.5 rounded-full">
                        {onlineCount}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-white italic tracking-tight">{formatPrice(onlineSum)}</p>
                    <div className="mt-2 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Stripe checkout
                    </div>
                  </div>

                  {/* Card 5: Card on Collection */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-orange-500/20 transition-all">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl rounded-full" />
                    <div className="flex justify-between items-start mb-2 relative z-10">
                      <div className="flex items-center gap-1">
                        <Smartphone size={14} className="text-purple-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Card on Coll.</span>
                      </div>
                      <span className="text-[10px] font-bold text-white bg-white/10 px-2 py-0.5 rounded-full">
                        {cardOnCollectionCount}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-white italic tracking-tight">{formatPrice(cardOnCollectionSum)}</p>
                    <div className="mt-2 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                      Collection terminal
                    </div>
                  </div>
                </div>

                {historyOrders.length === 0 ? (
                  <div className="text-center py-20 bg-white/5 border border-white/10 rounded-3xl">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                      <History size={32} className="text-gray-600" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2 uppercase">
                      No Records Found
                    </h3>
                    <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">
                      Try selecting a different date range.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-widest text-gray-400">Invoice Ledger - Detailed Orders</h4>
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                        Showing {historyOrders.length} records
                      </span>
                    </div>
                    {historyOrders.map((order) => (
                      <div
                        key={order.id}
                        className="bg-white/5 border border-white/10 rounded-2xl p-6 opacity-90 hover:opacity-100 transition-all"
                      >
                        <div className="flex flex-col md:flex-row justify-between gap-6">
                          <div className="space-y-4 flex-1">
                            <div className="flex flex-wrap items-center gap-4">
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                                {formatOrderId(order.id)}
                              </span>
                              <span
                                className={cn(
                                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1",
                                  order.status === "cancelled" &&
                                    "bg-red-500/10 text-red-500",
                                  order.status !== "cancelled" &&
                                    order.paymentMethod === "pay_online" &&
                                    "bg-green-500/10 text-green-500",
                                  order.status !== "cancelled" &&
                                    order.paymentMethod === "card_on_collection" &&
                                    "bg-blue-500/10 text-blue-500",
                                  order.status !== "cancelled" &&
                                    (order.paymentMethod === "cash" ||
                                      !order.paymentMethod) &&
                                    "bg-yellow-500/10 text-yellow-500",
                                )}
                              >
                                {order.status === "cancelled"
                                  ? "CANCELLED"
                                  : order.paymentMethod === "pay_online"
                                    ? "PAID"
                                    : order.paymentMethod === "card_on_collection"
                                      ? "CARD"
                                      : "CASH"}
                              </span>
                              <span className="text-xs font-medium text-gray-400">
                                {order.createdAt?.toDate().toLocaleString()}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                              <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                                  Customer Info
                                </h4>
                                <p className="text-sm font-bold">
                                  {order.customerName || "No Name"}
                                </p>
                                <p className="text-sm font-medium text-gray-400 mt-1">
                                  {order.phone}
                                </p>
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-[10px] font-bold bg-white/10 px-2 py-0.5 rounded uppercase tracking-widest">
                                    {order.type}
                                  </span>
                                </div>
                                {order.address && (
                                  <p className="text-sm text-gray-400 mt-2 border-t border-white/5 pt-2">
                                    {order.address}
                                  </p>
                                )}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                                  Order Items
                                </h4>
                                <ul className="space-y-1">
                                  {order.items.map((item: any, i: number) => (
                                    <li
                                      key={i}
                                      className="text-sm text-gray-300 flex flex-col mb-1 capitalize"
                                    >
                                      <span className="font-bold">
                                        <span className="text-orange-500 mr-1">
                                          {item.quantity}x
                                        </span>
                                        {item.name}
                                      </span>
                                      {item.variant && (
                                        <span className="text-[10px] text-orange-500 font-bold ml-6">
                                          + {item.variant}
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-4 pt-3 border-t border-white/5 space-y-1">
                                  <div className="flex justify-between items-center text-lg font-black text-orange-500 pt-1">
                                    <span>Total:</span>
                                    <span>{formatPrice(order.total)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-3 justify-center border-l border-white/5 pl-6">
                            <button
                              onClick={() => handlePrint(order)}
                              className="flex items-center justify-center gap-2 px-4 py-2 bg-white/5 text-white rounded-lg text-xs font-bold hover:bg-white/10 transition-all w-full text-white cursor-pointer"
                            >
                              <Printer size={14} />
                              PRINT REPRINT
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })()
          ) : activeTab === "traditional" ? (
            <motion.div
              key="traditional"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                <h3 className="text-xl font-bold flex items-center gap-2 mb-6 uppercase italic tracking-tighter">
                  <Plus size={20} className="text-orange-500" />
                  {isEditingMeat ? "EDIT MEAT OPTION" : "ADD NEW MEAT OPTION"}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      Meat Name (e.g. Lamb, King Prawn)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Mixed Meat"
                      value={newMeatOption.name}
                      onChange={(e) =>
                        setNewMeatOption({
                          ...newMeatOption,
                          name: e.target.value,
                        })
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      Extra Price (£)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={
                        newMeatOption.extra === 0 ? "" : newMeatOption.extra
                      }
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        setNewMeatOption({
                          ...newMeatOption,
                          extra: Number(e.target.value),
                        })
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-4 mt-6">
                  <button
                    onClick={handleAddMeatOption}
                    className="flex-1 px-8 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold transition-all uppercase tracking-widest"
                  >
                    {isEditingMeat ? "UPDATE OPTION" : "ADD MEAT OPTION"}
                  </button>
                  {isEditingMeat && (
                    <button
                      onClick={() => {
                        setIsEditingMeat(null);
                        setNewMeatOption({ name: "", extra: 0 });
                      }}
                      className="px-8 py-3 bg-white/5 text-white rounded-xl font-bold border border-white/10 hover:bg-white/10 transition-all"
                    >
                      CANCEL
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {meatOptions.map((meat, index) => (
                  <div
                    key={meat.id}
                    className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 flex flex-col gap-4 group hover:border-orange-500/30 transition-all shadow-xl"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-black text-xl italic uppercase tracking-tighter">
                        {meat.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMoveMeatOption(meat.id, "up")}
                          disabled={index === 0}
                          className="p-2 bg-white/5 hover:bg-orange-500/20 text-gray-400 hover:text-orange-500 disabled:opacity-0 rounded-lg transition-all"
                        >
                          <ChevronRight className="-rotate-90" size={16} />
                        </button>
                        <button
                          onClick={() => handleMoveMeatOption(meat.id, "down")}
                          disabled={index === meatOptions.length - 1}
                          className="p-2 bg-white/5 hover:bg-orange-500/20 text-gray-400 hover:text-orange-500 disabled:opacity-0 rounded-lg transition-all"
                        >
                          <ChevronRight className="rotate-90" size={16} />
                        </button>
                        <button
                          onClick={() => startEditingMeat(meat)}
                          className="p-2 bg-white/5 hover:bg-blue-500/20 text-gray-400 hover:text-blue-500 rounded-lg transition-all"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteMeatOption(meat.id)}
                          className="p-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-500 rounded-lg transition-all"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Clock size={12} />
                        Extra: +{formatPrice(meat.extra)}
                      </div>
                      <div className="text-orange-500">Option #{index + 1}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : activeTab === "categories" ? (
            <motion.div
              key="categories"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                <h3 className="text-xl font-bold flex items-center gap-2 mb-6">
                  <Plus size={20} className="text-orange-500" />
                  ADD NEW CATEGORY
                </h3>
                <div className="flex gap-4">
                  <input
                    type="text"
                    placeholder="Category Name (e.g. Starters)"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                  />
                  <button
                    onClick={handleAddCategory}
                    className="px-8 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold transition-all"
                  >
                    ADD CATEGORY
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map((cat, index) => (
                  <div
                    key={cat.id}
                    className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 flex flex-col gap-4 group hover:border-orange-500/30 transition-all shadow-xl"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-black text-xl italic uppercase tracking-tighter">
                        {cat.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMoveCategory(cat.id, "up")}
                          disabled={index === 0}
                          className="p-2 bg-white/5 hover:bg-orange-500/20 text-gray-400 hover:text-orange-500 disabled:opacity-0 rounded-lg transition-all"
                          title="Move Up"
                        >
                          <ChevronRight className="-rotate-90" size={16} />
                        </button>
                        <button
                          onClick={() => handleMoveCategory(cat.id, "down")}
                          disabled={index === categories.length - 1}
                          className="p-2 bg-white/5 hover:bg-orange-500/20 text-gray-400 hover:text-orange-500 disabled:opacity-0 rounded-lg transition-all"
                          title="Move Down"
                        >
                          <ChevronRight className="rotate-90" size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat.id)}
                          className="p-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-500 rounded-lg transition-all"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      <LayoutGrid size={12} />
                      Position: {cat.order + 1}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Plus size={20} className="text-orange-500" />
                    {isEditing ? "EDIT MENU ITEM" : "ADD NEW MENU ITEM"}
                  </h3>

                  <div className="w-full md:w-96 group">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-black mb-2 block flex items-center gap-2">
                      <Search size={10} />
                      Quick Selection to Edit
                    </label>
                    <div className="relative">
                      <select
                        onChange={(e) => {
                          const item = menuItems.find(
                            (i) => i.id === e.target.value,
                          );
                          if (item) startEditing(item);
                        }}
                        value={isEditing || ""}
                        className="w-full bg-[#1a1a1a] border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:border-orange-500 transition-all appearance-none cursor-pointer hover:bg-[#222] shadow-2xl"
                      >
                        <option value="" className="bg-[#0f0f0f]">
                          SEARCH FOR DISH...
                        </option>
                        {categories.map((cat) => (
                          <optgroup
                            key={cat.id}
                            label={cat.name.toUpperCase()}
                            className="bg-[#0f0f0f] text-gray-500 py-2"
                          >
                            {menuItems
                              .filter((i) => i.category === cat.name)
                              .map((item) => (
                                <option
                                  key={item.id}
                                  value={item.id}
                                  className="bg-[#0f0f0f] text-white"
                                >
                                  {item.name.toUpperCase()} -{" "}
                                  {formatPrice(item.price)}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-focus-within:text-orange-500 transition-colors">
                        <ChevronDown size={18} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      Name
                    </label>
                    <input
                      type="text"
                      value={newItem.name}
                      onChange={(e) =>
                        setNewItem({ ...newItem, name: e.target.value })
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      Price (£)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newItem.price === 0 ? "" : newItem.price}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setNewItem({ ...newItem, price: isNaN(val) ? 0 : val });
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                  <div className="space-y-4 group relative">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-black mb-1 block">
                      Category Selection
                    </label>
                    <div className="relative group">
                      <select
                        value={newItem.category}
                        onChange={(e) =>
                          setNewItem({ ...newItem, category: e.target.value })
                        }
                        className="w-full bg-[#1a1a1a] border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold focus:outline-none focus:border-orange-500 transition-all appearance-none cursor-pointer hover:bg-[#222] shadow-xl group-hover:border-white/30"
                      >
                        <option value="" disabled className="bg-[#0f0f0f]">
                          SELECT CATEGORY...
                        </option>
                        {categories.map((cat) => (
                          <option
                            key={cat.id}
                            value={cat.name}
                            className="bg-[#0f0f0f]"
                          >
                            {cat.name.toUpperCase()}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-focus-within:text-orange-500 transition-colors">
                        <ChevronDown size={18} />
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-600 font-bold uppercase tracking-widest pl-2">
                      Tip: Choose the best department for this dish
                    </div>
                  </div>
                  <div className="space-y-2 flex flex-col justify-end">
                    <button
                      onClick={() =>
                        setNewItem({
                          ...newItem,
                          isTraditional: !newItem.isTraditional,
                        })
                      }
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all h-[46px]",
                        newItem.isTraditional
                          ? "bg-orange-600/10 border-orange-500 text-orange-500"
                          : "bg-white/5 border-white/10 text-gray-500",
                      )}
                    >
                      {newItem.isTraditional
                        ? "✓ TRADITIONAL DISH"
                        : "SET AS TRADITIONAL"}
                    </button>
                  </div>
                  <div className="md:col-span-3 space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                      Description
                    </label>
                    <input
                      type="text"
                      value={newItem.description}
                      onChange={(e) =>
                        setNewItem({ ...newItem, description: e.target.value })
                      }
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-4 mt-8">
                  <button
                    onClick={handleAddMenuItem}
                    className="flex-1 px-8 py-4 bg-white text-black rounded-xl font-bold hover:bg-orange-500 hover:text-white transition-all"
                  >
                    {isEditing ? "UPDATE ITEM" : "SAVE ITEM"}
                  </button>
                  {isEditing && (
                    <button
                      onClick={cancelEditing}
                      className="px-8 py-4 bg-white/5 border border-white/10 text-white rounded-xl font-bold hover:bg-white/10 transition-all"
                    >
                      CANCEL
                    </button>
                  )}
                </div>
                <div className="space-y-12">
                  {categories.map((cat) => {
                    const itemsInCategory = menuItems.filter(
                      (item) => item.category === cat.name,
                    );
                    if (itemsInCategory.length === 0) return null;

                    return (
                      <div key={cat.id} className="space-y-6">
                        <div className="flex items-center gap-4">
                          <h4 className="text-2xl font-black italic uppercase tracking-tighter text-white">
                            {cat.name}{" "}
                            <span className="text-orange-500">.</span>
                          </h4>
                          <div className="h-[1px] flex-1 bg-gradient-to-r from-orange-500/30 to-transparent" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {itemsInCategory.map((item, idx) => (
                            <div
                              key={item.id}
                              className="bg-white/5 border border-white/10 rounded-2xl p-6 flex items-center gap-6 group hover:border-orange-500/30 transition-all"
                            >
                              <div className="flex-1">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h4 className="font-bold flex items-center gap-2">
                                      {item.name}
                                      {item.isTraditional && (
                                        <span className="text-[8px] bg-orange-500/10 text-orange-500 px-1.5 py-0.5 rounded uppercase tracking-widest">
                                          Traditional
                                        </span>
                                      )}
                                    </h4>
                                    <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">
                                      {formatPrice(item.price)}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-2 line-clamp-1">
                                      {item.description}
                                    </p>
                                  </div>
                                  <div className="flex gap-2">
                                    <div className="flex flex-col gap-1 mr-2 border-r border-white/10 pr-2">
                                      <button
                                        onClick={() =>
                                          handleMoveMenuItem(item, "up")
                                        }
                                        disabled={idx === 0}
                                        className="p-1 text-gray-500 hover:text-orange-500 disabled:opacity-0 transition-colors"
                                        title="Move Up"
                                      >
                                        <ChevronRight
                                          size={14}
                                          className="-rotate-90"
                                        />
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleMoveMenuItem(item, "down")
                                        }
                                        disabled={
                                          idx === itemsInCategory.length - 1
                                        }
                                        className="p-1 text-gray-500 hover:text-orange-500 disabled:opacity-0 transition-colors"
                                        title="Move Down"
                                      >
                                        <ChevronRight
                                          size={14}
                                          className="rotate-90"
                                        />
                                      </button>
                                    </div>

                                    <button
                                      onClick={() => startEditing(item)}
                                      className="p-2 text-gray-500 hover:text-blue-500 bg-white/5 rounded-lg transition-colors"
                                    >
                                      <Edit2 size={16} />
                                    </button>
                                    <button
                                      onClick={() => toggleAvailability(item)}
                                      className={cn(
                                        "p-2 rounded-lg transition-colors",
                                        item.available
                                          ? "text-green-500 bg-green-500/10"
                                          : "text-red-500 bg-red-500/10",
                                      )}
                                    >
                                      {item.available ? (
                                        <Check size={16} />
                                      ) : (
                                        <X size={16} />
                                      )}
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleDeleteMenuItem(item.id)
                                      }
                                      className="p-2 text-gray-500 hover:text-red-500 bg-white/5 rounded-lg transition-colors"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
