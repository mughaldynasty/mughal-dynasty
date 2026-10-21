/**
 * Business hours for Mughal Dynasty
 * Mon - Thu: 17:00 - 21:30
 * Fri - Sat: 16:30 - 22:30
 * Sun: 17:00 - 21:30
 */

export interface BusinessDay {
  day: string;
  open: string;
  close: string;
  openMins: number;
  closeMins: number;
}

export const DEFAULT_BUSINESS_HOURS: Record<number, { open: string; close: string; openMins: number; closeMins: number }> = {
  0: { open: '17:00', close: '21:30', openMins: 17 * 60, closeMins: 21 * 60 + 30 }, // Sun
  1: { open: '17:00', close: '21:30', openMins: 17 * 60, closeMins: 21 * 60 + 30 }, // Mon
  2: { open: '17:00', close: '21:30', openMins: 17 * 60, closeMins: 21 * 60 + 30 }, // Tue
  3: { open: '17:00', close: '21:30', openMins: 17 * 60, closeMins: 21 * 60 + 30 }, // Wed
  4: { open: '17:00', close: '21:30', openMins: 17 * 60, closeMins: 21 * 60 + 30 }, // Thu
  5: { open: '16:30', close: '22:30', openMins: 16 * 60 + 30, closeMins: 22 * 60 + 30 }, // Fri
  6: { open: '16:30', close: '22:30', openMins: 16 * 60 + 30, closeMins: 22 * 60 + 30 }, // Sat
};

export const BUSINESS_HOURS = DEFAULT_BUSINESS_HOURS;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface ClosedDateSetting {
  id: string;
  date: string; // YYYY-MM-DD
  reason?: string;
  closeRestaurant: boolean; // closes online ordering
  closeReservations: boolean; // closes table reservations
  createdAt?: string;
}

export const getIsoDateString = (dateObj: Date = new Date()): string => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getRestaurantClosedStatus = (
  dateStr: string,
  closedDates?: ClosedDateSetting[]
): { isClosed: boolean; reason?: string } => {
  if (!closedDates || !Array.isArray(closedDates) || !dateStr) {
    return { isClosed: false };
  }
  const match = closedDates.find(c => c.date === dateStr && c.closeRestaurant);
  if (match) {
    return { isClosed: true, reason: match.reason || 'Scheduled restaurant closure' };
  }
  return { isClosed: false };
};

export const getReservationClosedStatus = (
  dateStr: string,
  closedDates?: ClosedDateSetting[]
): { isClosed: boolean; reason?: string } => {
  if (!closedDates || !Array.isArray(closedDates) || !dateStr) {
    return { isClosed: false };
  }
  const match = closedDates.find(c => c.date === dateStr && (c.closeReservations || c.closeRestaurant));
  if (match) {
    return { isClosed: true, reason: match.reason || 'Reservations closed on this date' };
  }
  return { isClosed: false };
};

export const isOpenNow = (
  customHours?: typeof DEFAULT_BUSINESS_HOURS,
  closedDates?: ClosedDateSetting[]
) => {
  const todayStr = getIsoDateString();
  const closedStatus = getRestaurantClosedStatus(todayStr, closedDates);
  if (closedStatus.isClosed) {
    return false;
  }

  const hoursConfig = customHours || BUSINESS_HOURS;
  const now = new Date();
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMins = hours * 60 + minutes;
  
  const schedule = hoursConfig[day];
  if (!schedule) return false;
  return currentMins >= schedule.openMins && currentMins <= schedule.closeMins;
};

export const getOpeningTimesText = (customHours?: typeof DEFAULT_BUSINESS_HOURS) => {
  const hoursToUse = customHours || BUSINESS_HOURS;
  // This is a simplified version, ideally it would group days with same hours
  return [
    { days: 'Mon - Thu', hours: `${hoursToUse[1].open} - ${hoursToUse[1].close}` },
    { days: 'Fri - Sat', hours: `${hoursToUse[5].open} - ${hoursToUse[5].close}` },
    { days: 'Sunday', hours: `${hoursToUse[0].open} - ${hoursToUse[0].close}` },
  ];
};

export const getTodayHours = (customHours?: typeof DEFAULT_BUSINESS_HOURS) => {
  const hoursToUse = customHours || BUSINESS_HOURS;
  const day = new Date().getDay();
  return hoursToUse[day];
};

/**
 * Business hours for table reservations.
 * On Friday & Saturday order taking starts from 4:30pm (16:30),
 * but table reservations start from 5:00pm (17:00).
 */
export const getTableReservationHours = (
  dayOfWeek: number,
  customHours?: typeof DEFAULT_BUSINESS_HOURS
) => {
  const hoursToUse = customHours || BUSINESS_HOURS;
  const schedule = hoursToUse[dayOfWeek];
  if (!schedule) return null;

  // On Friday (5) and Saturday (6), table reservation starts strictly from 5:00pm (17:00)
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    const reservationOpenMins = 17 * 60; // 17:00 = 1020 mins
    return {
      ...schedule,
      open: '17:00',
      openMins: Math.max(schedule.openMins, reservationOpenMins),
    };
  }

  return schedule;
};
