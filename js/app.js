// ==========================================================
// Buddha's Comic Library — Web
// Mirrors the iOS app's architecture: a data layer (comics.json,
// same shape as the Swift manifest), a "ViewModel"-ish layer
// (grouping/search/continue-reading logic), and render functions
// standing in for SwiftUI Views.
// ==========================================================

let ALL_COMICS = [];
let currentReaderComic = null;
let currentReaderPage = 0;

// ---------- Page range expansion (mirrors iOS PageRange) ----------

// Expands a condensed range description into the full ordered list
// of image paths, instead of requiring every page listed by hand.
// Example range: { folder: "images/pages/little-nemo-1905",
//                   prefix: "page-", start: 1, end: 3,
//                   extension: "jpg", padding: 1 }
// expands to:
//   images/pages/little-nemo-1905/page-1.jpg
//   images/pages/little-nemo-1905/page-2.jpg
//   images/pages/little-nemo-1905/page-3.jpg
function expandPageRange(range) {
  const { folder, prefix = "", start, end, extension = "jpg", padding = 1 } = range;
  if (start > end) return [];
  const paths = [];
  for (let n = start; n <= end; n++) {
    const padded = String(n).padStart(padding, "0");
    paths.push(`${folder}/${prefix}${padded}.${extension}`);
  }
  return paths;
}

// Resolves a comic's page images, in priority order:
// 1. Images actually uploaded via "Manage Images" (IndexedDB) — the
//    normal path for most users now.
// 2. An explicit `pageImages` array in comics.json (full manual
//    control via file paths — still supported for advanced users).
// 3. `pageImageRanges` in comics.json (condensed path-based ranges).
// 4. null — the reader falls back to plain "Page N" placeholders.
function resolvePageImages(comic) {
  const uploaded = pageImageURLs(comic.id, comic.pageCount);
  if (uploaded) return uploaded;

  if (Array.isArray(comic.pageImages) && comic.pageImages.length) {
    return comic.pageImages;
  }
  if (Array.isArray(comic.pageImageRanges)) {
    return comic.pageImageRanges.flatMap(expandPageRange);
  }
  return null;
}

const COLOR_NAME_MAP = {
  red: "highlight",
  yellow: "accent",
  blue: "secondary-highlight",
  green: "green",
  purple: "purple",
  orange: "orange",
  pink: "pink",
};

function resolveAccentVar(colorName) {
  const mapped = colorName ? COLOR_NAME_MAP[colorName.toLowerCase()] : null;
  return mapped ? `var(--${mapped})` : null;
}

// ---------- Data / grouping (mirrors LibraryViewModel) ----------

async function loadComics() {
  const res = await fetch("data/comics.json");
  ALL_COMICS = await res.json();
}

function comicsByCategory() {
  const byCategory = {};
  for (const comic of ALL_COMICS) {
    (byCategory[comic.category] ||= []).push(comic);
  }
  return Object.keys(byCategory)
    .sort((a, b) => a.localeCompare(b))
    .map((category) => {
      const comicsInCategory = byCategory[category];
      const direct = comicsInCategory.filter((c) => !c.subcategory);
      const bySub = {};
      comicsInCategory
        .filter((c) => c.subcategory)
        .forEach((c) => (bySub[c.subcategory] ||= []).push(c));
      const subcategories = Object.keys(bySub)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, comics: bySub[name] }));
      const colorOverride = comicsInCategory.find((c) => c.categoryColor)?.categoryColor || null;
      return { category, direct, subcategories, colorOverride };
    });
}

function favoriteComics() {
  const ids = new Set(ProgressStore.favoriteComicIDs());
  return ALL_COMICS.filter((c) => ids.has(c.id));
}

function continueReadingItems() {
  const byId = Object.fromEntries(ALL_COMICS.map((c) => [c.id, c]));
  return ProgressStore.continueReadingEntries()
    .map((e) => {
      const comic = byId[e.comicID];
      if (!comic) return null;
      if (e.lastPageIndex >= comic.pageCount - 1) return null; // finished
      return { comic, lastPageIndex: e.lastPageIndex, progress: (e.lastPageIndex + 1) / comic.pageCount };
    })
    .filter(Boolean);
}

function historyComics() {
  const byId = Object.fromEntries(ALL_COMICS.map((c) => [c.id, c]));
  return ProgressStore.completedComicIDs().map((id) => byId[id]).filter(Boolean);
}

function searchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_COMICS.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      (c.subcategory && c.subcategory.toLowerCase().includes(q))
  );
}

// ---------- Cover rendering (mirrors ComicCoverCell) ----------

function coverArtHTML(comic) {
  const uploadedURL = coverImageURL(comic.id);
  const src = uploadedURL || comic.coverImage;
  if (src) {
    return `<img class="cover-img" src="${src}" alt="${escapeHTML(comic.title)}" data-fallback-title="${escapeHTML(comic.title)}" loading="lazy" onerror="handleCoverImgError(this)">`;
  }
  return `<div class="cover-art">${escapeHTML(comic.title)}</div>`;
}

