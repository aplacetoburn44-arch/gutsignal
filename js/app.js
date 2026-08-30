import { DB } from './db.js';
import { USDA } from './usda.js';
import { driTargets, sumNutrients } from './calc.js';
import { computeTriggerScores, safetyLabel } from './correlation.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let profile = null;
let currentMealItems = []; // transient, before saving
let scaleValues = { stress: null, sleepQuality: null, severity: null, pain: null };

// ---------- Navigation ----------
function initNav() {
  $$('nav.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('nav.tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => v.classList.add('hidden'));
      $(`#view-${btn.dataset.view}`).classList.remove('hidden');
      if (btn.dataset.view === 'trends') renderTrends();
      if (btn.dataset.view === 'meals') renderMealHistory();
      if (btn.dataset.view === 'symptoms') renderSymptomHistory();
    });
  });
}

function initScale(containerId, key) {
  const container = $(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    Array.from(container.children).forEach((c) => c.classList.remove('selected'));
    btn.classList.add('selected');
    scaleValues[key] = Number(btn.dataset.v);
  });
}

// ---------- Today view ----------
function todayDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function renderToday() {
  $('#header-date').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const [meals, symptoms, checkins] = await Promise.all([DB.allMeals(), DB.allSymptoms(), DB.allCheckins()]);
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  renderTimeline(
    meals.filter((m) => m.timestamp >= dayAgo),
    symptoms.filter((s) => s.timestamp >= dayAgo),
    checkins.filter((c) => c.date === todayDateKey())
  );

  // Today's calories
  const todaysMeals = meals.filter((m) => todayDateKey(new Date(m.timestamp)) === todayDateKey());
  const totals = sumNutrients(todaysMeals.map((m) => m.totalNutrients));
  const target = profile ? driTargets(profile).calories : null;

  if (target) {
    const pct = Math.min(100, Math.round(((totals.calories || 0) / target) * 100));
    $('#today-cal-stat').textContent = `${Math.round(totals.calories || 0)} / ${target} kcal`;
    $('#today-cal-bar').style.width = pct + '%';
    $('#today-cal-bar').classList.toggle('over', (totals.calories || 0) > target * 1.1);
    $('#today-cal-pill').textContent = pct >= 90 && pct <= 110 ? 'On target' : pct < 90 ? 'Under' : 'Over';
  } else {
    $('#today-cal-stat').textContent = 'Set up your profile in Settings';
    $('#today-cal-pill').textContent = '—';
  }

  const targets2 = profile ? driTargets(profile) : null;
  $('#today-protein-stat').textContent = targets2
    ? `${Math.round(totals.protein || 0)} / ${targets2.protein_g}g`
    : `${Math.round(totals.protein || 0)}g`;
  $('#today-fiber-stat').textContent = targets2
    ? `${Math.round(totals.fiber || 0)} / ${targets2.fiber_g}g`
    : `${Math.round(totals.fiber || 0)}g`;

  // Today's meal list
  const list = $('#today-meals-list');
  if (todaysMeals.length === 0) {
    list.innerHTML = '<div class="empty-state">No meals logged yet today.</div>';
  } else {
    list.innerHTML = todaysMeals
      .map(
        (m) => `<div class="meal-item-row"><span>${m.mealType} · ${m.items.length} item(s)</span>
        <span>${Math.round(m.totalNutrients.calories || 0)} kcal</span></div>`
      )
      .join('');
  }

  // Existing check-in for today
  const todayCheckin = checkins.find((c) => c.date === todayDateKey());
  if (todayCheckin) {
    $('#checkin-status').textContent = `Saved for today: stress ${todayCheckin.stress}/5, sleep quality ${todayCheckin.sleepQuality}/5, ${todayCheckin.sleepHours ?? '?'}h.`;
  }
}

function renderTimeline(meals, symptoms, checkins) {
  const el = $('#timeline');
  el.innerHTML = '';
  const now = Date.now();
  const start = now - 24 * 60 * 60 * 1000;

  for (let h = 0; h <= 24; h += 6) {
    const tick = document.createElement('div');
    tick.className = 'hour-tick';
    tick.style.left = (h / 24) * 100 + '%';
    el.appendChild(tick);
  }

  const place = (ts, cls, title) => {
    const pct = ((ts - start) / (now - start)) * 100;
    if (pct < 0 || pct > 100) return;
    const dot = document.createElement('div');
    dot.className = 'dot ' + cls;
    dot.style.left = pct + '%';
    dot.title = title;
    el.appendChild(dot);
  };

  meals.forEach((m) => place(m.timestamp, 'meal', `${m.mealType} at ${new Date(m.timestamp).toLocaleTimeString()}`));
  symptoms.forEach((s) => place(s.timestamp, 'symptom', `Symptom (severity ${s.severity}) at ${new Date(s.timestamp).toLocaleTimeString()}`));
  checkins.forEach(() => place(now - 60 * 60 * 1000, 'checkin', 'Daily check-in'));

  if (meals.length + symptoms.length === 0) {
    el.innerHTML += '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">Nothing logged in the last 24h</div>';
  }
}

