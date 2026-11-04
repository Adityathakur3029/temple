// Inlined into <head> by vite-plugins/boot-html.ts so the boot screen paints in the
// visitor's language before any module loads (spec 07 § Language). Keep it tiny and ES5.
// The stored choice wins; otherwise Hindi when navigator.language starts with "hi".
// The build fills {{hijs:…}} with the Hindi string from hi.json.
(function () {
  var lang = null;
  try {
    lang = localStorage.getItem("sannidhi:lang-v1");
  } catch (e) {
    // Storage blocked: fall back to the browser language.
  }
  if (lang !== "hi" && lang !== "en") {
    lang =
      String(navigator.language || "")
        .toLowerCase()
        .indexOf("hi") === 0
        ? "hi"
        : "en";
  }
  document.documentElement.lang = lang;
  if (lang === "hi") document.title = "{{hijs:boot.title}}";
})();