// If a real cover image fails to load (missing file, bad path), fall
// back to the text-placeholder look instead of showing a broken-image
// icon. Reads the title from a data attribute so we never have to
// hand-build a JS string with the title embedded in it (which risks
// breaking on titles containing quotes).
function handleCoverImgError(imgEl) {
  const placeholder = document.createElement("div");
  placeholder.className = "cover-art";
  placeholder.textContent = imgEl.dataset.fallbackTitle || "";
  imgEl.replaceWith(placeholder);
}

function renderCoverCell(comic, { accentVar = null, progress = null } = {}) {
  const isFav = ProgressStore.isFavorite(comic.id);
  const style = accentVar ? ` style="--cover-accent:${accentVar}"` : "";
  return `
    <div class="cover-cell">
      <a href="#/comic/${comic.id}" class="cover-art-wrap pressable" data-comic-id="${comic.id}">
        ${coverArtHTML(comic)}
        <div class="cover-outline"${style}></div>
        ${isFav ? `<div class="cover-fav-badge">${ICONS.star}</div>` : ""}
        ${
          progress !== null
            ? `<div class="cover-progress-track"><div class="cover-progress-fill"${style} style="width:${Math.min(100, Math.max(0, progress * 100))}%"></div></div>`
            : ""
        }
      </a>
      <div class="cover-title">${escapeHTML(comic.title)}</div>
      <div class="cover-meta">${escapeHTML(comic.author)} · ${comic.year}</div>
    </div>`;
}

function renderSubcategoryTile(category, sub, accentVar) {
  const rep = sub.comics.find((c) => c.isSubcategoryCover) || sub.comics[0];
  const style = accentVar ? ` style="--cover-accent:${accentVar}"` : "";
  // Priority for the tile's art: a dedicated image uploaded just for
  // this subcategory (live, this browser) → an embedded dedicated
  // image baked in during a prior export (works for any visitor) →
  // falls back to reusing the representative comic's own cover.
  const dedicatedURL = subcategoryCoverImageURL(category, sub.name) || rep.subcategoryCoverImage;
  const artHTML = dedicatedURL
    ? `<img class="cover-img" src="${dedicatedURL}" alt="${escapeHTML(sub.name)}" data-fallback-title="${escapeHTML(sub.name)}" loading="lazy" onerror="handleCoverImgError(this)">`
    : coverArtHTML(rep);
  return `
    <div class="cover-cell">
      <a href="#/subcategory/${encodeURIComponent(category)}/${encodeURIComponent(sub.name)}" class="cover-art-wrap pressable">
        ${artHTML}
        <div class="cover-outline"${style}></div>
        <div class="count-badge"${style}>${sub.comics.length}</div>
      </a>
      <div class="cover-title">${escapeHTML(sub.name)}</div>
      <div class="cover-meta">${sub.comics.length} stories</div>
    </div>`;
}

function renderContinueReadingCell(item) {
  return `
    <div class="cover-cell">
      <a href="#/comic/${item.comic.id}" class="cover-art-wrap pressable">
        ${coverArtHTML(item.comic)}
        <div class="cover-outline"></div>
        <div class="cover-progress-track"><div class="cover-progress-fill" style="width:${item.progress * 100}%"></div></div>
      </a>
      <div class="cover-actions">
        <button class="pressable" data-action="complete" data-id="${item.comic.id}" style="color:var(--accent)" aria-label="Mark as completed">${ICONS.check}</button>
        <button class="pressable" data-action="remove" data-id="${item.comic.id}" style="color:var(--highlight)" aria-label="Remove from Continue Reading">${ICONS.xCircle}</button>
      </div>
    </div>`;
}

// ---------- Screens ----------

function renderLibrary() {
  const container = document.getElementById("main-content");
  document.getElementById("search-input").style.display = "";

  if (ALL_COMICS.length === 0) {
    container.innerHTML = emptyStateHTML(ICONS.emptyBook, "No Comics Yet", "Add comics to the manifest to see them here.");
    return;
  }

  const cr = continueReadingItems();
  const favs = favoriteComics();
  const categories = comicsByCategory();

  let html = `<div class="hairline"></div>`;

  if (cr.length) {
    html += `
      <div class="shelf stagger-in">
        <div class="shelf-header"><div class="shelf-title" style="color:var(--accent)">Continue Reading</div></div>
        <div class="shelf-scroll">${cr.map(renderContinueReadingCell).join("")}</div>
        <div class="hairline" style="margin-top:14px"></div>
      </div>`;
  }

  if (favs.length) {
    html += `
      <div class="shelf stagger-in">
        <div class="shelf-header"><div class="shelf-title" style="color:var(--highlight)">Favorites</div></div>
        <div class="shelf-scroll">${favs.map((c) => renderCoverCell(c, { accentVar: "var(--highlight)" })).join("")}</div>
        <div class="hairline" style="margin-top:14px"></div>
      </div>`;
  }

  categories.forEach((group, i) => {
    const accentVar = resolveAccentVar(group.colorOverride) || (i % 2 === 0 ? "var(--secondary-highlight)" : "var(--accent)");
    const tiles = [
      ...group.direct.map((c) => renderCoverCell(c, { accentVar })),
      ...group.subcategories.map((s) => renderSubcategoryTile(group.category, s, accentVar)),
    ].join("");
    html += `
      <div class="shelf stagger-in">
        <div class="shelf-header">
          <div class="shelf-title" style="color:${accentVar}">${escapeHTML(group.category)}</div>
          <a class="shelf-seeall" href="#/category/${encodeURIComponent(group.category)}">See All</a>
        </div>
        <div class="shelf-scroll">${tiles}</div>
        <div class="hairline" style="margin-top:14px"></div>
      </div>`;
  });

  container.innerHTML = html;
  attachContinueReadingHandlers();
}

