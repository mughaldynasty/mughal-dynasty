import { useState, useEffect } from 'react';
import { db, collection, query, where, orderBy, onSnapshot, updateDoc, doc } from '../firebase';
import { UserProfile } from '../App';
import { motion } from 'motion/react';
import { ShoppingBag, Clock, MapPin, Phone, CheckCircle2, XCircle, Package, Truck, RotateCcw } from 'lucide-react';
import { formatPrice, cn, formatOrderId } from '../lib/utils';
import { toast } from 'sonner';

interface Order {
  id: string;
  userId: string;
  items: any[];
  total: number;
  status: string;
  type: string;
  phone: string;
  address?: string;
  houseNumber?: string;
  houseName?: string;
  streetName?: string;
  areaName?: string;
  postcode?: string;
  createdAt: any;
  acceptedAt?: any;
  completedAt?: any;
  customerName?: string;
  timeSlot?: string;
  estimate?: string;
}

interface OrderHistoryProps {
  user: UserProfile | null;
  onRepeatOrder?: (items: any[]) => void;
}

export default function OrderHistory({ user, onRepeatOrder }: OrderHistoryProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'orders'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
        setLoading(false);
      }, (error) => {
        console.error('Error fetching orders:', error);
        setLoading(false);
      });

      return () => unsubscribe();
    } else {
      // Guest mode: load last orders saved in localStorage
      try {
        const storedLastOrder = localStorage.getItem('mughal_last_order');
        const storedOrders = localStorage.getItem('mughal_guest_orders');
        let parsedList: Order[] = [];
        if (storedOrders) {
          parsedList = JSON.parse(storedOrders);
        } else if (storedLastOrder) {
          parsedList = [JSON.parse(storedLastOrder)];
        }
        setOrders(parsedList);
      } catch (err) {
        console.error('Failed to parse local guest orders:', err);
      }
      setLoading(false);
    }
  }, [user]);

  const handleCancelOrder = async (orderId: string) => {
    toast('Cancel this order?', {
      description: 'This action cannot be undone.',
      action: {
        label: 'Confirm Cancel',
        onClick: async () => {
          try {
            await updateDoc(doc(db, 'orders', orderId), { status: 'cancelled' });
            toast.success('Order cancelled');
          } catch (error) {
            toast.error('Failed to cancel order');
          }
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="relative z-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-4xl font-bold tracking-tight">ORDER HISTORY</h2>
          {!user && (
            <span className="text-xs bg-orange-500/10 text-orange-500 border border-orange-500/20 px-3 py-1.5 rounded-full font-bold">
              GUEST SESSION ORDERS
            </span>
          )}
        </div>

      {orders.length === 0 ? (
        <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/10">
          <ShoppingBag size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400">You haven't placed any orders yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {orders.map((order, orderIdx) => {
            const formattedDate = order.createdAt?.toDate 
              ? order.createdAt.toDate().toLocaleString()
              : typeof order.createdAt === 'string'
                ? new Date(order.createdAt).toLocaleString()
                : 'Recent Order';

            return (
              <motion.div
                key={`${order.id}-${orderIdx}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 hover:border-white/20 transition-all"
              >
                <div className="flex flex-col md:flex-row justify-between gap-6">
                  <div className="space-y-6 flex-1">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                        {formatOrderId(order.id)}
                      </span>
                      <div className={cn(
                        "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                        order.status === 'pending' && "bg-yellow-500/10 text-yellow-500",
                        order.status === 'confirmed' && "bg-blue-500/10 text-blue-500",
                        order.status === 'preparing' && "bg-orange-500/10 text-orange-500",
                        order.status === 'out-for-delivery' && "bg-purple-500/10 text-purple-500",
                        order.status === 'delivered' && "bg-green-500/10 text-green-500",
                        order.status === 'cancelled' && "bg-red-500/10 text-red-500"
                      )}>
                        {order.status === 'delivered' && <CheckCircle2 size={12} />}
                        {order.status === 'cancelled' && <XCircle size={12} />}
                        {order.status === 'preparing' && <Package size={12} />}
                        {order.status === 'out-for-delivery' && <Truck size={12} />}
                        {order.status}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Clock size={14} />
                        {formattedDate}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                      <div>
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Items</h4>
                        <ul className="space-y-2">
                          {order.items.map((item: any, i: number) => (
                            <li key={i} className="text-sm flex justify-between border-b border-white/5 py-2 last:border-0 last:pb-0">
                              <div className="flex flex-col">
                                <span className="text-gray-300">
                                  <span className="text-orange-500 font-bold mr-2">{item.quantity}x</span>
                                  {item.name}
                                </span>
                                {item.variant && (
                                  <span className="text-[10px] text-orange-500 font-black uppercase tracking-widest pl-6">
                                    + {item.variant}
                                  </span>
                                )}
                              </div>
                              <span className="font-bold">{formatPrice(item.price * item.quantity)}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                          <span className="text-sm text-gray-400">Total</span>
                          <span className="text-xl font-bold text-orange-500">{formatPrice(order.total)}</span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Details</h4>
                        <div className="flex items-start gap-3 text-sm text-gray-400">
                          <Phone size={16} className="mt-0.5 text-orange-500" />
                          <span>{order.phone}</span>
                        </div>
                        <div className="flex items-start gap-3 text-sm text-gray-400">
                          {order.type === 'delivery' ? (
                            <Truck size={16} className="mt-0.5 text-orange-500" />
                          ) : (
                            <ShoppingBag size={16} className="mt-0.5 text-orange-500" />
                          )}
                          <span>{order.type.toUpperCase()}</span>
                        </div>
                        {order.address && (
                          <div className="flex items-start gap-3 text-sm text-gray-400">
                            <MapPin size={16} className="mt-0.5 text-orange-500" />
                            <div className="flex flex-col">
                              {order.houseName && <span>{order.houseName}</span>}
                              <span>{order.houseNumber ? order.houseNumber + ' ' : ''}{order.streetName}</span>
                              {order.areaName && <span>{order.areaName}</span>}
                              {order.postcode && <span>{order.postcode}</span>}
                              {!order.streetName && order.address && <span>{order.address}</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:items-end justify-between gap-4 shrink-0">
                    {onRepeatOrder && (
                      <button
                        onClick={() => onRepeatOrder(order.items)}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-orange-600/20 cursor-pointer"
                      >
                        <RotateCcw size={14} />
                        REPEAT ORDER
                      </button>
                    )}

                    {order.status === 'pending' && (
                      <button
                        onClick={() => handleCancelOrder(order.id)}
                        className="px-4 py-2 text-xs font-bold text-red-500 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                      >
                        CANCEL ORDER
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
