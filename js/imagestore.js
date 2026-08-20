// ==========================================================
// ImageStore — stores actual uploaded image files in the
// browser's IndexedDB (built for storing files/blobs, unlike
// localStorage which is text-only and capped around 5-10MB).
//
// Images persist across reloads, tied to whichever comic they
// were uploaded for. No file paths, no JSON editing — the user
// just picks files and this handles the rest.
// ==========================================================

const DB_NAME = "comicLibraryImages";
const DB_VERSION = 1;
const STORE_NAME = "images";

// Resizes and re-compresses an image before it's ever stored.
// Uploaded files are often full-resolution phone photos (several MB
// each) — completely unnecessary for reading on a phone/laptop
// screen, and it's what makes IndexedDB storage, exported
// comics.json file size, and page-load time all balloon. Shrinking
// to a sensible max dimension and moderate JPEG quality cuts most
// images down to a fraction of their original size with no visible
// quality loss for this purpose.
function resizeImageFile(file, maxDimension = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectURL = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectURL);

      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas produced no blob"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error("Failed to load image for resizing"));
    };
    img.src = objectURL;
  });
}

let dbPromise = null;

function openImageDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

const ImageStore = {
  // Cover key: "<comicId>:cover"
  // Page key:  "<comicId>:page:<index>" (0-based)

  async putBlob(key, blob) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteKey(key) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Deletes every stored image (cover + all pages) belonging to one comic.
  async deleteAllForComic(comicId) {
    const db = await openImageDB();
    const all = await this.getAllEntries();
    const keysToDelete = all
      .map(([key]) => key)
      .filter((key) => key === `${comicId}:cover` || key.startsWith(`${comicId}:page:`));
    const tx = db.transaction(STORE_NAME, "readwrite");
    keysToDelete.forEach((key) => tx.objectStore(STORE_NAME).delete(key));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Returns every [key, blob] pair currently stored.
  async getAllEntries() {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const entries = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          entries.push([cursor.key, cursor.value]);
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  },
};

// In-memory map of key -> object URL, rebuilt from IndexedDB on
// startup and kept in sync as images are added/removed. Render
// functions read from this synchronously instead of awaiting
// IndexedDB on every single cover/page render.
const IMAGE_URLS = new Map();

async function loadAllImageURLs() {
  IMAGE_URLS.forEach((url) => URL.revokeObjectURL(url));
  IMAGE_URLS.clear();
  const entries = await ImageStore.getAllEntries();
  for (const [key, blob] of entries) {
    IMAGE_URLS.set(key, URL.createObjectURL(blob));
  }
}

function coverImageURL(comicId) {
  return IMAGE_URLS.get(`${comicId}:cover`) || null;
}

// Subcategory tiles (e.g. "Tigger" within "Winnie the Pooh") can have
// their own dedicated image, separate from any individual comic's
// cover — this key format mirrors that: "subcat::<category>::<name>".
function subcategoryCoverKey(category, name) {
  return `subcat::${category}::${name}:cover`;
}

function subcategoryCoverImageURL(category, name) {
  return IMAGE_URLS.get(subcategoryCoverKey(category, name)) || null;
}

// Returns an ordered array of page image URLs for a comic, or null
// if no pages have been uploaded yet.
function pageImageURLs(comicId, pageCount) {
  const urls = [];
  let hasAny = false;
  for (let i = 0; i < pageCount; i++) {
    const url = IMAGE_URLS.get(`${comicId}:page:${i}`);
    if (url) hasAny = true;
    urls.push(url || null);
  }
  return hasAny ? urls : null;
}

// Natural sort so "page2.jpg" sorts before "page10.jpg" (plain
// alphabetical sort would put page10 before page2).
function naturalSortFiles(files) {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
}
