import { useState, useEffect, useRef, useMemo } from 'react';
import { db, collection, getDocs, query, where, orderBy, doc, onSnapshot } from '../firebase';
import { UserProfile } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Search, X, Clock, AlertTriangle, Tag, Truck, ChevronDown, ChevronUp, ArrowUp } from 'lucide-react';
import { formatPrice, cn } from '../lib/utils';
import { toast } from 'sonner';
import { isOpenNow, getOpeningTimesText } from '../lib/businessHours';

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

interface MenuProps {
  user: UserProfile | null;
  addToCart: (item: { id: string; name: string; price: number, variant?: string }) => void;
  editDish?: (id: string) => void;
}

interface MeatOption {
  id: string;
  name: string;
  extra: number;
  order: number;
}

// Global memory cache to eliminate menu loading delays / blank screen when switching back to menu in Safari
let cachedMenuItems: MenuItem[] | null = null;
let cachedCategories: string[] | null = null;
let cachedMeatOptions: MeatOption[] | null = null;

export default function Menu({ user, addToCart, editDish }: MenuProps) {
  const [items, setItems] = useState<MenuItem[]>(() => cachedMenuItems || []);
  const [categories, setCategories] = useState<string[]>(() => cachedCategories || []);
  const [meatOptions, setMeatOptions] = useState<MeatOption[]>(() => cachedMeatOptions || []);
  const [loading, setLoading] = useState<boolean>(() => !cachedMenuItems || cachedMenuItems.length === 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemForVariant, setSelectedItemForVariant] = useState<MenuItem | null>(null);
  const [discountSettings, setDiscountSettings] = useState<any>(null);
  const [isCurrentlyOpen, setIsCurrentlyOpen] = useState(isOpenNow());
  const [expandedCategories, setExpandedCategories] = useState<{ [key: string]: boolean }>({});
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Categories remain collapsed by default for fast, clean rendering
  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'receipt'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDiscountSettings(data);
        if (data.businessHours) {
          setIsCurrentlyOpen(isOpenNow(data.businessHours, data.closedDates));
        } else {
          setIsCurrentlyOpen(isOpenNow(undefined, data.closedDates));
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (discountSettings?.businessHours) {
        setIsCurrentlyOpen(isOpenNow(discountSettings.businessHours, discountSettings?.closedDates));
      } else {
        setIsCurrentlyOpen(isOpenNow(undefined, discountSettings?.closedDates));
      }
    }, 60000); // Check every minute
    return () => clearInterval(timer);
  }, [discountSettings]);

  // Real-time Firestore subscriptions with instant cache fallback
  useEffect(() => {
    let hasLoadedItems = false;
    let hasLoadedCats = false;

    // 1. Subscribe to menu items
    const itemsQ = query(collection(db, 'menu'), orderBy('order', 'asc'));
    const unsubItems = onSnapshot(itemsQ, (itemsSnapshot) => {
      const menuItems = itemsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        order: doc.data().order ?? 0 
      } as MenuItem));
      const availItems = menuItems.filter(i => i.available);
      cachedMenuItems = availItems;
      setItems(availItems);
      hasLoadedItems = true;
      if (hasLoadedCats || (cachedCategories && cachedCategories.length > 0)) {
        setLoading(false);
      }
    }, (error) => {
      console.error('Error listening to menu items:', error);
      setLoading(false);
    });

    // 2. Subscribe to categories
    const catsQ = query(collection(db, 'categories'), orderBy('order', 'asc'));
    const unsubCats = onSnapshot(catsQ, (catsSnapshot) => {
      let fetchedCats = catsSnapshot.docs.map(doc => doc.data().name as string);
      if (fetchedCats.length === 0 && cachedMenuItems) {
        fetchedCats = Array.from(new Set(cachedMenuItems.map(i => i.category)));
      }
      cachedCategories = fetchedCats;
      setCategories(fetchedCats);
      hasLoadedCats = true;
      if (hasLoadedItems || (cachedMenuItems && cachedMenuItems.length > 0)) {
        setLoading(false);
      }
    }, (error) => {
      console.error('Error listening to categories:', error);
    });

    // 3. Subscribe to meat options
    const meatQ = query(collection(db, 'meatOptions'), orderBy('order', 'asc'));
    const unsubMeat = onSnapshot(meatQ, (meatSnapshot) => {
      const fetchedMeat = meatSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MeatOption));
      cachedMeatOptions = fetchedMeat;
      setMeatOptions(fetchedMeat);
    }, (error) => {
      console.error('Error listening to meat options:', error);
    });

    if (cachedMenuItems && cachedMenuItems.length > 0) {
      setLoading(false);
    }

    return () => {
      unsubItems();
      unsubCats();
      unsubMeat();
    };
  }, []);

  const handleAddToCart = (item: MenuItem) => {
    if (item.category === 'Traditional Dishes' || item.isTraditional) {
      setSelectedItemForVariant(item);
    } else {
      addToCart({ id: item.id, name: item.name, price: item.price });
    }
  };

  const selectVariantAndAdd = (meat: MeatOption) => {
    if (!selectedItemForVariant) return;
    addToCart({ 
      id: `${selectedItemForVariant.id}-${meat.name.replace(/\s+/g, '-').toLowerCase()}`,
      name: `${meat.name} ${selectedItemForVariant.name}`,
      price: selectedItemForVariant.price + meat.extra,
      variant: meat.name
    });
    setSelectedItemForVariant(null);
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item => item.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  const itemsByCategory = useMemo(() => 
    categories.reduce((acc, cat) => {
      acc[cat] = filteredItems.filter(item => item.category === cat);
      return acc;
    }, {} as { [key: string]: MenuItem[] }), 
  [categories, filteredItems]);

  // Only show categories that have items matching the search
  const visibleCategories = useMemo(() => 
    categories.filter(cat => itemsByCategory[cat] && itemsByCategory[cat].length > 0),
  [categories, itemsByCategory]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-white selection:bg-orange-500 selection:text-white">
      {/* Back to Top Button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: showBackToTop ? 1 : 0 }}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-24 right-8 z-[60] w-14 h-14 bg-gray-400/90 text-white rounded-full flex flex-col items-center justify-center shadow-lg backdrop-blur-sm"
      >
        <span className="text-[10px] font-bold">TOP</span>
        <ArrowUp size={16} />
      </motion.button>

      <div className="relative z-20">
        {!isCurrentlyOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl mx-auto px-4 md:px-0 pt-6"
          >
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
              <div className="flex items-center justify-center gap-2 text-red-600 mb-2">
                <AlertTriangle size={20} />
                <span className="text-sm font-bold uppercase tracking-wider">Restaurant Currently Closed</span>
              </div>
              <p className="text-gray-600 text-sm">
                We are closed for immediate orders. You can still pre-order for later!
              </p>
            </div>
          </motion.div>
        )}

        {/* Info Header Area */}
        <div className="max-w-4xl mx-auto px-4 md:px-0 py-8 text-center space-y-4">
          {discountSettings && (
            <div className="text-sm font-bold space-y-1">
              {discountSettings.deliveryDiscount?.enabled && (
                <p className="text-orange-500">
                  {discountSettings.deliveryDiscount.percentage}% OFF on Delivery order over {formatPrice(discountSettings.deliveryDiscount.minOrder)}
                </p>
              )}
              {discountSettings.collectionDiscount?.enabled && (
                <p className="text-orange-500">
                  {discountSettings.collectionDiscount.percentage}% OFF on Collection over {formatPrice(discountSettings.collectionDiscount.minOrder)}
                </p>
              )}
              {discountSettings.cashDiscount?.enabled && (
                <p className="text-amber-500">
                  {discountSettings.cashDiscount.percentage}% OFF on Cash orders over {formatPrice(discountSettings.cashDiscount.minOrder)} (does not stack with other discounts)
                </p>
              )}
              {discountSettings.freeDeliveryEnabled && (
                <p className="text-green-500">
                  FREE Delivery on orders over {formatPrice(discountSettings.freeDeliveryMinOrder)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sticky Header with Search */}
        <div className="sticky top-[73px] z-40 bg-[#0d0d0d]/90 backdrop-blur-md py-4 border-b border-white/5 shadow-2xl">
          <div className="max-w-4xl mx-auto px-4">
            <div className="relative group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-500">
                <Search size={18} />
              </div>
              <input
                type="text"
                placeholder="Search for dishes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-11 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/50 transition-all placeholder:text-gray-600"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-4 flex items-center text-gray-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-8 space-y-4 overflow-hidden">
          {visibleCategories.map(cat => (
            <div 
              key={cat} 
              data-category={cat}
              className="bg-white/5 border border-white/10 rounded-xl overflow-hidden shadow-2xl"
            >
              <button 
                onClick={() => toggleCategory(cat)}
                className={cn(
                  "w-full px-6 py-4 flex items-center justify-between text-left transition-colors",
                  expandedCategories[cat] ? "border-b border-white/5 bg-white/5" : "hover:bg-white/[0.02]"
                )}
              >
                <h2 className="font-bold text-white tracking-tight">{cat}</h2>
                {expandedCategories[cat] ? <ChevronUp className="text-gray-500" size={20} /> : <ChevronDown className="text-gray-500" size={20} />}
              </button>

              <AnimatePresence initial={false}>
                {(expandedCategories[cat] || searchQuery) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                  >
                    <div className="divide-y divide-white/5 px-6">
                      {itemsByCategory[cat].map((item) => (
                        <div key={item.id} className="py-4 flex flex-col gap-2">
                          <div className="flex justify-between items-start gap-4">
                            <div className="flex-1">
                              <h3 className="text-base font-bold text-orange-500 leading-tight">
                                {item.name}
                              </h3>
                              <p className="text-gray-400 text-xs leading-relaxed max-w-xl mt-1">
                                {item.description}
                              </p>
                            </div>
                            {!item.available ? (
                              <span className="text-[10px] font-bold uppercase tracking-widest bg-red-500/10 text-red-500 px-2 py-1 rounded shrink-0">Sold Out</span>
                            ) : (
                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <span className="text-base font-bold text-white">{formatPrice(item.price)}</span>
                                <button
                                  onClick={() => handleAddToCart(item)}
                                  className="px-4 py-1.5 bg-white text-black rounded font-bold text-[10px] uppercase tracking-tight hover:bg-orange-600 hover:text-white transition-colors shadow-sm"
                                >
                                  ADD
                                </button>
                              </div>
                            )}
                          </div>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => editDish?.(item.id)}
                              className="self-start text-[10px] font-bold text-blue-500 uppercase tracking-widest hover:underline"
                            >
                              Edit Dish
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {visibleCategories.length === 0 && searchQuery && (
            <div className="text-center py-20 bg-white/5 border border-white/10 rounded-2xl">
               <p className="text-gray-500 font-bold mb-4">No dishes match "{searchQuery}"</p>
               <button onClick={() => setSearchQuery('')} className="text-orange-500 font-bold underline">Clear Search</button>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedItemForVariant && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForVariant(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-[#111111] border border-white/10 rounded-[2.5rem] p-8 z-[101] shadow-2xl"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                    Select <span className="text-orange-600">Meat</span>
                  </h3>
                  <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest mt-2">For {selectedItemForVariant.name}</p>
                </div>
                <button
                  onClick={() => setSelectedItemForVariant(null)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {meatOptions.map((meat) => (
                  <button
                    key={meat.id}
                    onClick={() => selectVariantAndAdd(meat)}
                    className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:border-orange-500/50 hover:bg-orange-500/5 transition-all group"
                  >
                    <span className="text-sm font-bold text-gray-300 group-hover:text-white">{meat.name}</span>
                    <span className="text-xs font-black text-orange-500">
                      {meat.extra > 0 ? `+${formatPrice(meat.extra)}` : 'FREE'}
                    </span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setSelectedItemForVariant(null)}
                className="w-full py-4 bg-white/5 border border-white/10 text-gray-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
              >
                CANCEL
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
