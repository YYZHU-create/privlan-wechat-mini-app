// Copied into the generated mini-program. Content is visible before enhancement.
function attach(page, motions) {
  const observers = [];
  if (typeof page.createIntersectionObserver !== "function" || typeof page.animate !== "function") return () => {};
  for (const motion of motions) {
    if (!["fade", "rise"].includes(motion.effect)) continue;
    let observer;
    let played = false;
    try {
      observer = page.createIntersectionObserver({ thresholds: [0] });
      observers.push(observer);
      observer.relativeToViewport().observe(motion.selector, result => {
        if (played || !(result.intersectionRatio > 0)) return;
        played = true;
        observer.disconnect();
        try {
          const first = { opacity: 0, transform: motion.effect === "rise" ? "translateY(12px)" : "translateY(0)" };
          page.animate(motion.selector, [first, { opacity: 1, transform: "translateY(0)" }], motion.duration,
            () => { if (typeof page.clearAnimation === "function") page.clearAnimation(motion.selector, () => {}); });
        } catch { /* baseline content stays visible */ }
      });
    } catch { if (observer) observer.disconnect(); }
  }
  return () => observers.forEach(observer => { try { observer.disconnect(); } catch {} });
}
module.exports = { attach };
