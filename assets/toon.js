// Cartoon theme: the mascot in the results panel reacts to the answer.
(function () {
  var img = document.getElementById("meter-bulb"), count = document.getElementById("m-count");
  if (!img || !count) return;
  var base = img.src.replace(/mascot-[a-z]+\.svg.*$/, "");
  var mood = "point";
  function set(m) {
    if (m === mood) return;
    mood = m; img.src = base + "mascot-" + m + ".svg";
    img.classList.remove("pop"); void img.offsetWidth; img.classList.add("pop");
  }
  function check() {
    var n = parseInt(count.textContent, 10);
    if (isNaN(n)) return;
    set(n === 0 ? "worried" : "happy");
  }
  new MutationObserver(check).observe(count, { childList: true, characterData: true, subtree: true });
  check();
  ["happy", "worried"].forEach(function (m) { var i = new Image(); i.src = base + "mascot-" + m + ".svg"; });
})();
