/* Power Cut Planner: plug-in solar savings calculator.
   Model: PVGIS monthly yield per kWp for the region, tilt and direction, spread over an
   average day (half-sine between sunrise and sunset), split into sunny and dull days,
   capped at 800 W AC, and matched against a simple household load profile. */
(function () {
  "use strict";
  var D = window.SOLAR;
  if (!D) return;
  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MID_N = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];
  var TILT = { wall: 90, angled: 60, frame: 35, flat: 15 };
  var MOUNT_TXT = { wall: "on a balcony or wall", angled: "on a steep frame", frame: "on a garden or flat-roof frame", flat: "almost flat" };
  var ASPECT = { s: 0, sesw: 45, ew: 90 };
  var DIR_TXT = { s: "south", sesw: "south-east or south-west", ew: "east or west", n: "north" };
  var NORTH = { 15: 0.85, 35: 0.65, 60: 0.45, 90: 0.4 };
  var SHADE = { none: 1, some: 0.8, lots: 0.55 };
  var HOMES = {
    small: { base: 0.12, morn: 0.25, day: 0.12, eve: 0.30 },
    mid:   { base: 0.18, morn: 0.40, day: 0.20, eve: 0.50 },
    big:   { base: 0.25, morn: 0.55, day: 0.30, eve: 0.70 }
  };
  var AWAY = { out: 0.15, some: 0.55, most: 1 };
  var AC_CAP = 0.8;
  var DAYTYPES = [[1.8, 0.35], [0.9, 0.35], [0.18, 0.3]];
  var STEPS = 96;

  var state = {
    region: "london", mount: "frame", dir: "s", shade: "none",
    kit: null, w: 900, price: 500, home: "mid", away: "some",
    rate: D.rate, exp: 0, month: 5
  };
  var KIT = {};
  D.kits.forEach(function (k) { KIT[k.id] = k; });

  function perKwp(s) {
    var tilt = TILT[s.mount];
    if (s.dir === "n") return D.pv[s.region]["90_" + tilt].map(function (v) { return v * NORTH[tilt]; });
    return D.pv[s.region][ASPECT[s.dir] + "_" + tilt];
  }

  function dayLength(lat, m) {
    var decl = 23.44 * Math.sin(2 * Math.PI * (284 + MID_N[m]) / 365) * Math.PI / 180;
    var x = -Math.tan(lat * Math.PI / 180) * Math.tan(decl);
    x = Math.max(-1, Math.min(1, x));
    return 2 * Math.acos(x) * 180 / Math.PI / 15;
  }

  function loadAt(t, h, aw) {
    var l = h.base;
    if (t >= 6.5 && t < 8) l += h.morn;
    if (t >= 8 && t < 17) l += h.day * aw;
    if (t >= 17 && t < 22.5) l += h.eve;
    return l;
  }

  /* Returns yearly and monthly kWh, plus an average-day curve for each month. */
  function simulate(s, watts, withCurves) {
    var per = perKwp(s), lat = D.regions[s.region].lat, shade = SHADE[s.shade];
    var h = HOMES[s.home], aw = AWAY[s.away];
    var res = { months: [], gen: 0, used: 0 };
    for (var m = 0; m < 12; m++) {
      var eDay = per[m] * (watts / 1000) * shade / DAYS[m];
      var L = dayLength(lat, m) * 0.92;
      var noon = (m >= 3 && m <= 9) ? 13 : 12;
      var start = noon - L / 2;
      var pk = eDay * Math.PI / (2 * L);
      var gen = 0, used = 0, curve = withCurves ? [] : null;
      for (var i = 0; i < STEPS; i++) {
        var t = (i + 0.5) * 24 / STEPS;
        var x = (t - start) / L;
        var g = (x > 0 && x < 1) ? pk * Math.sin(Math.PI * x) : 0;
        var ld = loadAt(t, h, aw);
        var gA = 0, uA = 0;
        for (var j = 0; j < DAYTYPES.length; j++) {
          var gg = Math.min(g * DAYTYPES[j][0], AC_CAP);
          var u = 0.92 * Math.min(gg, h.base) + 0.75 * Math.min(Math.max(gg - h.base, 0), Math.max(ld - h.base, 0));
          gA += gg * DAYTYPES[j][1];
          uA += u * DAYTYPES[j][1];
        }
        gen += gA * 24 / STEPS;
        used += uA * 24 / STEPS;
        if (curve) curve.push([gA, uA, ld]);
      }
      var mo = { gen: gen * DAYS[m], used: used * DAYS[m], rise: start, set: start + L, peak: pk };
      if (curve) mo.curve = curve;
      res.months.push(mo);
      res.gen += mo.gen;
      res.used += mo.used;
    }
    res.exported = res.gen - res.used;
    res.save = (res.used * s.rate + res.exported * s.exp) / 100;
    return res;
  }

  function money(v) { return "£" + Math.round(v).toLocaleString("en-GB"); }
  function kwh(v) { return Math.round(v).toLocaleString("en-GB") + " kWh"; }
  function years(price, save) {
    if (save <= 0.5) return null;
    return price / save;
  }
  function yearsText(y) {
    if (y === null) return "never";
    if (y < 1) return "under a year";
    var half = Math.round(y * 2) / 2;
    var whole = Math.floor(half);
    var txt = (half % 1) ? (whole ? whole + "½" : "½") : String(whole);
    return "about " + txt + " year" + (half === 1 ? "" : "s");
  }
  function tenYear(save, price) {
    var t = 0;
    for (var y = 0; y < 10; y++) t += save * Math.pow(0.995, y);
    return t - price;
  }

  function currentKit() {
    if (state.kit && KIT[state.kit]) return KIT[state.kit];
    return null;
  }
  function watts() { var k = currentKit(); return k ? k.w : state.w; }
  function price() { var k = currentKit(); return k ? k.price : state.price; }

  /* ---------- Inputs ---------- */
  function setupSeg() {
    document.querySelectorAll(".seg").forEach(function (g) {
      var key = g.dataset.k;
      g.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.v === state[key]));
        b.addEventListener("click", function () {
          state[key] = b.dataset.v;
          g.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          update();
        });
      });
    });
  }

  function setupKitSelect() {
    var sel = $("s-kit");
    var byPrice = D.kits.slice().sort(function (a, b) { return a.price - b.price; });
    byPrice.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.brand + " " + k.name + " (" + k.w + " W, £" + Math.round(k.price) + ")";
      sel.appendChild(o);
    });
    var c = document.createElement("option");
    c.value = "custom";
    c.textContent = "My own kit: enter watts and price";
    sel.appendChild(c);
    sel.addEventListener("change", function () {
      if (sel.value === "custom") {
        var k = currentKit();
        if (k) { state.w = k.w; state.price = Math.round(k.price); }
        state.kit = null;
        $("s-w").value = state.w;
        $("s-price").value = state.price;
      } else {
        state.kit = sel.value;
      }
      $("s-custom").hidden = sel.value !== "custom";
      update();
    });
    ["s-w", "s-price"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        var w = Number($("s-w").value), p = Number($("s-price").value);
        if (w > 0) state.w = Math.min(w, 2000);
        if (p >= 0) state.price = p;
        update();
      });
    });
    $("s-region").addEventListener("change", function () { state.region = this.value; update(); });
    $("s-rate").addEventListener("input", function () { var v = Number(this.value); if (v > 0) { state.rate = v; update(); } });
    $("s-exp").addEventListener("input", function () { var v = Number(this.value); if (v >= 0) { state.exp = v; update(); } });
  }

  function pickDefaultKit() {
    var best = null, bestY = Infinity;
    D.kits.forEach(function (k) {
      if (!k.mount || k.stock !== "In stock") return;
      var r = simulate(state, k.w, false);
      var y = years(k.price, r.save);
      if (y !== null && y < bestY) { bestY = y; best = k; }
    });
    state.kit = best ? best.id : D.kits[0].id;
    $("s-kit").value = state.kit;
  }

  /* ---------- Day chart ---------- */
  var X0 = 34, X1 = 350, YB = 150, YT = 16;
  var shown = null, target = null, anim = null, yMax = 1;

  function xs(t) { return X0 + (t / 24) * (X1 - X0); }
  function ys(v) { return YB - (v / yMax) * (YB - YT); }

  function areaPath(curve, idx) {
    var d = "M" + X0 + " " + YB;
    for (var i = 0; i < curve.length; i++) {
      var t = (i + 0.5) * 24 / STEPS;
      d += " L" + xs(t).toFixed(1) + " " + ys(curve[i][idx]).toFixed(1);
    }
    return d + " L" + X1 + " " + YB + " Z";
  }
  function linePath(curve, idx) {
    var d = "";
    for (var i = 0; i < curve.length; i++) {
      var t = (i + 0.5) * 24 / STEPS;
      d += (i ? " L" : "M") + xs(t).toFixed(1) + " " + ys(curve[i][idx]).toFixed(1);
    }
    return d;
  }

  function niceMax(v) {
    var steps = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return Math.ceil(v * 5) / 5;
  }

  function buildChart() {
    var svg = $("o-day");
    var ticks = "";
    [0, 6, 12, 18, 24].forEach(function (h) {
      ticks += '<text class="dc-x" x="' + xs(h) + '" y="' + (YB + 16) + '" text-anchor="' + (h === 24 ? "end" : h === 0 ? "start" : "middle") + '">' + (h < 10 ? "0" : "") + h + ':00</text>';
    });
    svg.innerHTML =
      '<defs><linearGradient id="dcSun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5B641" stop-opacity=".55"/><stop offset="1" stop-color="#F5B641" stop-opacity=".08"/></linearGradient></defs>' +
      '<rect class="dc-night" id="dc-n1" x="' + X0 + '" y="' + YT + '" width="0" height="' + (YB - YT) + '"/>' +
      '<rect class="dc-night" id="dc-n2" x="' + X1 + '" y="' + YT + '" width="0" height="' + (YB - YT) + '"/>' +
      '<g id="dc-grid"></g>' +
      '<path id="dc-gen" fill="url(#dcSun)"/>' +
      '<path id="dc-used" class="dc-used"/>' +
      '<path id="dc-load" class="dc-load" fill="none"/>' +
      '<line class="dc-axis" x1="' + X0 + '" y1="' + YB + '" x2="' + X1 + '" y2="' + YB + '"/>' +
      '<g id="dc-sun"><circle r="9" class="dc-sun"/><g class="dc-rays">' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) {
        var r = a * Math.PI / 180;
        return '<line x1="' + (13 * Math.cos(r)).toFixed(1) + '" y1="' + (13 * Math.sin(r)).toFixed(1) + '" x2="' + (18 * Math.cos(r)).toFixed(1) + '" y2="' + (18 * Math.sin(r)).toFixed(1) + '"/>';
      }).join("") + '</g></g>' + ticks;
  }

  function drawGrid() {
    var g = "", half = yMax / 2;
    [half, yMax].forEach(function (v) {
      var y = ys(v).toFixed(1);
      g += '<line class="dc-gl" x1="' + X0 + '" y1="' + y + '" x2="' + X1 + '" y2="' + y + '"/>' +
        '<text class="dc-y" x="' + (X0 - 4) + '" y="' + (Number(y) + 3) + '" text-anchor="end">' + Math.round(v * 1000) + ' W</text>';
    });
    $("dc-grid").innerHTML = g;
  }

  function drawFrame(f) {
    $("dc-gen").setAttribute("d", areaPath(f.curve, 0));
    $("dc-used").setAttribute("d", areaPath(f.curve, 1));
    $("dc-load").setAttribute("d", linePath(f.curve, 2));
    var n1 = $("dc-n1"), n2 = $("dc-n2");
    n1.setAttribute("width", Math.max(0, xs(f.rise) - X0).toFixed(1));
    n2.setAttribute("x", xs(f.set).toFixed(1));
    n2.setAttribute("width", Math.max(0, X1 - xs(f.set)).toFixed(1));
    var noon = (f.rise + f.set) / 2;
    var sunY = YB - 30 - Math.min(1, (f.set - f.rise) / 17) * (YB - YT - 46);
    $("dc-sun").setAttribute("transform", "translate(" + xs(noon).toFixed(1) + " " + sunY.toFixed(1) + ")");
  }

  function lerpFrame(a, b, p) {
    var c = [];
    for (var i = 0; i < a.curve.length; i++) {
      c.push([
        a.curve[i][0] + (b.curve[i][0] - a.curve[i][0]) * p,
        a.curve[i][1] + (b.curve[i][1] - a.curve[i][1]) * p,
        a.curve[i][2] + (b.curve[i][2] - a.curve[i][2]) * p
      ]);
    }
    return { curve: c, rise: a.rise + (b.rise - a.rise) * p, set: a.set + (b.set - a.set) * p };
  }

  function showMonth(mo, instant) {
    target = mo;
    if (anim) cancelAnimationFrame(anim);
    if (!shown || instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown = mo; drawFrame(mo); return;
    }
    var from = shown, t0 = performance.now(), dur = 420;
    function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      shown = lerpFrame(from, target, e);
      drawFrame(shown);
      if (p < 1) anim = requestAnimationFrame(step);
      else { shown = target; anim = null; }
    }
    anim = requestAnimationFrame(step);
  }

  /* ---------- Month bars ---------- */
  function buildMonths() {
    var box = $("o-months"), html = "";
    for (var m = 0; m < 12; m++) {
      html += '<button type="button" class="mb" data-m="' + m + '" aria-pressed="false">' +
        '<span class="mb-bar"><span class="mb-gen"></span><span class="mb-used"></span></span>' +
        '<span class="mb-l">' + MONTHS[m].charAt(0) + '<span class="mb-rest">' + MONTHS[m].slice(1) + '</span></span></button>';
    }
    box.innerHTML = html;
    box.querySelectorAll(".mb").forEach(function (b) {
      b.addEventListener("click", function () { stopPlay(); state.month = Number(b.dataset.m); renderMonth(); });
    });
  }

  var lastRes = null;
  function renderMonth(instant) {
    var r = lastRes, m = state.month, mo = r.months[m];
    document.querySelectorAll("#o-months .mb").forEach(function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.m) === m));
    });
    $("o-month-l").textContent = MONTHS_LONG[m];
    $("o-month-v").textContent = "Average day: " + (mo.gen / DAYS[m]).toFixed(1) + " kWh made · " + money(mo.used * state.rate / 100 + (mo.gen - mo.used) * state.exp / 100) + " saved this month";
    showMonth(mo, instant);
  }

  var playing = null;
  function stopPlay() {
    if (playing) { clearInterval(playing); playing = null; }
    $("o-play").textContent = "▶ Watch a year";
    $("o-play").setAttribute("aria-pressed", "false");
  }
  function play() {
    if (playing) { stopPlay(); return; }
    $("o-play").textContent = "❚❚ Pause";
    $("o-play").setAttribute("aria-pressed", "true");
    var back = state.month;
    state.month = 0;
    renderMonth();
    var count = 0;
    playing = setInterval(function () {
      count++;
      if (count >= 12) { stopPlay(); state.month = back; renderMonth(); return; }
      state.month = count;
      renderMonth();
    }, 650);
  }

  /* ---------- Number tween ---------- */
  var shownSave = null;
  function tweenSave(to) {
    var el = $("o-save");
    if (shownSave === null || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownSave = to; el.textContent = money(to); return;
    }
    var from = shownSave, t0 = performance.now();
    function step(now) {
      var p = Math.min(1, (now - t0) / 380);
      var v = from + (to - from) * (1 - Math.pow(1 - p, 3));
      el.textContent = money(v);
      if (p < 1) requestAnimationFrame(step); else shownSave = to;
    }
    requestAnimationFrame(step);
  }

  /* ---------- Kits table ---------- */
  var KITS_SHOWN = 8, showAllKits = false;
  function renderKits() {
    var rows = D.kits.map(function (k) {
      var r = simulate(state, k.w, false);
      return { k: k, save: r.save, y: years(k.price, r.save) };
    }).sort(function (a, b) {
      var ay = a.y === null ? 1e9 : a.y, by = b.y === null ? 1e9 : b.y;
      return ay - by;
    });
    var html = "";
    rows.forEach(function (row, i) {
      var k = row.k;
      var hide = !showAllKits && i >= KITS_SHOWN && state.kit !== k.id;
      var badges = "";
      if (i === 0) badges += '<span class="kb kb-best">Fastest payback</span>';
      if (k.stock !== "In stock") badges += '<span class="kb">' + k.stock + '</span>';
      if (!k.mount) badges += '<span class="kb">No mount included</span>';
      if (k.flex) badges += '<span class="kb kb-warn">Flexible panels: check fire rating</span>';
      var isCur = state.kit === k.id;
      html += '<li class="kr' + (isCur ? " is-cur" : "") + '" id="kit-' + k.id + '"' + (hide ? " hidden" : "") + '>' +
        '<span class="kr-rank">' + (i + 1) + '</span>' +
        '<div class="kr-main"><span class="kr-brand">' + k.brand + '</span><b class="kr-name">' + k.name + '</b>' +
        '<span class="kr-meta">' + k.w + ' W of panels · £' + k.price.toLocaleString("en-GB", { minimumFractionDigits: k.price % 1 ? 2 : 0 }) + ' at ' + k.where +
        ' · <a href="' + k.ena_url + '" rel="nofollow noopener" target="_blank">ENA listing</a></span>' +
        (badges ? '<span class="kr-badges">' + badges + '</span>' : "") + '</div>' +
        '<div class="kr-num"><b>' + money(row.save) + '</b><span>a year</span></div>' +
        '<div class="kr-num"><b>' + (row.y === null ? "–" : (Math.round(row.y * 10) / 10).toFixed(1)) + '</b><span>years to pay back</span></div>' +
        '<div class="kr-act"><button type="button" class="kr-use" data-id="' + k.id + '"' + (isCur ? ' disabled' : '') + '>' + (isCur ? "In the calculator" : "Use this kit") + '</button>' +
        '<a class="kr-shop" href="' + k.url + '" rel="nofollow noopener" target="_blank">Shop at ' + k.where + '</a></div>' +
        '</li>';
    });
    $("kits-body").innerHTML = html;
    var more = $("kits-more");
    more.hidden = showAllKits;
    more.textContent = "Show all " + rows.length + " kits";
    $("kits-body").querySelectorAll(".kr-use").forEach(function (b) {
      b.addEventListener("click", function () {
        state.kit = b.dataset.id;
        $("s-kit").value = state.kit;
        $("s-custom").hidden = true;
        update();
        $("calc").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    $("kits-setup").textContent = MOUNT_TXT[state.mount] + ", facing " + DIR_TXT[state.dir] + ", in " + D.regions[state.region].label;
  }

  /* ---------- Main update ---------- */
  function update() {
    var w = watts(), p = price();
    var r = simulate(state, w, true);
    lastRes = r;
    var y = years(p, r.save);
    tweenSave(r.save);
    $("dock-save").textContent = money(r.save);
    $("dock-pay").textContent = y === null ? "" : "Pays back in " + yearsText(y).replace("about ", "~");
    $("o-pay").innerHTML = y === null ? "Wouldn't pay for itself" : "Pays for itself in <b>" + yearsText(y) + "</b>";
    $("o-pay").classList.toggle("is-good", y !== null && y <= 5);
    $("o-gen").textContent = kwh(r.gen);
    $("o-used").textContent = (r.gen ? Math.round(r.used / r.gen * 100) : 0) + "%";
    var ten = tenYear(r.save, p);
    $("o-ten").textContent = (ten < 0 ? "−" : "+") + money(Math.abs(ten));
    $("o-ten").classList.toggle("is-neg", ten < 0);

    // chart scale fixed across months so the seasons are comparable
    var mx = 0;
    r.months.forEach(function (mo) { mo.curve.forEach(function (c) { if (c[0] > mx) mx = c[0]; if (c[2] > mx) mx = c[2]; }); });
    yMax = niceMax(mx * 1.08);
    drawGrid();

    var maxGen = Math.max.apply(null, r.months.map(function (mo) { return mo.gen; })) || 1;
    document.querySelectorAll("#o-months .mb").forEach(function (b) {
      var mo = r.months[Number(b.dataset.m)];
      b.querySelector(".mb-gen").style.height = (mo.gen / maxGen * 100).toFixed(1) + "%";
      b.querySelector(".mb-used").style.height = (mo.used / maxGen * 100).toFixed(1) + "%";
      b.setAttribute("aria-label", MONTHS_LONG[Number(b.dataset.m)] + ": " + kwh(mo.gen) + " made, " + kwh(mo.used) + " used at home");
    });
    renderMonth();

    var k = currentKit();
    var name = k ? "The " + k.brand + " " + k.name : "A kit with " + w + " W of panels,";
    var exportTxt = state.exp > 0 ? " The rest is sent to the grid at " + state.exp + "p per kWh." : " The rest goes to the grid for free.";
    var warn = state.dir === "n" ? ' <span class="so-warn">North-facing panels make much less, and this is a rough estimate.</span>' : "";
    $("o-explain").innerHTML = name + " " + MOUNT_TXT[state.mount] + ", facing " + DIR_TXT[state.dir] + " in " + D.regions[state.region].label +
      ", would make about <b>" + kwh(r.gen) + "</b> a year. Your home would use about " + Math.round(r.used / Math.max(r.gen, 1) * 100) +
      "% of it as it's made, saving <b>" + money(r.save) + " a year</b> at " + state.rate + "p per kWh." + exportTxt + warn;
    renderKits();
  }

  D.simulate = function (o, w) { var s = {}; for (var k in state) s[k] = state[k]; for (k in o) s[k] = o[k]; return simulate(s, w, false); };

  /* Mobile: keep the saving in view while the answers are being changed. */
  function setupDock() {
    var dock = $("sol-dock");
    if (!("IntersectionObserver" in window)) return;
    var outSeen = false, formSeen = false;
    function sync() { dock.hidden = outSeen || !formSeen || innerWidth >= 920; }
    new IntersectionObserver(function (en) { outSeen = en[0].isIntersecting; sync(); }, { threshold: 0.15 }).observe($("calc-out"));
    new IntersectionObserver(function (en) { formSeen = en[0].isIntersecting; sync(); }).observe(document.querySelector(".sol-in"));
    addEventListener("resize", sync);
  }

  function init() {
    $("kits-more").addEventListener("click", function () { showAllKits = true; renderKits(); });
    setupSeg();
    setupKitSelect();
    buildChart();
    buildMonths();
    var now = new Date().getMonth();
    state.month = (now >= 3 && now <= 8) ? now : 5;
    pickDefaultKit();
    update();
    renderMonth(true);
    $("o-play").addEventListener("click", play);
    setupDock();
    // Play the year once when the chart first scrolls into view.
    var chart = $("o-day");
    if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { io.disconnect(); setTimeout(function () { if (!playing) { play(); } }, 400); }
      }, { threshold: 0.6 });
      io.observe(chart);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