function renderCategoryGrid(categoryName) {
  document.getElementById("search-input").style.display = "none";
  const group = comicsByCategory().find((g) => g.category === categoryName);
  const container = document.getElementById("main-content");
  if (!group) {
    container.innerHTML = emptyStateHTML(ICONS.emptyBook, "Not Found", "This category doesn't exist.");
    return;
  }
  const accentVar = resolveAccentVar(group.colorOverride) || "var(--accent)";
  const tiles = [
    ...group.direct.map((c) => renderCoverCell(c, { accentVar })),
    ...group.subcategories.map((s) => renderSubcategoryTile(group.category, s, accentVar)),
  ].join("");
  container.innerHTML = `
    ${backHeaderHTML(group.category.toUpperCase())}
    <div class="grid-view">${tiles}</div>`;
}

function renderSubcategoryGrid(categoryName, subName) {
  document.getElementById("search-input").style.display = "none";
  const group = comicsByCategory().find((g) => g.category === categoryName);
  const sub = group?.subcategories.find((s) => s.name === subName);
  const container = document.getElementById("main-content");
  if (!sub) {
    container.innerHTML = emptyStateHTML(ICONS.emptyBook, "Not Found", "This subcategory doesn't exist.");
    return;
  }
  container.innerHTML = `
    ${backHeaderHTML(subName.toUpperCase())}
    <div class="grid-view">${sub.comics.map((c) => renderCoverCell(c, { accentVar: "var(--accent)" })).join("")}</div>`;
}

function renderSearch(query) {
  const container = document.getElementById("main-content");
  const results = searchResults(query);
  if (!results.length) {
    container.innerHTML = emptyStateHTML(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
      "No Results",
      `No comics match "${escapeHTML(query)}."`
    );
    return;
  }
  container.innerHTML = `<div class="grid-view">${results.map((c) => renderCoverCell(c, { accentVar: "var(--accent)" })).join("")}</div>`;
}

function backHeaderHTML(title) {
  return `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 16px 12px;">
      <a href="#/" class="icon-button pressable" style="width:30px;height:30px;">${ICONS.chevronLeft}</a>
      <div style="font-weight:800;font-size:15px;letter-spacing:1px;">${title}</div>
    </div>`;
}

function emptyStateHTML(iconSVG, title, message) {
  return `<div class="empty-state">${iconSVG}<h3>${title}</h3><p>${message}</p></div>`;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Continue Reading actions ----------

function attachContinueReadingHandlers() {
  document.querySelectorAll('[data-action="complete"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      ProgressStore.markCompleted(btn.dataset.id);
      renderLibrary();
    });
  });
  document.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      ProgressStore.removeFromContinueReading(btn.dataset.id);
      renderLibrary();
    });
  });
}

// ---------- Reader ----------

