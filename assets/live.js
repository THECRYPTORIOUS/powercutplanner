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


  /* Latest relevant news from GOV.UK (Open Government Licence v3.0). */
  var GOV_BASE = "https://www.gov.uk/api/search.json?filter_content_purpose_supergroup=news_and_communications&count=40&fields=title,description,link,public_timestamp,organisations";
  var GOV_QUERIES = [
    "&filter_organisations=cabinet-office&q=" + encodeURIComponent("prepare emergency resilience winter"),
    "&q=" + encodeURIComponent("power cut electricity outage blackout"),
    "&q=" + encodeURIComponent("energy security winter supply storm")
  ];
  var KEEP = /power cut|blackout|outage|emergenc|prepared|prepare |resilien|winter weather|storm|cyber|critical infrastructure|energy security|security of supply|national risk register/i;
  var DROP = /planning act|development consent|safety zone|tribunal|\bv\b/i;

  function loadGov() {
    var box = document.getElementById("gov-feed");
    if (!box) return;
    var from = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
    Promise.all(GOV_QUERIES.map(function (q) {
      return getJSON(GOV_BASE + q + "&filter_public_timestamp=from:" + from).then(function (j) { return j.results || []; }).catch(function () { return []; });
    })).then(function (sets) {
      var seen = {}, items = [];
      sets.forEach(function (rs) {
        rs.forEach(function (r) {
          if (!r.link || seen[r.link]) return;
          var orgs = (r.organisations || []).map(function (o) { return o.slug || ""; }).join(" ");
          var text = (r.title || "") + " " + (r.description || "");
          if (!KEEP.test(text) || DROP.test(r.title || "") || /tribunal|hmcts/.test(orgs)) return;
          seen[r.link] = 1; items.push(r);
        });
      });
      items.sort(function (a, b) { return new Date(b.public_timestamp) - new Date(a.public_timestamp); });
      if (!items.length) { box.hidden = true; return; }
      box.hidden = false;
      box.querySelector(".gf-list").innerHTML = items.slice(0, 6).map(function (r) {
        var d = new Date(r.public_timestamp);
        var org = (r.organisations || []).map(function (o) { return o.acronym || o.title; }).filter(Boolean).slice(0, 2).join(", ");
        var desc = String(r.description || "");
        if (desc.length > 150) desc = desc.slice(0, 147).replace(/\s+\S*$/, "") + "…";
        return '<li><time>' + esc(d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + '</time><div><a href="https://www.gov.uk' + esc(r.link) + '">' + esc(r.title) + '</a>' +
          (desc ? '<p>' + esc(desc) + '</p>' : '') + (org ? '<span class="gf-org">' + esc(org) + '</span>' : '') + '</div></li>';
      }).join("");
    });
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
  if (document.getElementById("gov-feed")) loadGov();
})();
