/* Light/dark: follows the system until the reader presses the header button, then remembers their pick in this browser. */
(function () {
  var root = document.documentElement, KEY = "blog-theme";
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(v) { root.classList.remove("theme-light", "theme-dark"); if (v === "light" || v === "dark") root.classList.add("theme-" + v); }
  var q = /[?&]theme=(light|dark)\b/.exec(location.search);   // ?theme=dark previews a theme without saving it
  apply(q ? q[1] : get());
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.querySelector(".theme-toggle");
    if (!b) return;
    b.addEventListener("click", function () {
      var dark = root.classList.contains("theme-dark") ||
        (!root.classList.contains("theme-light") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark"; apply(next); set(next);
    });
  });
})();
