/* Live power cuts from the network operators' open data.
   UK Power Networks (CC BY 4.0) and Northern Powergrid (Northern Powergrid Open Data Licence v1.0). */
(function () {
  "use strict";
  var UKPN = "https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/exports/json?select=" +
    encodeURIComponent("incidentreference,nocustomeraffected,postcodesaffected,receiveddate,creationdatetime,estimatedrestorationdate,operatingzone") +
    "&where=" + encodeURIComponent('powercuttype = "Unplanned"');
  var NPG = "https://northernpowergrid.opendatasoft.com/api/explore/v2.1/catalog/datasets/live-power-cuts-data/exports/json?select=" +
    encodeURIComponent("reference,area,postcode,totalconfirmedpowercut,totalpredictedpowercut,loggedtime,estimatedtimetillresolution") +
    "&where=" + encodeURIComponent('natureofoutage != "Planned Work on System"');
  var REFRESH_MS = 3 * 60 * 1000;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function title(s) {
    var t = String(s || "").toLowerCase().replace(/\bzone\b/g, "").trim();
    // UK Power Networks names some London zones by compass point only; the postcode says more.
    if (/^(north|south|east|west|central)( (north|south|east|west))?$/.test(t)) return "";
    return t.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function district(pc) {
    pc = String(pc || "").trim().toUpperCase().replace(/\s+/g, " ");
    return pc.split(" ")[0] || "";
  }
  function parseTime(s) { if (!s || /^0001/.test(s)) return null; var d = new Date(s); return isNaN(d) ? null : d; }
  function fmtTime(d) {
    if (!d) return "";
    var now = new Date(), same = d.toDateString() === now.toDateString();
    var t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return same ? t : d.toLocaleDateString("en-GB", { weekday: "short" }) + " " + t;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function normalise(ukpn, npg) {
    var out = [];
    (ukpn || []).forEach(function (r) {
      var pcs = String(r.postcodesaffected || "").split(";").map(district).filter(Boolean);
      var uniq = pcs.filter(function (p, i) { return pcs.indexOf(p) === i; });
      out.push({
        id: r.incidentreference, place: title(r.operatingzone), pc: uniq.slice(0, 2).join(", "),
        homes: r.nocustomeraffected || 0, since: parseTime(r.receiveddate) || parseTime(r.creationdatetime),
        etr: parseTime(r.estimatedrestorationdate), region: "London & South East", src: "UK Power Networks"
      });
    });
    var byRef = {};
    (npg || []).forEach(function (r) {
      var k = r.reference; if (!k) return;
      var pc = district(Array.isArray(r.postcode) ? r.postcode[0] : r.postcode);
      var homes = Math.max(r.totalconfirmedpowercut || 0, r.totalpredictedpowercut || 0);
      if (!byRef[k]) byRef[k] = { id: k, place: r.area || "", pcs: [], homes: 0, since: parseTime(r.loggedtime), etr: parseTime(r.estimatedtimetillresolution), region: r.area || "North East & Yorkshire", src: "Northern Powergrid" };
      var e = byRef[k];
      if (pc && e.pcs.indexOf(pc) < 0) e.pcs.push(pc);
      e.homes = Math.max(e.homes, homes);
    });
    Object.keys(byRef).forEach(function (k) { var e = byRef[k]; e.pc = e.pcs.slice(0, 2).join(", "); out.push(e); });
    out.sort(function (a, b) { return (b.since ? b.since.getTime() : 0) - (a.since ? a.since.getTime() : 0); });
    return out;
  }

  function itemHtml(c, long) {
    var bits = [];
    if (c.homes > 0) bits.push(c.homes.toLocaleString("en-GB") + (c.homes === 1 ? " home" : " homes"));
    if (c.since) bits.push("since " + fmtTime(c.since));
    if (long) bits.push(c.etr ? "estimated back " + fmtTime(c.etr) : "no estimate yet");
    var where = [c.pc ? "<b>" + esc(c.pc) + "</b>" : "", c.place ? esc(c.place) : ""].filter(Boolean).join(" ");
    return where + (bits.length ? " · " + esc(bits.join(" · ")) : "");
  }

  function render(list, updated) {
    var homes = list.reduce(function (s, c) { return s + (c.homes || 0); }, 0);
    var count = list.length;
    var headline = count + " unplanned power cut" + (count === 1 ? "" : "s") + " right now";
    var t = document.getElementById("live-ticker");
    if (t) {
      t.hidden = false;
      t.querySelector(".lt-count").textContent = headline;
      var track = t.querySelector(".lt-items");
      var items = list.slice(0, 14).map(function (c) { return '<span class="lt-item">' + itemHtml(c, false) + "</span>"; }).join("");
      track.innerHTML = items + (reduced ? "" : items);
      track.style.animationDuration = Math.max(30, list.slice(0, 14).length * 6) + "s";
      track.classList.toggle("still", reduced);
    }
    var p = document.getElementById("live-panel");
    if (p) {
      p.hidden = false;
      p.querySelector(".lp-count").textContent = count;
      p.querySelector(".lp-homes").textContent = homes > 0 ? homes.toLocaleString("en-GB") : "–";
      p.querySelector(".lp-updated").textContent = "Updated " + updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      var ul = p.querySelector(".lp-list");
      ul.innerHTML = list.slice(0, 10).map(function (c) {
        return '<li><span class="lp-dot" aria-hidden="true"></span><span class="lp-txt">' + itemHtml(c, true) + '</span><span class="lp-src">' + esc(c.src) + "</span></li>";
      }).join("") || "<li><span class=\"lp-txt\">No unplanned power cuts reported in these areas right now.</span></li>";
    }
  }

  function fail() {
    var t = document.getElementById("live-ticker"); if (t) t.hidden = true;
    var p = document.getElementById("live-panel");
    if (p) { p.hidden = false; p.querySelector(".lp-list").innerHTML = '<li><span class="lp-txt">Live data isn\'t available right now. Check <a href="https://www.powercut105.com/">powercut105.com</a> or call 105.</span></li>'; }
  }


  /* Latest power cut news: headlines and summaries written by Power Cut Planner, linking to the original reports. */
  function loadNews() {
    var box = document.getElementById("news-feed");
    if (!box) return;
    getJSON("/assets/news.json?t=" + Math.floor(Date.now() / 60000)).then(function (d) {
      var items = (d.items || []).slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      if (!items.length) { box.hidden = true; return; }
      box.hidden = false;
      var upd = box.querySelector(".nf-updated");
      if (upd && d.updated) upd.textContent = "Updated " + new Date(d.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      box.querySelector(".gf-list").innerHTML = items.slice(0, 6).map(function (r) {
        var dt = new Date(r.date);
        return '<li><time>' + esc(dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + '</time><div><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + '</a>' +
          (r.summary ? '<p>' + esc(r.summary) + '</p>' : '') + '<span class="gf-org">' + esc(r.source || "") + '</span></div></li>';
      }).join("");
    }).catch(function () { box.hidden = true; });
  }

  function load() {
    Promise.all([
      getJSON(UKPN).catch(function () { return null; }),
      getJSON(NPG).catch(function () { return null; })
    ]).then(function (res) {
      if (!res[0] && !res[1]) { fail(); return; }
      render(normalise(res[0], res[1]), new Date());
    });
  }

  if (document.getElementById("live-ticker") || document.getElementById("live-panel")) {
    load();
    setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  }
  if (document.getElementById("news-feed")) loadNews();
})();
