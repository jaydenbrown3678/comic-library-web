// ==========================================================
// ReaderZoom — pinch-to-zoom and double-tap-to-zoom for a single
// comic page image, without interfering with the horizontal
// swipe-to-turn-page gesture already handled natively by the
// scroll-snap container.
//
// Key idea: single-finger touches only get intercepted once the
// image is already zoomed in (for panning around); at 1x zoom, a
// single-finger drag passes straight through to the native
// horizontal scroll/swipe used for turning pages. Two-finger
// touches are always treated as pinch-zoom, since page-turning is
// never a two-finger gesture, so there's no ambiguity to resolve.
// ==========================================================

const MAX_ZOOM = 7;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MAX_DELAY_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE_PX = 30;

function enableReaderPageZoom(imgEl) {
  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  // Active pointers currently touching this image, keyed by pointerId.
  const pointers = new Map();

  // State captured at the start of a pinch or pan gesture, used to
  // compute deltas as the gesture continues.
  let gestureStart = null;

  let lastTapTime = 0;
  let lastTapPos = { x: 0, y: 0 };

  imgEl.style.touchAction = "auto"; // allow native swipe-to-turn-page at 1x
  imgEl.style.transformOrigin = "0 0";
  imgEl.style.willChange = "transform";

  // The image's unscaled on-screen position and size, captured once
  // and used for all clamping and pinch-anchor math below.
  //
  // Important: this is NOT simply imgEl.getBoundingClientRect(). The
  // CSS uses object-fit: contain, which — for some aspect ratios —
  // means the image's outer box (what getBoundingClientRect measures)
  // is LARGER than the actual visible picture inside it, with empty
  // letterboxed space along two edges of the box itself. This
  // happens whenever max-height ends up being the binding constraint
  // (common for wide/landscape pages): width stays at 100% of the
  // container, but the height gets capped, so object-fit then
  // shrinks the visible image further to preserve its proportions —
  // invisibly, within the box's own bounds. Measuring the outer box
  // in that case anchors zoom/pan math to a region larger than what
  // you can actually see and touch, which is exactly what caused
  // pinching to visibly drift off to the side on wider pages.
  let baseWidth = 0;
  let baseHeight = 0;
  let staticLeft = 0;
  let staticTop = 0;
  function captureBaseGeometry() {
    const box = imgEl.getBoundingClientRect();
    if (box.width === 0) return;
    const naturalW = imgEl.naturalWidth;
    const naturalH = imgEl.naturalHeight;

    if (!naturalW || !naturalH) {
      // Natural size not available yet for some reason — fall back
      // to the outer box rather than blocking entirely.
      baseWidth = box.width;
      baseHeight = box.height;
      staticLeft = box.left - translateX;
      staticTop = box.top - translateY;
      return;
    }

    const boxAspect = box.width / box.height;
    const imgAspect = naturalW / naturalH;

    let contentWidth, contentHeight, insetX, insetY;
    if (imgAspect > boxAspect) {
      // Image is relatively wider than its box — width fills the
      // box, height is letterboxed (empty space above/below).
      contentWidth = box.width;
      contentHeight = box.width / imgAspect;
      insetX = 0;
      insetY = (box.height - contentHeight) / 2;
    } else {
      // Image is relatively taller than its box — height fills the
      // box, width is letterboxed (empty space left/right) — the
      // case that was breaking wide pages.
      contentHeight = box.height;
      contentWidth = box.height * imgAspect;
      insetY = 0;
      insetX = (box.width - contentWidth) / 2;
    }

    baseWidth = contentWidth;
    baseHeight = contentHeight;
    // translate(tx,ty) scale(s) with transform-origin 0 0 always
    // places the element's top-left corner at exactly
    // (staticLeft + tx, staticTop + ty) on screen, regardless of
    // scale — so this holds even if called while already zoomed.
    // Using the CONTENT edge here (box edge + letterbox inset), not
    // the outer box edge.
    staticLeft = box.left + insetX - translateX;
    staticTop = box.top + insetY - translateY;
  }
  if (imgEl.complete) {
    captureBaseGeometry();
  } else {
    imgEl.addEventListener("load", captureBaseGeometry, { once: true });
  }

  function updateTouchAction() {
    // Only take over touch handling entirely once actually zoomed in
    // — at 1x, native touch scrolling needs to reach the page-turn
    // container untouched, or swiping between pages breaks.
    imgEl.style.touchAction = scale > 1 ? "none" : "auto";
  }

  function applyTransform() {
    imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    updateTouchAction();
  }

  function clampAndApply() {
    // Keep the image from being panned completely out of view once
    // zoomed — but only that. An earlier version required the image
    // to fully COVER its container at all times, which sounds
    // reasonable but is far stricter than it needs to be: for a
    // wide/short (landscape) image, the zoomed height often only
    // barely exceeds its container's height, leaving almost no
    // legitimate pan range under that rule — so a pinch anchored
    // near the top or bottom would get clamped well short of where
    // it should land, and the point under your fingers would
    // visibly drift even though the horizontal axis (with much more
    // pannable range) anchored perfectly. Requiring only that some
    // minimum sliver of the image stays visible, rather than full
    // coverage, gives enough room for the anchor point to actually
    // be reached in these cases.
    if (baseWidth === 0) captureBaseGeometry(); // fallback if load hadn't fired yet
    const parent = imgEl.parentElement.getBoundingClientRect();
    const scaledWidth = baseWidth * scale;
    const scaledHeight = baseHeight * scale;
    const minVisible = 15; // px of the image that must stay on-screen — kept small so panning has as much room as possible

    const minX = -scaledWidth + minVisible;
    const maxX = parent.width - minVisible;
    const minY = -scaledHeight + minVisible;
    const maxY = parent.height - minVisible;
    translateX = Math.max(minX, Math.min(maxX, translateX));
    translateY = Math.max(minY, Math.min(maxY, translateY));
    applyTransform();
  }

  function resetZoom() {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform();
  }

  function distanceBetween(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function midpointOf(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }

  imgEl.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      imgEl.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail in rare edge cases (e.g. the
      // pointer already ended) — the gesture still works fine
      // without it, so this is safe to ignore.
    }

    // Re-measure right before this gesture needs it, rather than
    // trusting whatever was captured back when the image first
    // loaded. Pages adjacent to the current one are pre-loaded for
    // smoother swiping while still sitting off-screen, waiting for
    // their page-turn animation — so a geometry snapshot taken at
    // that moment reflects their off-screen position, not where
    // they actually end up once turned to. Without this refresh,
    // zooming on a page you've just swiped to (as opposed to the
    // very first page you open) anchors against that stale,
    // pre-animation position instead of where it visibly is now.
    captureBaseGeometry();

    if (pointers.size === 2) {
      imgEl.style.touchAction = "none";
      const [p1, p2] = Array.from(pointers.values());
      gestureStart = {
        distance: distanceBetween(p1, p2),
        scale,
        midpoint: midpointOf(p1, p2),
        translateX,
        translateY,
      };
      // The content-space point currently under the pinch midpoint —
      // computed once, here, and used every frame for the rest of
      // this gesture to keep that same point anchored under the
      // fingers as scale changes.
      gestureStart.contentX = (gestureStart.midpoint.x - staticLeft - translateX) / scale;
      gestureStart.contentY = (gestureStart.midpoint.y - staticTop - translateY) / scale;
      const trackEl = document.getElementById('reader-track');
      console.log('PINCH_DEBUG_START', JSON.stringify({ staticLeft, staticTop, midpointX: gestureStart.midpoint.x, midpointY: gestureStart.midpoint.y, translateX, translateY, scale, contentX: gestureStart.contentX, contentY: gestureStart.contentY, trackInlineTransform: trackEl.style.transform, trackComputedTransform: getComputedStyle(trackEl).transform, imgClosestPageParentTransform: imgEl.closest('.reader-page')?.getBoundingClientRect().left }));
    } else if (pointers.size === 1 && scale > 1) {
      // Only start a pan if already zoomed in — at 1x, a
      // single-finger touch is left alone so the page-swipe
      // container can handle it natively instead.
      gestureStart = { x: e.clientX, y: e.clientY, translateX, translateY };
      e.preventDefault();
    }
  });

  imgEl.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && gestureStart) {
      e.preventDefault();
      const [p1, p2] = Array.from(pointers.values());
      const newDistance = distanceBetween(p1, p2);
      const ratio = newDistance / gestureStart.distance;
      const newScale = Math.max(1, Math.min(MAX_ZOOM, gestureStart.scale * ratio));

      // Recomputed fresh from the fixed anchor point captured at
      // gesture start, rather than incrementally adjusted frame by
      // frame — avoids compounding small errors across the many
      // pointermove events a pinch fires, and matches the same
      // (already correct) approach double-tap zoom uses below.
      scale = newScale;
      translateX = gestureStart.midpoint.x - staticLeft - gestureStart.contentX * newScale;
      translateY = gestureStart.midpoint.y - staticTop - gestureStart.contentY * newScale;
      console.log('PINCH_DEBUG_MOVE', JSON.stringify({ newScale, staticLeft, staticTop, unclamedTranslateX: translateX, unclampedTranslateY: translateY, gestureStartContentX: gestureStart.contentX, gestureStartMidpointX: gestureStart.midpoint.x }));
      clampAndApply();
    } else if (pointers.size === 1 && scale > 1 && gestureStart) {
      e.preventDefault();
      translateX = gestureStart.translateX + (e.clientX - gestureStart.x);
      translateY = gestureStart.translateY + (e.clientY - gestureStart.y);
      clampAndApply();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) gestureStart = null;

    // Snap back to the "not zoomed" state cleanly if the pinch
    // ended up shrinking below 1x, so nothing looks stuck oddly.
    if (scale <= 1) {
      resetZoom();
    }
  }

  imgEl.addEventListener("pointerup", (e) => {
    // Double-tap detection: two quick taps close together toggle
    // zoom, anchored roughly at the tap location.
    if (pointers.size === 1) {
      const now = Date.now();
      const pos = { x: e.clientX, y: e.clientY };
      const isDoubleTap =
        now - lastTapTime < DOUBLE_TAP_MAX_DELAY_MS &&
        Math.hypot(pos.x - lastTapPos.x, pos.y - lastTapPos.y) < DOUBLE_TAP_MAX_DISTANCE_PX;

      if (isDoubleTap) {
        if (scale > 1) {
          resetZoom();
        } else {
          // Always re-measured fresh, not just when never captured —
          // same reasoning as pinch: a page pre-loaded while still
          // off-screen (before its turn animation completes) gets an
          // initial geometry snapshot that's already stale by the
          // time you actually interact with it.
          captureBaseGeometry();
          scale = DOUBLE_TAP_ZOOM;
          translateX = -(pos.x - staticLeft) * (DOUBLE_TAP_ZOOM - 1);
          translateY = -(pos.y - staticTop) * (DOUBLE_TAP_ZOOM - 1);
          clampAndApply();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapPos = pos;
      }
    }
    endPointer(e);
  });

  imgEl.addEventListener("pointercancel", endPointer);

  // Exposed so the reader can reset zoom when the user navigates
  // away from this page (e.g. swipes to the next one).
  imgEl._resetReaderZoom = resetZoom;

  // Exposed so the page-turn drag system knows to let this image's
  // own pan handling take over instead of turning the page, while
  // zoomed in.
  imgEl._isReaderZoomed = () => scale > 1;

  // Exposed for explicit +/- zoom buttons, as an alternative to
  // pinch/double-tap for anyone who prefers tapping a button.
  // Zooms toward the center of the image rather than a fixed corner,
  // so it feels natural regardless of how the image is scrolled.
  imgEl._stepReaderZoom = (delta) => {
    const parent = imgEl.parentElement.getBoundingClientRect();
    const centerX = parent.width / 2;
    const centerY = parent.height / 2;

    const oldScale = scale;
    scale = Math.max(1, Math.min(MAX_ZOOM, scale + delta));
    const scaleRatio = scale / oldScale;

    // Adjust translation so the center point of the visible area
    // stays roughly fixed as scale changes, instead of the image
    // jumping to its top-left corner on every button tap.
    translateX = centerX - (centerX - translateX) * scaleRatio;
    translateY = centerY - (centerY - translateY) * scaleRatio;

    if (scale <= 1) {
      resetZoom();
    } else {
      clampAndApply();
    }
  };
}