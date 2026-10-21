export interface Order {
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

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  order: number;
  isTraditional?: boolean;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface MeatOption {
  id: string;
  name: string;
  price: number;
  order: number;
}
