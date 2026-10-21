import { useState, useEffect, FormEvent, useRef } from 'react';
import { db, collection, addDoc, serverTimestamp } from '../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, Users, Clock, Mail, Phone, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_BUSINESS_HOURS, DAY_NAMES, getTableReservationHours, getReservationClosedStatus } from '../lib/businessHours';

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  discountSettings: any;
}

export default function ReservationModal({ isOpen, onClose, discountSettings }: ReservationModalProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [guests, setGuests] = useState('2');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Set minimum date to today
  const todayStr = new Date().toISOString().split('T')[0];

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

  // Helper to format minutes (e.g. 1050) to "5:30pm"
  const formatMinsTo12Hour = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'pm' : 'am';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const displayM = m.toString().padStart(2, '0');
    return `${displayH}:${displayM}${ampm}`;
  };

  // Generate slots according to opening hours for the selected date
  const getTimeSlotsForDate = (selectedDateStr: string) => {
    if (!selectedDateStr) return [];

    // Check if reservations or entire restaurant are closed on this date
    const closedStatus = getReservationClosedStatus(selectedDateStr, discountSettings?.closedDates);
    if (closedStatus.isClosed) {
      return [];
    }

    // Parse the date in local timezone to prevent offset mismatch
    const [year, month, day] = selectedDateStr.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const dayOfWeek = dateObj.getDay(); // 0 = Sun, 1 = Mon...

    // Use table reservation hours (Fri & Sat table reservation starts from 5:00pm, while food order taking starts from 4:30pm)
    const hours = getTableReservationHours(dayOfWeek, discountSettings?.businessHours);
    if (!hours) return [];

    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);

    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;

    // Last slot must be at least one hour before closing time
    const lastSlotMins = closeMins - 60;

    const slots: string[] = [];
    const now = new Date();
    const currentDayStr = now.toISOString().split('T')[0];
    const currentMins = now.getHours() * 60 + now.getMinutes();

    // Generate slots in 15-minute intervals
    for (let mins = openMins; mins <= lastSlotMins; mins += 15) {
      // If the booking is for today, skip past slots
      if (selectedDateStr === currentDayStr && mins <= currentMins) {
        continue;
      }
      slots.push(formatMinsTo12Hour(mins));
    }

    return slots;
  };

  const availableSlots = getTimeSlotsForDate(date);
  const selectedDateClosedStatus = getReservationClosedStatus(date, discountSettings?.closedDates);

  // Reset time if selected date changes and current time is no longer available
  useEffect(() => {
    if (date && availableSlots.length > 0 && !availableSlots.includes(time)) {
      setTime(availableSlots[0]);
    }
  }, [date]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) return toast.error('Please enter your name');
    if (!guests || Number(guests) < 1) return toast.error('Please specify a valid number of guests');
    if (!date) return toast.error('Please select a date');

    const closedStatus = getReservationClosedStatus(date, discountSettings?.closedDates);
    if (closedStatus.isClosed) {
      return toast.error(`Table reservations are closed on this date: ${closedStatus.reason || 'Closed'}`);
    }

    if (!time) return toast.error('Please select a time slot');
    if (!email.trim() || !email.includes('@')) return toast.error('Please enter a valid email address');
    if (!phone.trim() || phone.length < 10) return toast.error('Please enter a valid phone number');

    setSubmitting(true);
    const toastId = toast.loading('Submitting reservation request...');

    try {
      const formattedDate = formatDateToDDMMYYYY(date);
      const cleanedTime = cleanTimeForNetlify(time);

      await addDoc(collection(db, 'reservations'), {
        name: name.trim(),
        guests: Number(guests),
        date,
        time,
        formattedDate,
        cleanedTime,
        email: email.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      toast.success('Reservation request submitted successfully!', { id: toastId, description: 'Our admin will review and confirm shortly.' });
      
      // Reset form
      setName('');
      setGuests('2');
      setDate('');
      setTime('');
      setEmail('');
      setPhone('');
      setNotes('');
      onClose();
    } catch (err: any) {
      console.error('Reservation submission failed:', err);
      toast.error('Failed to submit reservation. Please try again.', { id: toastId });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          {/* Backdrop Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-[#121212] border border-white/10 rounded-[2rem] w-full max-w-lg p-6 sm:p-8 overflow-hidden shadow-2xl z-10"
          >
            {/* Top Close Button */}
            <button
              onClick={onClose}
              className="absolute top-6 right-6 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full transition-colors"
            >
              <X size={20} />
            </button>

            {/* Title */}
            <div className="mb-6">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-orange-500">Mughal Dynasty</span>
              <h3 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter text-white mt-1">
                Reserve <span className="text-orange-500">A Table</span>
              </h3>
              <p className="text-gray-400 text-xs sm:text-sm mt-1">
                Fill in the details below to request your table. We will confirm via email.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                  Your Name
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                    <Users size={16} />
                  </span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter full name"
                    className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Number of Guests */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                    Guests
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                      <Users size={16} />
                    </span>
                    <input
                      type="number"
                      min="1"
                      pattern="[0-9]*"
                      inputMode="numeric"
                      required
                      value={guests}
                      onChange={(e) => setGuests(e.target.value)}
                      placeholder="e.g. 4"
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all"
                    />
                  </div>
                </div>

                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                    Date
                  </label>
                  <div 
                    className="relative cursor-pointer"
                    onClick={() => {
                      try {
                        dateInputRef.current?.showPicker();
                      } catch (err) {
                        // Fallback
                      }
                    }}
                  >
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                      <Calendar size={16} />
                    </span>
                    <input
                      ref={dateInputRef}
                      type="date"
                      required
                      min={todayStr}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      onClick={(e) => {
                        e.stopPropagation();
                        try {
                          (e.target as any).showPicker();
                        } catch (err) {
                          // Fallback for older browsers
                        }
                      }}
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all text-left cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Closure Warning Banner if Date is Closed */}
              {date && selectedDateClosedStatus.isClosed && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-red-400" />
                  <span>
                    Table reservations are closed on this date ({selectedDateClosedStatus.reason || 'Closed'}). Please select another date.
                  </span>
                </div>
              )}

              {/* Time Slot Dropdown */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                  Time Slot
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                    <Clock size={16} />
                  </span>
                  <select
                    disabled={!date || selectedDateClosedStatus.isClosed}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full bg-black/30 disabled:opacity-40 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all appearance-none"
                  >
                    {!date ? (
                      <option className="bg-[#121212] text-gray-500">Select Date First</option>
                    ) : selectedDateClosedStatus.isClosed ? (
                      <option className="bg-[#121212] text-red-400">Reservations Closed on this Date</option>
                    ) : availableSlots.length === 0 ? (
                      <option className="bg-[#121212] text-red-500">No Slots Available</option>
                    ) : (
                      availableSlots.map((slot) => (
                        <option key={slot} value={slot} className="bg-[#121212] text-white">
                          {slot}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Email */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                    Email Address
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@email.com"
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                    Phone Number
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 pointer-events-none">
                      <Phone size={16} />
                    </span>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="07123 456789"
                      className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">
                  Special Notes (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-orange-500 pointer-events-none">
                    <FileText size={16} />
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g., allergies, wheelchair accessibility, high chair for kids..."
                    rows={2}
                    className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-white font-medium outline-none focus:border-orange-500/50 focus:bg-black/50 transition-all resize-none"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || (date && availableSlots.length === 0)}
                className="w-full py-4 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-black uppercase tracking-wider rounded-xl transition-all shadow-xl shadow-orange-600/20 active:scale-[0.98] flex items-center justify-center gap-2 text-sm mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Requesting...
                  </>
                ) : (
                  'Reserve Now'
                )}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
