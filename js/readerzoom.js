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

const MAX_ZOOM = 4;
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

  // The image's unscaled on-screen position and size (i.e. as it
  // sits before any zoom transform is applied), captured once. Used
  // for all clamping and pinch-anchor math below — deliberately NOT
  // re-measured via getBoundingClientRect() mid-gesture, both because
  // a live measurement lags a step behind whenever scale has just
  // changed in JS but not yet repainted, and because computing
  // everything from one fixed reference point avoids compounding
  // small errors across many rapid pinch pointermove events.
  let baseWidth = 0;
  let baseHeight = 0;
  let staticLeft = 0;
  let staticTop = 0;
  function captureBaseGeometry() {
    const rect = imgEl.getBoundingClientRect();
    if (rect.width > 0) {
      baseWidth = rect.width;
      baseHeight = rect.height;
      // translate(tx,ty) scale(s) with transform-origin 0 0 always
      // places the element's top-left corner at exactly
      // (staticLeft + tx, staticTop + ty) on screen, regardless of
      // scale — so this holds even if called while already zoomed.
      staticLeft = rect.left - translateX;
      staticTop = rect.top - translateY;
    }
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
    // Keep the image from being dragged entirely off-screen once
    // zoomed — clamps translation so at least part of the image
    // stays visible within its container.
    if (baseWidth === 0) captureBaseGeometry(); // fallback if load hadn't fired yet
    const parent = imgEl.parentElement.getBoundingClientRect();
    const scaledWidth = baseWidth * scale;
    const scaledHeight = baseHeight * scale;

    const minX = Math.min(0, parent.width - scaledWidth);
    const minY = Math.min(0, parent.height - scaledHeight);
    translateX = Math.max(minX, Math.min(0, translateX));
    translateY = Math.max(minY, Math.min(0, translateY));
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
          const rect = imgEl.getBoundingClientRect();
          scale = DOUBLE_TAP_ZOOM;
          translateX = -(pos.x - rect.left) * (DOUBLE_TAP_ZOOM - 1);
          translateY = -(pos.y - rect.top) * (DOUBLE_TAP_ZOOM - 1);
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
    const rect = imgEl.getBoundingClientRect();
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