async function saveCheckin() {
  if (scaleValues.stress == null || scaleValues.sleepQuality == null) {
    $('#checkin-status').textContent = 'Pick a stress and sleep quality value first.';
    return;
  }
  await DB.addCheckin({
    date: todayDateKey(),
    stress: scaleValues.stress,
    sleepQuality: scaleValues.sleepQuality,
    sleepHours: $('#sleep-hours').value ? Number($('#sleep-hours').value) : null,
    notes: $('#checkin-notes').value.trim(),
    timestamp: Date.now(),
  });
  $('#checkin-status').textContent = 'Saved today\u2019s check-in.';
  renderToday();
}

// ---------- Meals view ----------
let searchDebounce = null;
function initFoodSearch() {
  $('#food-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#food-results').innerHTML = ''; return; }
    searchDebounce = setTimeout(() => runFoodSearch(q), 400);
  });
}

async function runFoodSearch(query) {
  const box = $('#food-results');
  box.innerHTML = '<p style="font-size:0.85rem;color:var(--ink-muted)">Searching…</p>';
  try {
    const results = await USDA.search(query);
    if (results.length === 0) {
      box.innerHTML = '<p style="font-size:0.85rem;color:var(--ink-muted)">No matches. Try a simpler/raw term.</p>';
      return;
    }
    box.innerHTML = results
      .map(
        (f, i) => `<div class="food-result-wrap" data-wrap="${i}">
          <div class="food-result">
            <div><div>${f.description}</div><div class="meta">${f.dataType} · ${Math.round(f.nutrients.calories || 0)} kcal/100g</div></div>
            <button class="ghost" data-idx="${i}">+ Add</button>
          </div>
          <div class="serving-picker hidden" data-picker="${i}"></div>
        </div>`
      )
      .join('');
    box.querySelectorAll('button[data-idx]').forEach((btn) => {
      btn.addEventListener('click', () => openServingPicker(box, results[Number(btn.dataset.idx)], Number(btn.dataset.idx)));
    });
  } catch (err) {
    box.innerHTML = `<p style="font-size:0.85rem;color:var(--danger)">${err.message}</p>`;
  }
}

async function openServingPicker(box, searchResult, idx) {
  const picker = box.querySelector(`[data-picker="${idx}"]`);
  picker.classList.remove('hidden');
  picker.innerHTML = '<p style="font-size:0.82rem;color:var(--ink-muted)">Loading serving sizes…</p>';

  let food;
  try {
    food = await USDA.getFood(searchResult.fdcId); // fetches full detail incl. portions, caches locally
  } catch (err) {
    picker.innerHTML = `<p style="font-size:0.82rem;color:var(--danger)">${err.message}</p>`;
    return;
  }
  renderServingPickerUI(picker, food);
}

function renderServingPickerUI(picker, food) {
  const portionOptions = (food.portions || [])
    .map((p, i) => `<option value="${i}">${p.label} (${Math.round(p.grams)}g)</option>`)
    .join('');

  picker.innerHTML = `
    <label>Amount</label>
    <select class="serving-select">
      ${portionOptions}
      <option value="custom">Custom amount (grams)</option>
    </select>
    <div class="serving-grams-row hidden">
      <label>Grams</label>
      <input type="number" class="serving-grams" min="1" placeholder="e.g. 100" />
    </div>
    <button class="full serving-confirm">Add to meal</button>
  `;

  const select = picker.querySelector('.serving-select');
  const gramsRow = picker.querySelector('.serving-grams-row');
  const gramsInput = picker.querySelector('.serving-grams');
  const hasPortions = (food.portions || []).length > 0;

  const syncVisibility = () => {
    const isCustom = select.value === 'custom' || !hasPortions;
    gramsRow.classList.toggle('hidden', !isCustom);
  };
  if (!hasPortions) select.value = 'custom';
  syncVisibility();
  select.addEventListener('change', syncVisibility);

  picker.querySelector('.serving-confirm').addEventListener('click', () => {
    let grams;
    if (select.value === 'custom' || !hasPortions) {
      grams = Number(gramsInput.value);
    } else {
      grams = food.portions[Number(select.value)].grams;
    }
    if (!grams || grams <= 0) {
      gramsRow.classList.remove('hidden');
      gramsInput.style.outline = '2px solid var(--danger)';
      return;
    }
    currentMealItems.push({
      fdcId: food.fdcId,
      description: food.description,
      grams,
      nutrients: USDA.scaleTo(food, grams),
    });
    renderCurrentMeal();
    picker.classList.add('hidden');
    picker.innerHTML = '';
  });
}