function openReader(comicId) {
  const comic = ALL_COMICS.find((c) => c.id === comicId);
  if (!comic) return;
  currentReaderComic = comic;
  const saved = ProgressStore.lastPageIndex(comicId);
  currentReaderPage = saved != null ? Math.min(saved, comic.pageCount - 1) : 0;

  const pages = Array.from({ length: comic.pageCount }, (_, i) => i);
  const resolvedPageImages = resolvePageImages(comic);
  const view = document.getElementById("reader-view");
  view.innerHTML = `
    <div class="reader-nav">
      <button class="icon-button pressable" id="reader-close">${ICONS.chevronLeft}</button>
      <div class="reader-nav-title">${escapeHTML(comic.title)}</div>
      <div class="reader-nav-actions">
        <button class="icon-button pressable" id="reader-zoom-out">${ICONS.zoomOut}</button>
        <button class="icon-button pressable" id="reader-zoom-in">${ICONS.zoomIn}</button>
        <button class="icon-button pressable" id="reader-info">${ICONS.info}</button>
        <button class="icon-button pressable" id="reader-fav">${ProgressStore.isFavorite(comicId) ? ICONS.star : ICONS.starOutline}</button>
      </div>
    </div>
    <div class="reader-page-stage" id="reader-stage">
      <div class="reader-track" id="reader-track">
        ${pages
          .map((p) => {
            const src = resolvedPageImages && resolvedPageImages[p];
            const content = src
              ? `<img class="reader-page-img" src="${src}" alt="Page ${p + 1}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'reader-page-content',textContent:'Page ${p + 1} (image not found)'}))">`
              : `<div class="reader-page-content">Page ${p + 1}</div>`;
            return `<div class="reader-page">${content}</div>`;
          })
          .join("")}
      </div>
    </div>
    <div class="reader-counter" id="reader-counter">PAGE ${currentReaderPage + 1} OF ${comic.pageCount}</div>
    <button class="reader-arrow reader-arrow-left" id="reader-arrow-left" aria-label="Previous page">${ICONS.chevronLeft}</button>
    <button class="reader-arrow reader-arrow-right" id="reader-arrow-right" aria-label="Next page">${ICONS.chevronRight}</button>
  `;
  view.style.display = "flex";
  document.body.style.overflow = "hidden";

  document.querySelectorAll(".reader-page-img").forEach((img) => {
    // Images may still be loading; either way this is safe to call
    // immediately since it just wires up event listeners.
    enableReaderPageZoom(img);
  });

  const stage = document.getElementById("reader-stage");
  const track = document.getElementById("reader-track");
  const arrowLeft = document.getElementById("reader-arrow-left");
  const arrowRight = document.getElementById("reader-arrow-right");

  function updateArrowStates() {
    arrowLeft.classList.toggle("reader-arrow-disabled", currentReaderPage === 0);
    arrowRight.classList.toggle("reader-arrow-disabled", currentReaderPage === comic.pageCount - 1);
  }

  function goToPage(newPage) {
    // Reset zoom on the page being left, so it's back to normal
    // size next time it's viewed instead of staying zoomed in.
    const previousImg = stage.querySelectorAll(".reader-page")[currentReaderPage]?.querySelector(".reader-page-img");
    previousImg?._resetReaderZoom?.();

    currentReaderPage = newPage;
    ProgressStore.updateLastPage(comicId, newPage);
    document.getElementById("reader-counter").textContent = `PAGE ${newPage + 1} OF ${comic.pageCount}`;
    pagingController.goToPage(newPage, true);
    updateArrowStates();
  }

  const pagingController = setupReaderPaging(stage, track, comic.pageCount, {
    getCurrentPage: () => currentReaderPage,
    onPageChange: goToPage,
  });
  pagingController.goToPage(currentReaderPage, false);
  updateArrowStates();

  arrowLeft.addEventListener("click", () => {
    if (currentReaderPage > 0) goToPage(currentReaderPage - 1);
  });
  arrowRight.addEventListener("click", () => {
    if (currentReaderPage < comic.pageCount - 1) goToPage(currentReaderPage + 1);
  });

  // Show the arrows + page counter briefly on tap or mouse movement,
  // then fade them back out automatically so they never sit on top
  // of the artwork while just reading.
  let hideControlsTimeout;
  function showReaderControls() {
    view.classList.add("controls-visible");
    clearTimeout(hideControlsTimeout);
    hideControlsTimeout = setTimeout(() => view.classList.remove("controls-visible"), 2200);
  }

  // Tap detection: a real page-turn drag moves the pointer well past
  // a few pixels, so a small, quick pointerdown→pointerup counts as
  // a tap rather than a swipe — tracked independently of the paging
  // system so the two don't interfere with each other.
  let tapStartX = 0;
  let tapStartY = 0;
  let tapStartTime = 0;
  stage.addEventListener("pointerdown", (e) => {
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartTime = Date.now();
  });
  stage.addEventListener("pointerup", (e) => {
    const movedX = Math.abs(e.clientX - tapStartX);
    const movedY = Math.abs(e.clientY - tapStartY);
    const elapsed = Date.now() - tapStartTime;
    if (movedX < 12 && movedY < 12 && elapsed < 300) {
      showReaderControls();
    }
  });

  // Desktop: show controls as soon as the mouse moves anywhere over
  // the reader, so hovering near the edges reveals the arrows.
  view.addEventListener("mousemove", showReaderControls);
  view.addEventListener("mouseleave", () => {
    clearTimeout(hideControlsTimeout);
    view.classList.remove("controls-visible");
  });

  document.getElementById("reader-close").addEventListener("click", () => (window.location.hash = "#/"));
  document.getElementById("reader-fav").addEventListener("click", (e) => {
    ProgressStore.toggleFavorite(comicId);
    e.currentTarget.innerHTML = ProgressStore.isFavorite(comicId) ? ICONS.star : ICONS.starOutline;
  });
  document.getElementById("reader-info").addEventListener("click", () => showInfoCard(comic));

  const zoomStep = 0.75;
  function currentPageImage() {
    return stage.querySelectorAll(".reader-page")[currentReaderPage]?.querySelector(".reader-page-img");
  }
  document.getElementById("reader-zoom-in").addEventListener("click", () => {
    currentPageImage()?._stepReaderZoom?.(zoomStep);
  });
  document.getElementById("reader-zoom-out").addEventListener("click", () => {
    currentPageImage()?._stepReaderZoom?.(-zoomStep);
  });
}

