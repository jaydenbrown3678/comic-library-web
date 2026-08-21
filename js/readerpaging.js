// ==========================================================
// ReaderPaging — replaces native scroll-snap page turning with a
// custom drag system, so the distance required to commit a page
// turn can actually be tuned (native scroll-snap gives no control
// over this at all). Backward (swipe right, previous page) requires
// noticeably more drag distance than forward, per request — it was
// triggering too easily with just a small movement.
//
// Also smooths the interaction three ways:
// 1. Velocity-based flicks — a fast short swipe commits a page turn
//    even if it didn't travel the full distance threshold, matching
//    how native paging apps feel (distance alone feels sluggish for
//    quick flicks).
// 2. requestAnimationFrame batching — transform updates during drag
//    are batched to the browser's paint cycle instead of applied
//    synchronously on every single pointer event, avoiding jank.
// 3. Edge resistance — dragging past the first/last page moves the
//    track at a fraction of your actual finger movement, so hitting
//    the boundary feels like resistance instead of either doing
//    nothing or moving too far.
// ==========================================================

const FORWARD_THRESHOLD = 0.22; // swipe left → next page
const BACKWARD_THRESHOLD = 0.45; // swipe right → previous page (needs more room)

// A flick faster than this (pixels/ms) commits a page turn
// regardless of distance travelled, as long as it's pointed the
// right direction and isn't already past the first/last page.
const FLICK_VELOCITY_THRESHOLD = 0.5; // ~500px/second

// How much a drag past the first/last page is dampened, so it feels
// like resistance rather than free movement into invalid territory.
const EDGE_RESISTANCE = 0.35;

function setupReaderPaging(stage, track, pageCount, { getCurrentPage, onPageChange }) {
  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let stageWidth = stage.clientWidth;
  let rafId = null;

  // Small rolling history of recent {time, x} samples, used to
  // compute the finger's actual velocity at release — a straight
  // start-to-end average would misrepresent a drag that started
  // slow and sped up (or vice versa) partway through.
  let recentSamples = [];

  const activePointerIds = new Set();

  function pageOffsetPx(page) {
    return -page * stageWidth;
  }

  function setTrackX(x, animate) {
    track.style.transition = animate ? "transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)" : "none";
    track.style.transform = `translateX(${x}px)`;
  }

  function isCurrentImageZoomed() {
    const currentPageEl = stage.querySelectorAll(".reader-page")[getCurrentPage()];
    const img = currentPageEl?.querySelector(".reader-page-img");
    return img?._isReaderZoomed?.() ?? false;
  }

  function cancelDragBackToCurrentPage() {
    dragging = false;
    setTrackX(pageOffsetPx(getCurrentPage()), true);
  }

  // Applies resistance once dragging past a boundary the reader
  // can't actually go beyond (before page 0, or past the last page),
  // instead of moving 1:1 with the finger into invalid territory.
  function withEdgeResistance(rawDelta, current) {
    const atFirstPage = current === 0;
    const atLastPage = current === pageCount - 1;
    if (atFirstPage && rawDelta > 0) return rawDelta * EDGE_RESISTANCE;
    if (atLastPage && rawDelta < 0) return rawDelta * EDGE_RESISTANCE;
    return rawDelta;
  }

  function scheduleTrackUpdate(x) {
    if (rafId !== null) return; // a frame is already pending, let it pick up the latest x
    rafId = requestAnimationFrame(() => {
      track.style.transition = "none";
      track.style.transform = `translateX(${x}px)`;
      rafId = null;
    });
  }

  stage.addEventListener("pointerdown", (e) => {
    activePointerIds.add(e.pointerId);

    if (activePointerIds.size >= 2) {
      cancelDragBackToCurrentPage();
      return;
    }

    if (isCurrentImageZoomed()) return;
    dragging = true;
    startX = e.clientX;
    currentX = startX;
    stageWidth = stage.clientWidth;
    recentSamples = [{ time: performance.now(), x: e.clientX }];
    track.style.transition = "none";
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging || activePointerIds.size >= 2) return;
    currentX = e.clientX;

    const now = performance.now();
    recentSamples.push({ time: now, x: currentX });
    // Only need a short window of history for a meaningful velocity
    // reading — trim anything older than ~120ms.
    while (recentSamples.length > 2 && now - recentSamples[0].time > 120) {
      recentSamples.shift();
    }

    const rawDelta = currentX - startX;
    const current = getCurrentPage();
    const dragDelta = withEdgeResistance(rawDelta, current);
    scheduleTrackUpdate(pageOffsetPx(current) + dragDelta);
  });

  function currentVelocity() {
    if (recentSamples.length < 2) return 0;
    const first = recentSamples[0];
    const last = recentSamples[recentSamples.length - 1];
    const dt = last.time - first.time;
    if (dt <= 0) return 0;
    return (last.x - first.x) / dt; // px per ms, sign indicates direction
  }

  function endDrag(e) {
    activePointerIds.delete(e.pointerId);
    if (!dragging) return;
    dragging = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    const dragDelta = currentX - startX;
    const ratio = dragDelta / stageWidth;
    const velocity = currentVelocity();
    const current = getCurrentPage();

    const forwardByDistance = ratio <= -FORWARD_THRESHOLD;
    const forwardByFlick = velocity <= -FLICK_VELOCITY_THRESHOLD && dragDelta < 0;
    const backwardByDistance = ratio >= BACKWARD_THRESHOLD;
    const backwardByFlick = velocity >= FLICK_VELOCITY_THRESHOLD && dragDelta > 0;

    if ((forwardByDistance || forwardByFlick) && current < pageCount - 1) {
      onPageChange(current + 1);
    } else if ((backwardByDistance || backwardByFlick) && current > 0) {
      onPageChange(current - 1);
    } else {
      setTrackX(pageOffsetPx(current), true);
    }
  }

  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    stageWidth = stage.clientWidth;
    setTrackX(pageOffsetPx(getCurrentPage()), false);
  });

  return {
    goToPage(page, animate = true) {
      setTrackX(pageOffsetPx(page), animate);
    },
  };
}