function renderCurrentMeal() {
  const list = $('#current-meal-items');
  $('#meal-item-count').textContent = currentMealItems.length;
  $('#save-meal').disabled = currentMealItems.length === 0;
  if (currentMealItems.length === 0) {
    list.innerHTML = '<div class="empty-state">Search and add foods above.</div>';
    return;
  }
  list.innerHTML = currentMealItems
    .map(
      (it, i) => `<div class="meal-item-row"><span>${it.description} (${it.grams}g)</span>
      <span>${Math.round(it.nutrients.calories || 0)} kcal <button class="ghost" data-remove="${i}">✕</button></span></div>`
    )
    .join('');
  list.querySelectorAll('button[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentMealItems.splice(Number(btn.dataset.remove), 1);
      renderCurrentMeal();
    });
  });
}

async function saveMeal() {
  if (currentMealItems.length === 0) return;
  const meal = {
    timestamp: Date.now(),
    mealType: $('#meal-type').value,
    items: currentMealItems,
    totalNutrients: sumNutrients(currentMealItems.map((i) => i.nutrients)),
  };
  await DB.addMeal(meal);
  currentMealItems = [];
  renderCurrentMeal();
  $('#food-results').innerHTML = '';
  $('#food-search').value = '';
  renderMealHistory();
  renderToday();
}

// ---------- Custom foods (label photo) ----------
let pendingPhotoDataUrl = null;

function initCustomPhoto() {
  $('#custom-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhotoDataUrl = await compressImageToDataUrl(file, 640, 0.6);
    const preview = $('#custom-photo-preview');
    preview.src = pendingPhotoDataUrl;
    preview.classList.remove('hidden');
  });
}

/** Downscale + JPEG-compress a photo before storing, so IndexedDB doesn't bloat. */
function compressImageToDataUrl(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveCustomFood() {
  const name = $('#custom-name').value.trim();
  const gramsPerServing = Number($('#custom-serving-grams').value);
  if (!name || !gramsPerServing) {
    $('#custom-food-status').textContent = 'Food name and grams-per-serving are required.';
    return;
  }
  const perServing = {
    calories: Number($('#cf-calories').value) || 0,
    protein: Number($('#cf-protein').value) || 0,
    carbs: Number($('#cf-carbs').value) || 0,
    fat: Number($('#cf-fat').value) || 0,
    fiber: Number($('#cf-fiber').value) || 0,
    sugars: Number($('#cf-sugars').value) || 0,
    sodium: Number($('#cf-sodium').value) || 0,
    calcium: Number($('#cf-calcium').value) || 0,
    iron: Number($('#cf-iron').value) || 0,
  };
  // Store as per-100g so it plugs into the same scaling math as USDA foods.
  const factor = 100 / gramsPerServing;
  const nutrientsPer100g = {};
  for (const [k, v] of Object.entries(perServing)) nutrientsPer100g[k] = Math.round(v * factor * 10) / 10;

  await DB.addCustomFood({
    name,
    servingLabel: $('#custom-serving-label').value.trim() || '1 serving',
    gramsPerServing,
    nutrientsPer100g,
    photo: pendingPhotoDataUrl,
    createdAt: Date.now(),
  });

  $('#custom-food-status').textContent = `Saved "${name}".`;
  ['custom-name', 'custom-serving-label', 'custom-serving-grams', 'cf-calories', 'cf-protein', 'cf-carbs', 'cf-fat', 'cf-fiber', 'cf-sugars', 'cf-sodium', 'cf-calcium', 'cf-iron']
    .forEach((id) => { $('#' + id).value = ''; });
  $('#custom-photo').value = '';
  $('#custom-photo-preview').classList.add('hidden');
  pendingPhotoDataUrl = null;
  renderCustomFoodList();
}

async function renderCustomFoodList() {
  const foods = await DB.allCustomFoods();
  const box = $('#custom-food-list');
  if (foods.length === 0) {
    box.innerHTML = '<div class="empty-state">None saved yet.</div>';
    return;
  }
  box.innerHTML = foods
    .map(
      (f) => `<div class="food-result-wrap" data-cwrap="${f.id}">
        <div class="food-result">
          <div><div>${f.name}</div><div class="meta">${f.servingLabel} · ${Math.round((f.nutrientsPer100g.calories || 0) * f.gramsPerServing / 100)} kcal/serving</div></div>
          <button class="ghost" data-cidx="${f.id}">+ Add</button>
        </div>
        <div class="serving-picker hidden" data-cpicker="${f.id}"></div>
      </div>`
    )
    .join('');
  box.querySelectorAll('button[data-cidx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = foods.find((x) => x.id === Number(btn.dataset.cidx));
      const picker = box.querySelector(`[data-cpicker="${f.id}"]`);
      picker.classList.remove('hidden');
      renderServingPickerUI(picker, {
        fdcId: `custom-${f.id}`,
        description: f.name,
        nutrients: f.nutrientsPer100g,
        portions: [{ label: f.servingLabel, grams: f.gramsPerServing }],
      });
    });
  });
}