function closeReader() {
  document.getElementById("reader-view").style.display = "none";
  document.body.style.overflow = "";
  currentReaderComic = null;
  renderLibrary();
}

// ---------- Info card ----------

function showInfoCard(comic) {
  const backdrop = document.getElementById("info-backdrop");
  backdrop.innerHTML = `
    <div class="info-card">
      <div class="info-card-header">
        <div class="info-card-title">${escapeHTML(comic.title)}</div>
        <button class="icon-button pressable" id="info-close" style="width:26px;height:26px;color:var(--text-secondary)">${ICONS.close}</button>
      </div>
      <div class="info-card-meta">${escapeHTML(comic.author)} · ${comic.year}</div>
      <div class="info-card-rule"></div>
      <div class="info-card-synopsis">${escapeHTML(comic.synopsis)}</div>
    </div>`;
  backdrop.classList.add("visible");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hideInfoCard();
  });
  document.getElementById("info-close").addEventListener("click", hideInfoCard);
}

function hideInfoCard() {
  document.getElementById("info-backdrop").classList.remove("visible");
}

// ---------- Settings sheet ----------

function openSettings() {
  const current = AppearanceStore.get();
  const modes = [
    { id: "system", label: "System", icon: ICONS.circleHalf },
    { id: "light", label: "Light", icon: ICONS.sun },
    { id: "dark", label: "Dark", icon: ICONS.moon },
  ];
  document.getElementById("settings-sheet").innerHTML = `
    <div class="sheet-header">
      <div class="sheet-title">SETTINGS</div>
      <button class="sheet-done" id="settings-done">Done</button>
    </div>
    <div class="settings-section-label">Appearance</div>
    <div class="settings-list">
      ${modes
        .map(
          (m) => `
        <div class="settings-row pressable" data-mode="${m.id}">
          ${m.icon}<span>${m.label}</span>
          ${current === m.id ? `<span class="check">${ICONS.check.replace("currentColor", "var(--accent)")}</span>` : ""}
        </div>`
        )
        .join("")}
    </div>
    <div class="settings-section-label">About</div>
    <div class="settings-about">
      Buddha's Comic Library collects public domain comics for anyone to read, free, with no paywall.
      Sources include the <a href="https://digitalcomicmuseum.com" target="_blank" rel="noopener">Digital Comic Museum</a>
      and <a href="https://comicbookplus.com" target="_blank" rel="noopener">Comic Book Plus</a>.
    </div>
  `;
  document.querySelectorAll(".settings-row").forEach((row) => {
    row.addEventListener("click", () => {
      AppearanceStore.set(row.dataset.mode);
      applyAppearance();
      openSettings();
    });
  });
  document.getElementById("settings-done").addEventListener("click", closeSettings);
  showSheet("settings");
}

function closeSettings() {
  hideSheet("settings");
}

// ---------- History sheet ----------

// ---------- Manage Images sheet ----------
// The whole point of this screen: upload real cover/page images by
// picking files from your computer, no file paths or JSON editing
// required. Files are stored in IndexedDB and remembered across
// reloads.

function openManageImages() {
  renderManageImagesSheet();
  showSheet("images");
}

function closeManageImages() {
  hideSheet("images");
  // Whatever screen is behind this sheet may now be showing stale
  // covers — re-run the router so newly uploaded images appear
  // immediately instead of only after a manual reload.
  handleRoute();
}

// Every unique (category, subcategory) pair across all comics —
// these are the tiles that can optionally get their own dedicated
// cover art, separate from any individual comic's cover.
function allSubcategories() {
  const seen = new Map();
  ALL_COMICS.forEach((comic) => {
    if (!comic.subcategory) return;
    const key = `${comic.category}::${comic.subcategory}`;
    if (!seen.has(key)) {
      seen.set(key, { category: comic.category, name: comic.subcategory });
    }
  });
  return Array.from(seen.values());
}

