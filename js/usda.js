// usda.js — talks to USDA FoodData Central, caches results locally to minimize data use.
import { DB } from './db.js';

const BASE = 'https://api.nal.usda.gov/fdc/v1';

// Nutrient IDs we care about (USDA FDC *nutrient IDs* — not the older "nutrientNumber"
// codes like "208". id and number are different identifiers for the same nutrient;
// mixing them up means lookups silently miss and every value comes back as 0.)
const NUTRIENT_MAP = {
  1008: 'calories',
  1003: 'protein',
  1005: 'carbs',
  1004: 'fat',
  1079: 'fiber',
  2000: 'sugars',
  1093: 'sodium',
  1092: 'potassium',
  1087: 'calcium',
  1089: 'iron',
  1090: 'magnesium',
  1095: 'zinc',
  1114: 'vitaminD',
  1178: 'vitaminB12',
  1177: 'folate',
  1162: 'vitaminC',
  1106: 'vitaminA',
};

function extractNutrients(fdcFood) {
  const out = {};
  const list = fdcFood.foodNutrients || [];
  for (const n of list) {
    // Detail endpoint nests under n.nutrient.id; search endpoint gives n.nutrientId directly.
    const id = n.nutrient?.id ?? n.nutrientId ?? null;
    const key = NUTRIENT_MAP[id];
    if (key) {
      const amount = n.amount ?? n.value ?? 0;
      out[key] = amount;
    }
  }
  return out;
}

function extractPortions(fdcFood) {
  const raw = fdcFood.foodPortions || [];
  return raw
    .map((p) => {
      const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
      const amount = p.amount || 1;
      const modifier = p.modifier && p.modifier !== unit ? p.modifier : '';
      const label = [amount !== 1 ? amount : '', unit, modifier].filter(Boolean).join(' ').trim() || 'serving';
      return {
        label,
        grams: p.gramWeight,
      };
    })
    .filter((p) => p.grams > 0);
}

async function apiKey() {
  const key = await DB.getSetting('usdaApiKey');
  if (!key) throw new Error('No USDA API key set. Add one in Settings (free at api.data.gov/signup).');
  return key;
}

export const USDA = {
  /**
   * Search foods, restricted to Foundation Foods + SR Legacy (raw/whole ingredients,
   * not branded/processed) unless includeAll is set.
   */
  async search(query, includeAll = false) {
    const key = await apiKey();
    const params = new URLSearchParams({
      api_key: key,
      query,
      pageSize: '15',
    });
    if (!includeAll) {
      params.append('dataType', 'Foundation');
      params.append('dataType', 'SR Legacy');
    }
    const res = await fetch(`${BASE}/foods/search?${params.toString()}`);
    if (!res.ok) throw new Error(`USDA search failed (${res.status})`);
    const data = await res.json();
    return (data.foods || []).map((f) => ({
      fdcId: f.fdcId,
      description: f.description,
      dataType: f.dataType,
      nutrients: extractNutrients(f),
    }));
  },

  /** Fetch full detail for one food, using local cache first. */
  async getFood(fdcId) {
    const cached = await DB.getCachedFood(fdcId);
    if (cached) return cached;

    const key = await apiKey();
    const res = await fetch(`${BASE}/food/${fdcId}?api_key=${key}`);
    if (!res.ok) throw new Error(`USDA lookup failed (${res.status})`);
    const data = await res.json();
    const food = {
      fdcId: data.fdcId,
      description: data.description,
      dataType: data.dataType,
      nutrients: extractNutrients(data),
      portions: extractPortions(data),
    };
    await DB.cacheFood(food);
    return food;
  },

  /** Scale a food's per-100g nutrients to a consumed gram amount. */
  scaleTo(food, grams) {
    const factor = grams / 100;
    const scaled = {};
    for (const [k, v] of Object.entries(food.nutrients)) {
      scaled[k] = Math.round(v * factor * 10) / 10;
    }
    return scaled;
  },
};
