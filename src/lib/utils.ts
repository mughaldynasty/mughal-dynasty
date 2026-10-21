import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(price);
}

export function formatOrderId(id: string | undefined): string {
  if (!id) return '# 000 000 000';
  let n1 = 0, n2 = 0, n3 = 0;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (i % 3 === 0) n1 = (n1 * 31 + c) % 1000;
    else if (i % 3 === 1) n2 = (n2 * 31 + c) % 1000;
    else n3 = (n3 * 31 + c) % 1000;
  }
  const pad = (n: number) => n.toString().padStart(3, '0');
  return `# ${pad(n1)} ${pad(n2)} ${pad(n3)}`;
}

export function formatPostcode(postcode: string | undefined | null): string {
  if (!postcode) return "";
  const cleaned = postcode.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length >= 5) {
    const outward = cleaned.slice(0, -3);
    const inward = cleaned.slice(-3);
    return `${outward} ${inward}`;
  }
  return postcode.toUpperCase();
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Removes bracketed allergen markers like (N), (D), (G), (N),(D), (N, D) from kitchen copy receipts.
 * Preserves normal dish information, portion sizes like (Half) or non-allergen words.
 */
export function removeAllergyBrackets(text: string | undefined | null): string {
  if (!text) return "";

  // UK standard allergen codes & common abbreviations:
  // N = Nuts/Peanuts, D = Dairy/Milk, G = Gluten/Wheat, C = Crustaceans,
  // E = Eggs, F = Fish, M = Mustard, P = Peanuts, S = Soya/Sesame, L = Lupin,
  // MO = Molluscs, CE = Celery, SS = Sesame, SD = Sulphites, SO2 = Sulphur Dioxide,
  // V = Vegetarian, VG = Vegan, DF = Dairy Free, GF = Gluten Free
  const allergenList = "(?:N|D|G|C|E|F|M|P|S|L|MO|CE|SS|SD|SO2|V|VG|DF|GF)";

  // 1. Match multiple adjacent brackets like (N)(D), (N),(D), (N), (D), (N) (D)
  const adjacentAllergenRegex = new RegExp(
    `\\(\\s*${allergenList}\\s*\\)(?:\\s*,?\\s*\\(\\s*${allergenList}\\s*\\))+`,
    "gi"
  );

  // 2. Match grouped allergens inside one bracket like (N, D), (N,D), (D / N), (N, D, G)
  const groupedAllergenRegex = new RegExp(
    `\\(\\s*${allergenList}(?:\\s*[,/]\\s*${allergenList})*\\s*\\)`,
    "gi"
  );

  // 3. Match single allergen brackets like (N), (D), (G), (V)
  const singleAllergenRegex = new RegExp(
    `\\(\\s*${allergenList}\\s*\\)`,
    "gi"
  );

  // 4. Any leftover bracket containing only comma/slash-separated 1-2 letter tags, e.g. (n, d)
  const shortTagRegex = /\(\s*[A-Za-z]{1,2}(?:\s*[,/]\s*[A-Za-z]{1,2})*\s*\)/g;

  let cleaned = text
    .replace(adjacentAllergenRegex, "")
    .replace(groupedAllergenRegex, "")
    .replace(singleAllergenRegex, "")
    .replace(shortTagRegex, (match) => {
      // Exclude common dish sizes or non-allergen words
      const inner = match.slice(1, -1).trim().toUpperCase();
      if (["SM", "MD", "LG", "XL", "OK"].includes(inner)) return match;
      return "";
    });

  // Clean leftover double commas, trailing commas, and irregular spaces
  return cleaned
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/g, "")
    .replace(/^\s*,\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}