function renderManageImagesSheet() {
  const rows = ALL_COMICS.map((comic) => {
    const cover = coverImageURL(comic.id);
    const uploadedPages = pageImageURLs(comic.id, comic.pageCount);
    const pageCountLabel = uploadedPages
      ? `${uploadedPages.filter(Boolean).length} of ${comic.pageCount} pages uploaded`
      : `0 of ${comic.pageCount} pages uploaded`;

    return `
      <div class="manage-row" data-comic-id="${comic.id}">
        <div class="manage-row-thumb">
          ${cover ? `<img src="${cover}" alt="">` : `<div class="manage-row-thumb-empty">${ICONS.image}</div>`}
        </div>
        <div class="manage-row-body">
          <div class="manage-row-title">${escapeHTML(comic.title)}</div>
          <div class="manage-row-meta">${pageCountLabel}</div>
          <div class="manage-row-actions">
            <label class="manage-upload-btn pressable">
              ${ICONS.upload} Cover
              <input type="file" accept="image/*" class="manage-file-input" data-comic-id="${comic.id}" data-kind="cover" hidden>
            </label>
            <label class="manage-upload-btn pressable">
              ${ICONS.upload} Pages
              <input type="file" accept="image/*" multiple class="manage-file-input" data-comic-id="${comic.id}" data-kind="pages" hidden>
            </label>
            ${
              cover || uploadedPages
                ? `<button class="manage-clear-btn pressable" data-comic-id="${comic.id}">${ICONS.trash}</button>`
                : ""
            }
          </div>
        </div>
      </div>`;
  }).join("");

  const subcategoryRows = allSubcategories().map(({ category, name }) => {
    const tileCover = subcategoryCoverImageURL(category, name);
    return `
      <div class="manage-row" data-category="${escapeHTML(category)}" data-subname="${escapeHTML(name)}">
        <div class="manage-row-thumb">
          ${tileCover ? `<img src="${tileCover}" alt="">` : `<div class="manage-row-thumb-empty">${ICONS.image}</div>`}
        </div>
        <div class="manage-row-body">
          <div class="manage-row-title">${escapeHTML(name)}</div>
          <div class="manage-row-meta">${escapeHTML(category)} · tile art (optional, separate from any book's own cover)</div>
          <div class="manage-row-actions">
            <label class="manage-upload-btn pressable">
              ${ICONS.upload} Tile Image
              <input type="file" accept="image/*" class="manage-subcat-input" data-category="${escapeHTML(category)}" data-subname="${escapeHTML(name)}" hidden>
            </label>
            ${
              tileCover
                ? `<button class="manage-clear-btn pressable manage-subcat-clear" data-category="${escapeHTML(category)}" data-subname="${escapeHTML(name)}">${ICONS.trash}</button>`
                : ""
            }
          </div>
        </div>
      </div>`;
  }).join("");

  const subcategorySection = subcategoryRows
    ? `
      <div class="settings-section-label" style="margin-top:6px;">Category Tiles</div>
      <div class="manage-intro" style="padding-top:0;">
        Give a subcategory tile (like "Tigger") its own distinct
        image instead of reusing one of its books' covers. Optional —
        leave blank to keep reusing a book cover automatically.
      </div>
      <div class="manage-list">${subcategoryRows}</div>`
    : "";

  document.getElementById("images-sheet").innerHTML = `
    <div class="sheet-header">
      <div class="sheet-title">MANAGE IMAGES</div>
      <button class="sheet-done" id="images-done">Done</button>
    </div>
    <div class="manage-intro">
      Pick a cover image and page images for each comic. Selecting
      multiple page files at once orders them by filename, so name
      them like page-1.jpg, page-2.jpg, etc.
      <br><br>
      <strong>Important:</strong> images you upload here only exist in
      this browser. To make them visible to anyone else visiting the
      site, click "Export ZIP" below once you're done uploading. It
      downloads a folder of real image files plus a matching
      comics.json — unzip it, then merge the images/ folder and
      replace data/comics.json in your project before hosting.
    </div>
    <button class="manage-export-btn pressable" id="images-export">${ICONS.upload} Export ZIP</button>
    <div class="settings-section-label">Comics</div>
    <div class="manage-list">${rows}</div>
    ${subcategorySection}
  `;

  document.getElementById("images-done").addEventListener("click", closeManageImages);
  document.getElementById("images-export").addEventListener("click", exportAsZip);

  document.querySelectorAll(".manage-file-input").forEach((input) => {
    input.addEventListener("change", handleImageFileSelected);
  });

  document.querySelectorAll(".manage-clear-btn:not(.manage-subcat-clear)").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await ImageStore.deleteAllForComic(btn.dataset.comicId);
      await loadAllImageURLs();
      renderManageImagesSheet();
    });
  });

  document.querySelectorAll(".manage-subcat-input").forEach((input) => {
    input.addEventListener("change", handleSubcategoryImageSelected);
  });

  document.querySelectorAll(".manage-subcat-clear").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await ImageStore.deleteKey(subcategoryCoverKey(btn.dataset.category, btn.dataset.subname));
      await loadAllImageURLs();
      renderManageImagesSheet();
    });
  });
}

async function handleSubcategoryImageSelected(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const resized = await resizeImageFile(file, 900, 0.85); // tile art shown small — lower max size is plenty
  await ImageStore.putBlob(subcategoryCoverKey(input.dataset.category, input.dataset.subname), resized);
  await loadAllImageURLs();
  renderManageImagesSheet();
}