async function renderMealHistory() {
  const meals = (await DB.allMeals()).slice().reverse().slice(0, 30);
  const box = $('#meal-history');
  if (meals.length === 0) { box.innerHTML = '<div class="empty-state">No meals logged yet.</div>'; return; }
  box.innerHTML = meals
    .map(
      (m) => `<div class="meal-item-row"><span>${new Date(m.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${m.mealType}</span>
      <span>${Math.round(m.totalNutrients.calories || 0)} kcal · ${m.items.length} item(s)</span></div>`
    )
    .join('');
}

// ---------- Symptoms view ----------
async function saveSymptom() {
  if (scaleValues.severity == null) {
    $('#symptom-status').textContent = 'Pick a GI severity value first.';
    return;
  }
  await DB.addSymptom({
    timestamp: Date.now(),
    severity: scaleValues.severity,
    pain: scaleValues.pain ?? 0,
    painLocation: $('#pain-location').value.trim(),
    notes: $('#symptom-notes').value.trim(),
  });
  $('#symptom-status').textContent = 'Symptom logged.';
  $('#pain-location').value = '';
  $('#symptom-notes').value = '';
  renderSymptomHistory();
  renderToday();
}

async function renderSymptomHistory() {
  const symptoms = (await DB.allSymptoms()).slice().reverse().slice(0, 30);
  const box = $('#symptom-history');
  if (symptoms.length === 0) { box.innerHTML = '<div class="empty-state">No symptoms logged yet.</div>'; return; }
  box.innerHTML = symptoms
    .map(
      (s) => `<div class="meal-item-row"><span>${new Date(s.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      <span>GI ${s.severity}/10 · Pain ${s.pain}/10${s.painLocation ? ' · ' + s.painLocation : ''}</span></div>`
    )
    .join('');
}

