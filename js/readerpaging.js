// ==========================================================
// ReaderPaging — replaces native scroll-snap page turning with a
// custom drag system, so the distance required to commit a page
// turn can actually be tuned (native scroll-snap gives no control
// over this at all). Backward (swipe right, previous page) requires
// noticeably more drag distance than forward, per request — it was
// triggering too easily with just a small movement.
// ==========================================================

// How far (as a fraction of screen width) you need to drag before
// the page actually turns. Below this, it snaps back to where you
// were. Tune these two independently to adjust each direction's feel.
const FORWARD_THRESHOLD = 0.22; // swipe left → next page
const BACKWARD_THRESHOLD = 0.45; // swipe right → previous page (needs more room)

function setupReaderPaging(stage, track, pageCount, { getCurrentPage, onPageChange }) {
  let dragging = false;
  let startX = 0;
  let currentX = 0;
  let stageWidth = stage.clientWidth;

  // Tracks how many pointers are currently touching the stage at
  // all (bubbled up from the image too), so a second finger landing
  // — which means a pinch is starting, handled entirely by the
  // per-image zoom system instead — can immediately cancel any
  // in-progress page-turn drag rather than letting the two systems
  // fight over the same touch.
  const activePointerIds = new Set();

  function pageOffsetPx(page) {
    return -page * stageWidth;
  }

  function setTrackX(x, animate) {
    track.style.transition = animate ? "transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)" : "none";
    track.style.transform = `translateX(${x}px)`;
  }

  // While the current page's image is zoomed in, dragging should pan
  // the image instead of turning the page — so paging is disabled
  // for the duration of that zoom.
  function isCurrentImageZoomed() {
    const currentPageEl = stage.querySelectorAll(".reader-page")[getCurrentPage()];
    const img = currentPageEl?.querySelector(".reader-page-img");
    return img?._isReaderZoomed?.() ?? false;
  }

  function cancelDragBackToCurrentPage() {
    dragging = false;
    setTrackX(pageOffsetPx(getCurrentPage()), true);
  }

  stage.addEventListener("pointerdown", (e) => {
    activePointerIds.add(e.pointerId);

    if (activePointerIds.size >= 2) {
      // A second finger just landed — this is a pinch, not a page
      // turn. Hand off entirely to the image's own zoom handling.
      cancelDragBackToCurrentPage();
      return;
    }

    if (isCurrentImageZoomed()) return;
    dragging = true;
    startX = e.clientX;
    currentX = startX;
    stageWidth = stage.clientWidth;
    track.style.transition = "none";
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // Safe to ignore — dragging still works without capture, it
      // just won't continue tracking if the pointer leaves the
      // element bounds mid-drag in rare cases.
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!dragging || activePointerIds.size >= 2) return;
    currentX = e.clientX;
    const dragDelta = currentX - startX;
    setTrackX(pageOffsetPx(getCurrentPage()) + dragDelta, false);
  });

  function endDrag(e) {
    activePointerIds.delete(e.pointerId);
    if (!dragging) return;
    dragging = false;

    const dragDelta = currentX - startX;
    const ratio = dragDelta / stageWidth;
    const current = getCurrentPage();

    if (ratio <= -FORWARD_THRESHOLD && current < pageCount - 1) {
      onPageChange(current + 1);
    } else if (ratio >= BACKWARD_THRESHOLD && current > 0) {
      onPageChange(current - 1);
    } else {
      // Didn't drag far enough either direction — snap back to
      // the current page instead of committing a turn.
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