async function handleImageFileSelected(e) {
  const input = e.target;
  const comicId = input.dataset.comicId;
  const kind = input.dataset.kind;
  const files = Array.from(input.files || []);
  if (!files.length) return;

  setManageRowBusy(comicId, true);

  if (kind === "cover") {
    const resized = await resizeImageFile(files[0], 900, 0.85); // covers are shown small too
    await ImageStore.putBlob(`${comicId}:cover`, resized);
  } else {
    // Sort by filename (natural order) so page-2 comes before
    // page-10 — plain alphabetical sort would get this wrong.
    const sorted = naturalSortFiles(files);
    for (let i = 0; i < sorted.length; i++) {
      // 1600px keeps pages readable full-screen while cutting a
      // typical multi-MB phone photo down to a few hundred KB.
      const resized = await resizeImageFile(sorted[i], 1600, 0.82);
      await ImageStore.putBlob(`${comicId}:page:${i}`, resized);
    }
  }

  await loadAllImageURLs();
  renderManageImagesSheet();
}

// Shows a lightweight "Processing…" state on a comic's row while its
// images are being resized — multi-page uploads can take a few
// seconds, and without this it can look like nothing is happening.
function setManageRowBusy(comicId, isBusy) {
  const row = document.querySelector(`.manage-row[data-comic-id="${comicId}"]`);
  if (!row) return;
  const meta = row.querySelector(".manage-row-meta");
  if (meta && isBusy) {
    meta.dataset.originalText = meta.textContent;
    meta.textContent = "Processing images…";
  }
}

// Converts every uploaded image (currently only living in this
// browser's IndexedDB) into embedded base64 data directly inside a
// new comics.json — so once that file replaces the real one in the
// project and gets hosted, the images are genuinely part of the
// site and visible to every visitor, not just this browser.
async function exportAsZip() {
  const exportBtn = document.getElementById("images-export");
  exportBtn.textContent = "Building ZIP…";
  exportBtn.disabled = true;

  const zipEntries = [];

  // Fetch every stored blob once, up front, instead of re-querying
  // IndexedDB per image — much faster with a large library.
  const allEntries = await ImageStore.getAllEntries();
  const blobsByKey = new Map(allEntries);

  const updatedComics = [];
  for (const comic of ALL_COMICS) {
    const updated = { ...comic };

    const coverBlob = blobsByKey.get(`${comic.id}:cover`);
    if (coverBlob) {
      const filename = `${comic.id}.jpg`;
      zipEntries.push({ path: `images/covers/${filename}`, data: await blobToUint8Array(coverBlob) });
      updated.coverImage = `images/covers/${filename}`;
    }

    const pagePaths = [];
    let hasAnyPage = false;
    for (let i = 0; i < comic.pageCount; i++) {
      const blob = blobsByKey.get(`${comic.id}:page:${i}`);
      if (blob) {
        hasAnyPage = true;
        const filename = `page-${i + 1}.jpg`;
        zipEntries.push({ path: `images/pages/${comic.id}/${filename}`, data: await blobToUint8Array(blob) });
        pagePaths.push(`images/pages/${comic.id}/${filename}`);
      } else {
        pagePaths.push(null);
      }
    }
    if (hasAnyPage) {
      updated.pageImages = pagePaths;
      delete updated.pageImageRanges;
    }

    updatedComics.push(updated);
  }

  // Subcategory tile images (e.g. a dedicated "Tigger" image) get
  // saved as their own file and referenced by path on whichever comic
  // represents that subcategory.
  const subcatEntries = allEntries.filter(([key]) => key.startsWith("subcat::") && key.endsWith(":cover"));
  for (const [key, blob] of subcatEntries) {
    const match = key.match(/^subcat::(.*)::(.*):cover$/);
    if (!match) continue;
    const [, category, name] = match;
    const groupComics = ALL_COMICS.filter((c) => c.category === category && c.subcategory === name);
    const rep = groupComics.find((c) => c.isSubcategoryCover) || groupComics[0];
    if (!rep) continue;
    const target = updatedComics.find((c) => c.id === rep.id);
    if (!target) continue;
    const safeName = `subcat-${category}-${name}`.replace(/[^a-z0-9-]+/gi, "-");
    const filename = `${safeName}.jpg`;
    zipEntries.push({ path: `images/covers/${filename}`, data: await blobToUint8Array(blob) });
    target.isSubcategoryCover = true;
    target.subcategoryCoverImage = `images/covers/${filename}`;
  }

  const jsonText = JSON.stringify(updatedComics, null, 2);
  zipEntries.push({ path: "data/comics.json", data: new TextEncoder().encode(jsonText) });

  exportBtn.textContent = "Compressing…";
  const zipBlob = await createZipBlob(zipEntries);

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "comic-library-export.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  exportBtn.innerHTML = `${ICONS.upload} Export ZIP`;
  exportBtn.disabled = false;
}

function openHistory() {
  const comics = historyComics();
  const body = comics.length
    ? `<div class="grid-view">${comics.map((c) => renderCoverCell(c, { accentVar: "var(--accent)" })).join("")}</div>`
    : emptyStateHTML(ICONS.clock, "No History Yet", "Comics you finish reading will show up here.");
  document.getElementById("history-sheet").innerHTML = `
    <div class="sheet-header">
      <div class="sheet-title">HISTORY</div>
      <button class="sheet-done" id="history-done">Done</button>
    </div>
    ${body}
  `;
  document.getElementById("history-done").addEventListener("click", closeHistory);
  document.querySelectorAll("#history-sheet .cover-art-wrap").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      closeHistory();
      window.location.hash = `#/comic/${el.dataset.comicId}`;
    });
  });
  showSheet("history");
}