// ---------- Trends view ----------
async function renderTrends() {
  const meals = await DB.allMeals();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentMeals = meals.filter((m) => m.timestamp >= weekAgo);
  const days = new Set(recentMeals.map((m) => todayDateKey(new Date(m.timestamp)))).size || 1;
  const totals = sumNutrients(recentMeals.map((m) => m.totalNutrients));

  const nutrientBox = $('#nutrient-trends');
  if (!profile) {
    nutrientBox.innerHTML = '<div class="empty-state">Set up your profile in Settings first.</div>';
  } else if (recentMeals.length === 0) {
    nutrientBox.innerHTML = '<div class="empty-state">Log meals to see nutrient trends.</div>';
  } else {
    const targets = driTargets(profile);
    const rows = [
      ['Calories', totals.calories, targets.calories, ''],
      ['Protein', totals.protein, targets.protein_g, 'g'],
      ['Carbs', totals.carbs, targets.carbs_g, 'g'],
      ['Fat', totals.fat, targets.fat_g, 'g'],
      ['Fiber', totals.fiber, targets.fiber_g, 'g'],
      ['Calcium', totals.calcium, targets.calcium_mg, 'mg'],
      ['Iron', totals.iron, targets.iron_mg, 'mg'],
      ['Vitamin D', totals.vitaminD, targets.vitaminD_mcg, 'mcg'],
      ['Vitamin B12', totals.vitaminB12, targets.vitaminB12_mcg, 'mcg'],
      ['Folate', totals.folate, targets.folate_mcg, 'mcg'],
      ['Potassium', totals.potassium, targets.potassium_mg, 'mg'],
      ['Vitamin A', totals.vitaminA, targets.vitaminA_mcg, 'mcg'],
    ];
    nutrientBox.innerHTML = rows
      .map(([name, actualTotal, target, unit]) => {
        const avg = (actualTotal || 0) / days;
        const pct = target ? Math.min(140, Math.round((avg / target) * 100)) : 0;
        return `<div style="margin-bottom:10px;">
          <div class="row between"><span style="font-size:0.85rem;">${name}</span><span style="font-size:0.8rem;color:var(--ink-muted)">${Math.round(avg)}${unit} / ${target}${unit}</span></div>
          <div class="bar-track"><div class="bar-fill ${pct > 130 ? 'over' : ''}" style="width:${Math.min(100, pct)}%"></div></div>
        </div>`;
      })
      .join('');
  }

  const symptoms = await DB.allSymptoms();
  const checkins = await DB.allCheckins();
  const scores = computeTriggerScores(meals, symptoms, checkins).filter((r) => r.exposures >= 1);
  const triggerBox = $('#trigger-list');
  if (scores.length === 0) {
    triggerBox.innerHTML = '<div class="empty-state">Keep logging meals and symptoms to build this out.</div>';
    return;
  }
  triggerBox.innerHTML = scores
    .slice(0, 25)
    .map((r) => {
      const label = safetyLabel(r);
      return `<div class="meal-item-row" style="display:block;padding:10px 0;">
        <div class="row between">
          <span>${r.description}</span>
          <span class="pill ${label.tone}">${label.label}</span>
        </div>
        <div style="font-size:0.75rem;color:var(--ink-muted);margin-top:2px;">
          ${r.flares}/${r.exposures} exposures followed by a symptom (${r.confidence} confidence)
          ${r.note ? '<br>' + r.note : ''}
        </div>
      </div>`;
    })
    .join('');
}

// ---------- Settings ----------
async function loadProfileIntoForm() {
  profile = await DB.getProfile();
  if (profile) {
    $('#p-sex').value = profile.sex;
    $('#p-age').value = profile.age;
    $('#p-height').value = profile.heightCm;
    $('#p-weight').value = profile.weightKg;
    $('#p-activity').value = profile.activityLevel;
  }
  const key = await DB.getSetting('usdaApiKey');
  if (key) $('#usda-key').value = key;
}

async function saveProfile() {
  const p = {
    sex: $('#p-sex').value,
    age: Number($('#p-age').value),
    heightCm: Number($('#p-height').value),
    weightKg: Number($('#p-weight').value),
    activityLevel: $('#p-activity').value,
  };
  if (!p.age || !p.heightCm || !p.weightKg) {
    $('#profile-status').textContent = 'Fill in age, height, and weight.';
    return;
  }
  await DB.saveProfile(p);
  profile = p;
  $('#profile-status').textContent = 'Profile saved.';
  renderToday();
}

async function saveKey() {
  const key = $('#usda-key').value.trim();
  if (!key) return;
  await DB.saveSetting('usdaApiKey', key);
  $('#key-status').textContent = 'Key saved on this device.';
}

async function exportData() {
  const [p, meals, symptoms, checkins, customFoods] = await Promise.all([
    DB.getProfile(), DB.allMeals(), DB.allSymptoms(), DB.allCheckins(), DB.allCustomFoods(),
  ]);
  const blob = new Blob([JSON.stringify({ profile: p, meals, symptoms, checkins, customFoods }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gutsignal-export-${todayDateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Init ----------
async function init() {
  initNav();
  initScale('#stress-scale', 'stress');
  initScale('#sleep-quality-scale', 'sleepQuality');
  initScale('#severity-scale', 'severity');
  initScale('#pain-scale', 'pain');
  initFoodSearch();
  initCustomPhoto();

  $('#save-checkin').addEventListener('click', saveCheckin);
  $('#save-meal').addEventListener('click', saveMeal);
  $('#save-symptom').addEventListener('click', saveSymptom);
  $('#save-profile').addEventListener('click', saveProfile);
  $('#save-key').addEventListener('click', saveKey);
  $('#export-data').addEventListener('click', exportData);
  $('#save-custom-food').addEventListener('click', saveCustomFood);

  await loadProfileIntoForm();
  await renderToday();
  await renderMealHistory();
  await renderSymptomHistory();
  await renderCustomFoodList();
}

init();
