import { db, collection, getDocs, query, orderBy } from '../firebase';

export interface MenuItemWithOrder {
  id: string;
  category: string;
  order: number;
}

export interface CategoryWithOrder {
  name: string;
  order: number;
}

// Semantic fallback order for categories based on the user's explicit requested flow:
// "Like the starters at first then main course then side or vegetables dish then rice or naan then papadums chutneys."
const CATEGORY_SEMANTIC_ORDER = [
  'starters',
  'starter',
  'tandoori starters',
  'signature starters',
  'appetizers',
  'traditional dishes',
  'chef\'s specials',
  'house specials',
  'main course',
  'main dishes',
  'curries',
  'biryani',
  'balti',
  'vegetarian mains',
  'sides',
  'side dishes',
  'vegetables',
  'vegetable sides',
  'vegetable dishes',
  'rice',
  'rice dishes',
  'breads',
  'naan',
  'sundries',
  'papadums',
  'papadum',
  'chutneys',
  'chutney',
  'pickles',
  'drinks',
  'beverages',
  'desserts',
];

let cachedCategories: CategoryWithOrder[] | null = null;
let cachedMenuItems: MenuItemWithOrder[] | null = null;

export async function fetchSortingMetadata(forceRefresh = false) {
  if (!forceRefresh && cachedCategories && cachedMenuItems) {
    return { categories: cachedCategories, menuItems: cachedMenuItems };
  }
  try {
    const catsQ = query(collection(db, 'categories'), orderBy('order', 'asc'));
    const catsSnapshot = await getDocs(catsQ);
    const categories = catsSnapshot.docs.map(doc => ({
      name: doc.data().name as string,
      order: doc.data().order ?? 0
    }));

    const itemsQ = query(collection(db, 'menu'), orderBy('order', 'asc'));
    const itemsSnapshot = await getDocs(itemsQ);
    const menuItems = itemsSnapshot.docs.map(doc => ({
      id: doc.id,
      category: doc.data().category as string,
      order: doc.data().order ?? 0
    }));

    cachedCategories = categories;
    cachedMenuItems = menuItems;

    return { categories, menuItems };
  } catch (error) {
    console.error('Error fetching sorting metadata:', error);
    return {
      categories: cachedCategories || [],
      menuItems: cachedMenuItems || []
    };
  }
}

export function sortOrderItems(
  items: any[],
  categories: CategoryWithOrder[],
  menuItems: MenuItemWithOrder[]
) {
  const categoryOrderMap = new Map<string, number>();
  categories.forEach((cat) => {
    categoryOrderMap.set(cat.name.toLowerCase().trim(), cat.order);
  });

  const menuItemMap = new Map<string, MenuItemWithOrder>();
  menuItems.forEach((item) => {
    menuItemMap.set(item.id, item);
  });

  const getSemanticCategoryOrder = (catName: string): number => {
    const normalized = catName.toLowerCase().trim();
    for (let i = 0; i < CATEGORY_SEMANTIC_ORDER.length; i++) {
      if (normalized.includes(CATEGORY_SEMANTIC_ORDER[i])) {
        return i;
      }
    }
    return 999;
  };

  return [...items].sort((a, b) => {
    const aBaseId = a.id.split('-')[0];
    const bBaseId = b.id.split('-')[0];

    const aMenu = menuItemMap.get(aBaseId);
    const bMenu = menuItemMap.get(bBaseId);

    const aCategory = aMenu?.category || '';
    const bCategory = bMenu?.category || '';

    let aCatOrder = 999999;
    let bCatOrder = 999999;

    if (aCategory) {
      const dbOrder = categoryOrderMap.get(aCategory.toLowerCase().trim());
      if (dbOrder !== undefined) {
        aCatOrder = dbOrder;
      } else {
        aCatOrder = 10000 + getSemanticCategoryOrder(aCategory);
      }
    }

    if (bCategory) {
      const dbOrder = categoryOrderMap.get(bCategory.toLowerCase().trim());
      if (dbOrder !== undefined) {
        bCatOrder = dbOrder;
      } else {
        bCatOrder = 10000 + getSemanticCategoryOrder(bCategory);
      }
    }

    if (aCatOrder !== bCatOrder) {
      return aCatOrder - bCatOrder;
    }

    const aItemOrder = aMenu?.order ?? 0;
    const bItemOrder = bMenu?.order ?? 0;

    if (aItemOrder !== bItemOrder) {
      return aItemOrder - bItemOrder;
    }

    return a.name.localeCompare(b.name);
  });
}