function closeHistory() {
  hideSheet("history");
}

function showSheet(name) {
  document.getElementById(`${name}-backdrop`).classList.add("visible");
  requestAnimationFrame(() => document.getElementById(`${name}-sheet`).classList.add("visible"));
  document.getElementById(`${name}-backdrop`).onclick = () => hideSheet(name);
}

function hideSheet(name) {
  document.getElementById(`${name}-sheet`).classList.remove("visible");
  document.getElementById(`${name}-backdrop`).classList.remove("visible");
}

// ---------- Appearance ----------

function applyAppearance() {
  const mode = AppearanceStore.get();
  let effective = mode;
  if (mode === "system") {
    effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", effective);
}

// ---------- Menu ----------

function toggleMenu() {
  const backdrop = document.getElementById("menu-backdrop");
  const isVisible = backdrop.classList.contains("visible");
  if (isVisible) {
    backdrop.classList.remove("visible");
    return;
  }
  const manageImagesRow = isAdminMode()
    ? `<div class="settings-row pressable" id="menu-images" style="cursor:pointer;">${ICONS.image}<span>Manage Images</span></div>`
    : "";
  backdrop.innerHTML = `
    <div style="position:fixed;top:56px;right:16px;background:var(--surface);border-radius:12px;overflow:hidden;min-width:190px;box-shadow:0 8px 24px rgba(0,0,0,0.3);">
      ${manageImagesRow}
      <div class="settings-row pressable" id="menu-settings" style="cursor:pointer;">${ICONS.gear}<span>Settings</span></div>
      <div class="settings-row pressable" id="menu-history" style="cursor:pointer;border-top:0.5px solid var(--background);">${ICONS.clock}<span>History</span></div>
    </div>`;
  backdrop.classList.add("visible");
  backdrop.style.background = "transparent";
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.classList.remove("visible");
  };
  if (isAdminMode()) {
    document.getElementById("menu-images").addEventListener("click", () => {
      backdrop.classList.remove("visible");
      openManageImages();
    });
  }
  document.getElementById("menu-settings").addEventListener("click", () => {
    backdrop.classList.remove("visible");
    openSettings();
  });
  document.getElementById("menu-history").addEventListener("click", () => {
    backdrop.classList.remove("visible");
    openHistory();
  });
}

// ---------- Router ----------

function handleRoute() {
  const hash = window.location.hash || "#/";
  const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);

  if (parts[0] === "comic" && parts[1]) {
    openReader(decodeURIComponent(parts[1]));
    return;
  }
  closeReaderIfOpen();

  if (parts[0] === "category" && parts[1]) {
    renderCategoryGrid(decodeURIComponent(parts[1]));
  } else if (parts[0] === "subcategory" && parts[1] && parts[2]) {
    renderSubcategoryGrid(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
  } else {
    document.getElementById("search-input").value = "";
    renderLibrary();
  }
}

function closeReaderIfOpen() {
  const view = document.getElementById("reader-view");
  if (view.style.display !== "none") {
    view.style.display = "none";
    document.body.style.overflow = "";
    currentReaderComic = null;
  }
}

// ---------- Launch animation ----------

function playLaunchAnimation() {
  renderStarburstInto(document.getElementById("launch-burst"));
  renderStarburstInto(document.getElementById("nav-burst"));
  document.getElementById("launch-burst").classList.add("animate");
  document.getElementById("launch-book").classList.add("animate");
  document.getElementById("launch-title").classList.add("animate");

  setTimeout(() => {
    const screen = document.getElementById("launch-screen");
    screen.classList.add("fade-out");
    setTimeout(() => (screen.style.display = "none"), 400);
  }, 1700);
}

// ---------- Init ----------

// ---------- Admin mode gating ----------
// "Manage Images" is a personal setup tool, not something regular
// site visitors need to see. Visiting the site once with ?admin=1 in
// the URL unlocks it permanently on that device (remembered via
// localStorage); everyone else never sees the menu item at all.
const ADMIN_KEY = "comicLibrary.isAdmin";

function isAdminMode() {
  return localStorage.getItem(ADMIN_KEY) === "true";
}

function checkAdminURLFlag() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") === "1") {
    localStorage.setItem(ADMIN_KEY, "true");
  }
}

async function init() {
  checkAdminURLFlag();
  applyAppearance();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (AppearanceStore.get() === "system") applyAppearance();
  });

  await loadComics();
  await loadAllImageURLs();

  document.getElementById("btn-menu").addEventListener("click", toggleMenu);
  document.getElementById("search-input").addEventListener("input", (e) => {
    const q = e.target.value;
    if (q.trim()) {
      renderSearch(q);
    } else {
      renderLibrary();
    }
  });

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
  playLaunchAnimation();
}

init();