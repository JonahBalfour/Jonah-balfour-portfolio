// Progressive-enhancement scroll reveal.
// Elements only get the "reveal" class (and start hidden) if this script runs,
// so the page looks and reads fine with JavaScript disabled.
document.addEventListener("DOMContentLoaded", function () {
  var targets = document.querySelectorAll(".sample, .hero-stats .stat");
  if (!("IntersectionObserver" in window) || !targets.length) return;

  targets.forEach(function (el) {
    el.classList.add("reveal");
  });

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach(function (el) {
    observer.observe(el);
  });
});
