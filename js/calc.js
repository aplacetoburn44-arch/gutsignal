// calc.js — Mifflin-St Jeor BMR/TDEE and simplified USDA Dietary Reference Intake targets.
// DRI values here are common adult reference points (USDA/NIH DRI tables), simplified into
// age/sex bands. They're a reasonable target, not a substitute for a dietitian's individualized plan.

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

export function bmrMifflinStJeor({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function tdee(profile) {
  const bmr = bmrMifflinStJeor(profile);
  const mult = ACTIVITY_MULTIPLIERS[profile.activityLevel] || ACTIVITY_MULTIPLIERS.sedentary;
  return Math.round(bmr * mult);
}

/**
 * Simplified DRI targets. Macros are derived as AMDR (Acceptable Macronutrient
 * Distribution Range) midpoints applied to calorie target; select micronutrients
 * use standard adult RDA/AI bands by age+sex.
 */
export function driTargets(profile) {
  const calories = tdee(profile);
  const { sex, age } = profile;

  // Macros: protein 20%, carbs 50%, fat 30% of calories (reasonable mid-AMDR default)
  const protein_g = Math.round((calories * 0.2) / 4);
  const carbs_g = Math.round((calories * 0.5) / 4);
  const fat_g = Math.round((calories * 0.3) / 9);
  const fiber_g = age <= 50 ? (sex === 'male' ? 38 : 25) : (sex === 'male' ? 30 : 21);

  // Micronutrients (simplified adult RDA/AI bands, mg/mcg per day)
  const female = sex === 'female';
  const over50 = age > 50;

  const micros = {
    calcium_mg: over50 ? (female ? 1200 : 1000) : 1000,
    iron_mg: female && age <= 50 ? 18 : 8,
    magnesium_mg: female ? (age <= 30 ? 310 : 320) : (age <= 30 ? 400 : 420),
    zinc_mg: female ? 8 : 11,
    vitaminD_mcg: over50 ? 20 : 15,
    vitaminB12_mcg: 2.4,
    folate_mcg: 400,
    vitaminC_mg: female ? 75 : 90,
    sodium_mg_max: 2300,
    potassium_mg: female ? 2600 : 3400,
    vitaminA_mcg: female ? 700 : 900,
  };

  return { calories, protein_g, carbs_g, fat_g, fiber_g, ...micros };
}

export function sumNutrients(nutrientObjs) {
  const total = {};
  for (const obj of nutrientObjs) {
    for (const [k, v] of Object.entries(obj || {})) {
      total[k] = (total[k] || 0) + (Number(v) || 0);
    }
  }
  return total;
}
