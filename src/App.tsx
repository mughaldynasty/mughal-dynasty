/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { auth, db, onAuthStateChanged, doc, getDoc, setDoc, onSnapshot, updateDoc, signInAnonymously } from './firebase';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { Tag, Truck } from 'lucide-react';
import Navbar from './components/Navbar';
import Menu from './components/Menu';
import Cart from './components/Cart';
import AdminPanel from './components/AdminPanel';
import OrderHistory from './components/OrderHistory';
import Footer from './components/Footer';
import AuthModal from './components/AuthModal';
import ReservationModal from './components/ReservationModal';
import { formatPrice } from './lib/utils';

export type UserRole = 'admin' | 'customer';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  isGuest?: boolean;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  variant?: string;
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'home' | 'menu' | 'orders' | 'admin'>('home');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountSettings, setDiscountSettings] = useState<any>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [reservationOpen, setReservationOpen] = useState(false);

  const editDish = (id: string) => {
    setEditingItemId(id);
    setView('admin');
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'receipt'), (snap) => {
      if (snap.exists()) {
        setDiscountSettings(snap.data());
      }
    });
    return () => unsub();
  }, []);

  const [cartShake, setCartShake] = useState(false);

  const triggerCartShake = () => {
    setCartShake(true);
    setTimeout(() => setCartShake(false), 700);
  };

  const addToCart = (item: { id: string; name: string; price: number, variant?: string }) => {
    if (user?.role === 'admin') return;
    setCart((prev) => {
      const itemKey = item.variant ? `${item.id}-${item.variant.replace(/\s+/g, '-').toLowerCase()}` : item.id;
      const existingIndex = prev.findIndex((i) => i.id === itemKey);
      if (existingIndex > -1) {
        return prev.map((i, idx) =>
          idx === existingIndex ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...item, id: itemKey, quantity: 1 }];
    });
    triggerCartShake();
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i
      )
    );
  };

  const clearCart = () => setCart([]);

  const repeatOrder = (items: any[]) => {
    if (user?.role === 'admin') return;
    if (!items || items.length === 0) return;
    
    const itemMap = new Map<string, CartItem>();

    items.forEach((item, index) => {
      const baseId = item.id || item.menuItemId || item.name || `item-${index}`;
      const variant = item.variant || undefined;
      const itemKey = variant ? `${baseId}-${variant.replace(/\s+/g, '-').toLowerCase()}` : baseId;
      const qty = Number(item.quantity) || 1;
      const price = Number(item.price) || 0;

      if (itemMap.has(itemKey)) {
        const existing = itemMap.get(itemKey)!;
        existing.quantity += qty;
      } else {
        itemMap.set(itemKey, {
          id: itemKey,
          name: item.name,
          price,
          quantity: qty,
          variant
        });
      }
    });

    const formattedItems = Array.from(itemMap.values());
    setCart(formattedItems);
    setCartOpen(true);
    triggerCartShake();
    toast.success('Previous order loaded into cart!');
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const isAdminEmail = firebaseUser.email === 'mughaldynastyrestaurant@gmail.com';
        const isStoredAdmin = localStorage.getItem('mughal_admin_session') === 'true';
        
        if (userDoc.exists()) {
          const userData = userDoc.data();
          // Force upgrade user if email matches but role is not admin, or if isStoredAdmin is true
          if ((isAdminEmail || isStoredAdmin) && userData.role !== 'admin') {
            await updateDoc(doc(db, 'users', firebaseUser.uid), { role: 'admin' });
            setUser({ uid: firebaseUser.uid, ...userData, role: 'admin' } as UserProfile);
          } else {
            setUser({ uid: firebaseUser.uid, ...userData } as UserProfile);
          }
        } else {
          // Create new user profile
          const newUser: UserProfile = {
            uid: firebaseUser.uid,
            name: (isAdminEmail || isStoredAdmin) ? 'Mughal Dynasty Admin' : (firebaseUser.displayName || 'Guest'),
            email: firebaseUser.email || ((isAdminEmail || isStoredAdmin) ? 'mughaldynastyrestaurant@gmail.com' : ''),
            role: (isAdminEmail || isStoredAdmin) ? 'admin' : 'customer',
            isGuest: firebaseUser.isAnonymous
          };
          // Don't persist guest users to Firestore users collection to keep it clean unless admin
          if (!firebaseUser.isAnonymous || (isAdminEmail || isStoredAdmin)) {
            await setDoc(doc(db, 'users', firebaseUser.uid), {
              name: newUser.name,
              email: newUser.email,
              role: newUser.role,
            });
          }
          setUser(newUser);
        }
      } else {
        if (localStorage.getItem('mughal_admin_session') === 'true') {
          try {
            await signInAnonymously(auth);
            return; // Wait for next onAuthStateChanged fire
          } catch (err) {
            console.error('Auto anonymous sign-in failed:', err);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d0d0d] text-white">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white font-sans selection:bg-orange-500 selection:text-white relative overflow-x-hidden max-w-full w-full">
      {/* Global Background Image with Balanced Top/Bottom Gradients */}
      <div className="fixed inset-0 z-0">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 scale-105"
          style={{ 
            backgroundImage: `url('https://images.unsplash.com/photo-1585937421612-70a008356fbe?q=80&w=2036&auto=format&fit=crop')`,
          }}
        />
        {/* Gradient overlay that matches top and bottom */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d0d0d] via-transparent to-[#0d0d0d] opacity-90" />
        <div className="absolute inset-0 bg-[#0d0d0d]/40" />
      </div>

      <Toaster position="top-center" richColors />
      <Navbar 
        user={user} 
        setView={setView} 
        currentView={view} 
        setCartOpen={setCartOpen} 
        cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)}
        cartShake={cartShake}
        authModalOpen={authModalOpen}
        setAuthModalOpen={setAuthModalOpen}
      />

      <AuthModal 
        isOpen={authModalOpen} 
        onClose={() => setAuthModalOpen(false)} 
        onSuccess={() => setView('admin')} 
      />
      
      <main className="relative z-10 pt-20 pb-12">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="relative min-h-[80vh] flex items-center justify-center overflow-hidden rounded-3xl"
            >
              <div className="relative z-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center py-20">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2, duration: 0.8 }}
                >
                  <h1 className="text-[60px] md:text-[85px] font-bold not-italic tracking-tighter mb-8 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-transparent drop-shadow-2xl leading-[1.1]">
                    MUGHAL <span className="text-orange-500">DYNASTY</span> <br className="hidden md:block" />
                    <span className="text-3xl md:text-5xl block mt-2 font-medium tracking-[0.2em] text-gray-400">RAUNDS</span>
                  </h1>
                </motion.div>
                
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5, duration: 1 }}
                  className="text-xl md:text-2xl text-gray-200 mb-12 max-w-2xl mx-auto font-light leading-relaxed drop-shadow-lg"
                >
                  Authentic Indian cuisine in the heart of Raunds. Experience the royal flavors of the Mughal era with our traditional recipes, now available for collection and delivery.
                </motion.p>
                
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8, duration: 0.5 }}
                  className="flex flex-col sm:flex-row gap-6 justify-center"
                >
                  {user?.role !== 'admin' && (
                    <button
                      onClick={() => setView('menu')}
                      className="px-10 py-5 bg-orange-600 hover:bg-orange-700 text-white rounded-full font-bold text-lg transition-all transform hover:scale-105 shadow-xl shadow-orange-600/20 active:scale-95"
                    >
                      Order Now
                    </button>
                  )}
                  {user?.role !== 'admin' && (
                    <button
                      onClick={() => setReservationOpen(true)}
                      className="px-10 py-5 bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 text-white rounded-full font-bold text-lg transition-all transform hover:scale-105 active:scale-95"
                    >
                      Reserve Table
                    </button>
                  )}
                </motion.div>

                {/* Home Page Promotions */}
                {discountSettings && (
                  <motion.div 
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1 }}
                    className="mt-24 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-left"
                  >
                    {/* Collection Promo */}
                    {discountSettings.collectionDiscount?.enabled && (
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        className="relative overflow-hidden group bg-gradient-to-br from-orange-600 to-orange-800 rounded-3xl p-8 shadow-2xl border border-white/10"
                      >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                          <Tag size={100} />
                        </div>
                        <div className="relative z-10 space-y-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-orange-200">Exclusive Offer</span>
                          <h3 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                            {discountSettings.collectionDiscount.percentage}% OFF <br />
                            <span className="text-orange-200">COLLECTION</span>
                          </h3>
                          <div className="h-[2px] w-12 bg-orange-300/30" />
                          <p className="text-xs font-bold text-orange-100 uppercase tracking-widest whitespace-nowrap">
                            Minimum Order {formatPrice(discountSettings.collectionDiscount.minOrder)}
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Delivery Promo */}
                    {discountSettings.deliveryDiscount?.enabled && (
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        className="relative overflow-hidden group bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-8 shadow-2xl border border-white/10"
                      >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                          <Truck size={100} />
                        </div>
                        <div className="relative z-10 space-y-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-200">Delivery Special</span>
                          <h3 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                            {discountSettings.deliveryDiscount.percentage}% OFF <br />
                            <span className="text-blue-200">DELIVERY</span>
                          </h3>
                          <div className="h-[2px] w-12 bg-blue-300/30" />
                          <p className="text-xs font-bold text-blue-100 uppercase tracking-widest whitespace-nowrap">
                            Minimum Order {formatPrice(discountSettings.deliveryDiscount.minOrder)}
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Free Delivery Promo */}
                    {discountSettings.freeDeliveryEnabled && (
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        className="relative overflow-hidden group bg-gradient-to-br from-green-600 to-green-800 rounded-3xl p-8 shadow-2xl border border-white/10 md:col-span-2 lg:col-span-1"
                      >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                          <Truck size={100} />
                        </div>
                        <div className="relative z-10 space-y-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-green-200">Big Appetite Reward</span>
                          <h3 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                            FREE DELIVERY <br />
                            <span className="text-green-200">APPLIED</span>
                          </h3>
                          <div className="h-[2px] w-12 bg-green-300/30" />
                          <p className="text-xs font-bold text-green-100 uppercase tracking-widest whitespace-nowrap">
                            On orders over {formatPrice(discountSettings.freeDeliveryMinOrder)}
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Cash Discount Promo */}
                    {discountSettings.cashDiscount?.enabled && (
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        className="relative overflow-hidden group bg-gradient-to-br from-yellow-600 to-amber-800 rounded-3xl p-8 shadow-2xl border border-white/10 md:col-span-2 lg:col-span-1"
                      >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
                          <Tag size={100} />
                        </div>
                        <div className="relative z-10 space-y-4">
                          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-amber-200">Cash Payment Reward</span>
                          <h3 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                            {discountSettings.cashDiscount.percentage}% OFF <br />
                            <span className="text-amber-200">CASH ORDERS</span>
                          </h3>
                          <div className="h-[2px] w-12 bg-amber-300/30" />
                          <p className="text-xs font-bold text-amber-100 uppercase tracking-widest whitespace-nowrap">
                            Minimum Order {formatPrice(discountSettings.cashDiscount.minOrder)}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Menu user={user} addToCart={addToCart} editDish={editDish} />
            </motion.div>
          )}
          {view === 'orders' && <OrderHistory user={user} onRepeatOrder={repeatOrder} />}
          {view === 'admin' && user?.role === 'admin' && (
            <AdminPanel initialEditingItemId={editingItemId} clearInitialEditing={() => setEditingItemId(null)} />
          )}
        </AnimatePresence>
      </main>

      {user?.role !== 'admin' && (
        <Cart 
          isOpen={cartOpen} 
          setIsOpen={setCartOpen} 
          user={user} 
          cart={cart} 
          removeFromCart={removeFromCart} 
          updateQuantity={updateQuantity} 
          clearCart={clearCart}
          onRepeatOrder={repeatOrder}
        />
      )}
      {view !== 'admin' && <Footer />}

      <ReservationModal 
        isOpen={reservationOpen} 
        onClose={() => setReservationOpen(false)} 
        discountSettings={discountSettings} 
      />
    </div>
  );
}
