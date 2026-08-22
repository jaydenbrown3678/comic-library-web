// ==========================================================
// ProgressStore — mirrors the iOS app's ReadingProgressStore
// protocol/SwiftDataReadingProgressStore, but backed by
// localStorage instead of SwiftData. Same shape of methods,
// same responsibilities: favorites, reading progress,
// completion history.
// ==========================================================

const STORAGE_KEY = "comicLibrary.progress";
const APPEARANCE_KEY = "comicLibrary.appearanceMode";

const ProgressStore = {
  _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  _writeAll(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },

  _entry(comicID) {
    const all = this._readAll();
    return all[comicID] || null;
  },

  _upsert(comicID, patch) {
    const all = this._readAll();
    const existing = all[comicID] || {
      lastPageIndex: 0,
      isFavorite: false,
      lastOpenedAt: null,
      isCompleted: false,
      completedAt: null,
    };
    all[comicID] = { ...existing, ...patch };
    this._writeAll(all);
    return all[comicID];
  },

  lastPageIndex(comicID) {
    const e = this._entry(comicID);
    return e ? e.lastPageIndex : null;
  },

  updateLastPage(comicID, pageIndex) {
    this._upsert(comicID, { lastPageIndex: pageIndex, lastOpenedAt: Date.now() });
  },

  isFavorite(comicID) {
    const e = this._entry(comicID);
    return e ? !!e.isFavorite : false;
  },

  toggleFavorite(comicID) {
    const e = this._entry(comicID);
    const current = e ? !!e.isFavorite : false;
    this._upsert(comicID, { isFavorite: !current });
  },

  favoriteComicIDs() {
    const all = this._readAll();
    return Object.keys(all).filter((id) => all[id].isFavorite);
  },

  // lastPageIndex > 0 excludes comics not yet opened past page one.
  // isCompleted === false excludes anything finished. Sorted
  // newest-opened-first, same as the iOS store's sort descriptor.
  continueReadingEntries() {
    const all = this._readAll();
    return Object.entries(all)
      .filter(([, e]) => e.lastPageIndex > 0 && !e.isCompleted)
      .sort((a, b) => (b[1].lastOpenedAt || 0) - (a[1].lastOpenedAt || 0))
      .map(([comicID, e]) => ({ comicID, lastPageIndex: e.lastPageIndex }));
  },

  removeFromContinueReading(comicID) {
    this._upsert(comicID, { lastPageIndex: 0 });
  },

  markCompleted(comicID) {
    this._upsert(comicID, { isCompleted: true, completedAt: Date.now() });
  },

  completedComicIDs() {
    const all = this._readAll();
    return Object.entries(all)
      .filter(([, e]) => e.isCompleted)
      .sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0))
      .map(([comicID]) => comicID);
  },
};

const AppearanceStore = {
  get() {
    return localStorage.getItem(APPEARANCE_KEY) || "system";
  },
  set(mode) {
    localStorage.setItem(APPEARANCE_KEY, mode);
  },
};