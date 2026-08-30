// db.js — thin promise wrapper around IndexedDB. Everything lives on-device.
const DB_NAME = 'gutsignal';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('foodCache')) {
        db.createObjectStore('foodCache', { keyPath: 'fdcId' });
      }
      if (!db.objectStoreNames.contains('meals')) {
        const store = db.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('symptoms')) {
        const store = db.createObjectStore('symptoms', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('checkins')) {
        const store = db.createObjectStore('checkins', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('customFoods')) {
        db.createObjectStore('customFoods', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrapReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DB = {
  // Generic helpers
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return wrapReq(store.put(value));
  },
  async get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.get(key));
  },
  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return wrapReq(store.delete(key));
  },
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.getAll());
  },
  async getAllByIndex(storeName, indexName) {
    const store = await tx(storeName, 'readonly');
    return wrapReq(store.index(indexName).getAll());
  },

  // Convenience typed accessors
  async getProfile() {
    return (await this.get('profile', 'me')) || null;
  },
  async saveProfile(profile) {
    profile.id = 'me';
    profile.updatedAt = Date.now();
    return this.put('profile', profile);
  },
  async getSetting(key) {
    const row = await this.get('settings', key);
    return row ? row.value : null;
  },
  async saveSetting(key, value) {
    return this.put('settings', { key, value });
  },

  async cacheFood(food) {
    food.cachedAt = Date.now();
    return this.put('foodCache', food);
  },
  async getCachedFood(fdcId) {
    return this.get('foodCache', fdcId);
  },
  async allCachedFoods() {
    return this.getAll('foodCache');
  },

  async addMeal(meal) {
    return this.put('meals', meal);
  },
  async allMeals() {
    const meals = await this.getAllByIndex('meals', 'timestamp');
    return meals.sort((a, b) => a.timestamp - b.timestamp);
  },
  async deleteMeal(id) {
    return this.delete('meals', id);
  },

  async addSymptom(symptom) {
    return this.put('symptoms', symptom);
  },
  async allSymptoms() {
    const rows = await this.getAllByIndex('symptoms', 'timestamp');
    return rows.sort((a, b) => a.timestamp - b.timestamp);
  },
  async deleteSymptom(id) {
    return this.delete('symptoms', id);
  },

  async addCheckin(checkin) {
    return this.put('checkins', checkin);
  },
  async allCheckins() {
    const rows = await this.getAllByIndex('checkins', 'date');
    return rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  },
  async checkinForDate(date) {
    const all = await this.allCheckins();
    return all.find((c) => c.date === date) || null;
  },

  async addCustomFood(food) {
    return this.put('customFoods', food);
  },
  async allCustomFoods() {
    return this.getAll('customFoods');
  },
  async deleteCustomFood(id) {
    return this.delete('customFoods', id);
  },
};
