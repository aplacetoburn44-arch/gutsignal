# GutSignal

A locally-hosted, on-device nutrition + symptom trigger tracker for mild Crohn's disease.
Everything (profile, meals, symptoms, stress, sleep) is stored in this browser's IndexedDB —
nothing is uploaded anywhere except food lookups to the USDA API.

## 1. Get a free USDA FoodData Central API key

Go to https://api.data.gov/signup and sign up (instant, free, no cost). Copy the key.

## 2. Get the app onto your phone

**Easiest: host it somewhere free and open it in Chrome on your phone.**

- GitHub Pages: push this folder to a GitHub repo, enable Pages, visit the URL on your phone.
- Or any static host (Netlify, Vercel, etc.) — it's a static site, no server/backend needed.

**Or run it locally first to try it on desktop:**

```
cd gutsignal
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in a browser.

## 3. Install it as an app on Android

1. Open the site in Chrome on your Android phone.
2. Tap the ⋮ menu → **"Add to Home screen"** / **"Install app"**.
3. It now opens full-screen from your home screen like a native app, and works offline
   after the first load (except food search, which needs a connection).

## 4. First-time setup in the app

- **Settings → USDA API key**: paste your key.
- **Settings → Profile**: enter sex, age, height, weight, activity level. This drives your
  calorie and nutrient targets (Mifflin-St Jeor + simplified DRI tables).

## 5. Daily use

- **Today**: quick daily check-in for stress and sleep, plus a 24h timeline of everything logged.
- **Meals**: search USDA Foundation Foods / SR Legacy (raw/whole ingredients), add with a
  gram amount, save the meal.
- **Symptoms**: log GI severity, pain scale + location, and notes, timestamped to now.
- **Trends**: 7-day nutrient averages vs. your targets, and the ingredient tolerance list —
  built from symptoms occurring 12–48h after a food was eaten.

## On the trigger scores — read this

The "tolerance engine" looks for symptoms in the 12–48h window after each food you ate, and
scores ingredients by how often a symptom followed. This is **pattern-surfacing, not
diagnosis**:

- Composite meals mean a flare gets partially attributed to everything you ate that day.
  Scores get more meaningful once you've eaten an ingredient several times in different
  combinations — that's why low-exposure ingredients are marked "insufficient data."
- Stress and poor sleep are real, common confounders for IBD symptoms. When a flare linked
  to a food coincided with a high-stress or poor-sleep day, the app flags it so you can
  weigh that score with appropriate skepticism.
- This tool doesn't replace your gastroenterologist or dietitian, especially before cutting
  foods out of your diet — nutritional adequacy matters as much as trigger avoidance.

## Data export

Settings → Export my data (JSON) gives you a full local backup any time — useful before
clearing browser data, switching phones, or sharing a summary with your care team.
