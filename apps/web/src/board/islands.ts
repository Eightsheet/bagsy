/**
 * Progressive enhancement for the board. Every page is complete without any of
 * this: filters are a GET form, sorting and paging are links, disclosures are
 * native `<details>`, and every mutation is a form POST.
 *
 * The governing rule for the live-update island is that **change is announced,
 * never applied**. Nothing may move under a cursor that is halfway through a
 * "free these files" disclosure, so the island's write surface is deliberately
 * tiny and exhaustively listed below.
 */

/** How often the digest is polled. ~1.3 req/min/user against a 120/min cap. */
const POLL_MS = 45_000;
/** A laptop left open overnight must not burn the rate limit. */
const IDLE_STOP_MS = 20 * 60_000;
const RETICK_MS = 30_000;

/**
 * Re-renders relative times locally, which fixes the real bug that a
 * server-rendered "lapses in 12m" is wrong the moment a tab is left open.
 *
 * It never asserts a state transition the server owns: when a TTL crosses zero
 * it renders "lapsed" and says so in the title, and does NOT flip the badge to
 * a soft hold. The lifecycle runs lazily when somebody reads the board, and the
 * UI must not pretend otherwise.
 */
const RETICK = `
  function fmt(ms) {
    var abs = Math.abs(ms);
    if (abs < 60000) return Math.max(0, Math.round(abs / 1000)) + "s";
    if (abs < 3600000) return Math.floor(abs / 60000) + "m";
    if (abs < 86400000) {
      var h = Math.floor(abs / 3600000), m = Math.floor((abs % 3600000) / 60000);
      return m ? h + "h " + (m < 10 ? "0" : "") + m + "m" : h + "h";
    }
    var d = Math.floor(abs / 86400000), rh = Math.floor((abs % 86400000) / 3600000);
    return rh ? d + "d " + rh + "h" : d + "d";
  }
  function retick() {
    var now = Date.now();
    document.querySelectorAll("time[datetime][data-rel]").forEach(function (el) {
      var at = Date.parse(el.getAttribute("datetime"));
      if (isNaN(at)) return;
      var mode = el.getAttribute("data-rel");
      if (mode === "ago") {
        el.textContent = fmt(now - at) + " ago";
      } else if (mode === "until") {
        var left = at - now;
        el.textContent = left >= 0 ? "in " + fmt(left) : "lapsed " + fmt(-left) + " ago";
        if (left < 0 && !el.dataset.lapsed) {
          el.dataset.lapsed = "1";
          el.title = "TTL lapsed — the server marks it a soft hold on the next board read";
        }
      } else {
        el.textContent = fmt(now - at);
      }
    });
  }
  retick();
  window.setInterval(retick, ${RETICK_MS});
`;

/**
 * Announces that the board moved. The exhaustive list of what it may touch:
 * unhide the bar and set its text. It never re-renders, reorders, re-ranks,
 * navigates, moves focus, or changes any number the server produced.
 */
const DIGEST = `
  var bar = document.getElementById("stale-bar");
  if (bar) {
    var textEl = bar.querySelector("[data-stale-text]");
    var reload = bar.querySelector("[data-stale-reload]");
    if (reload) reload.setAttribute("href", location.href);
    var etag = null;
    var lastActive = Date.now();
    var timer = null;
    ["keydown", "mousemove", "click", "scroll"].forEach(function (evt) {
      window.addEventListener(evt, function () { lastActive = Date.now(); }, { passive: true });
    });
    var etagCounts = null;
    // "New soft holds" is only said when the stale count actually grew. The
    // etag also moves on every heartbeat, and dressing that up as an incident
    // is how a change bar stops being read.
    function announce(counts) {
      var bits = ["Board changed"];
      if (etagCounts && counts.stale > etagCounts.stale) {
        var grew = counts.stale - etagCounts.stale;
        bits.push(grew + " new soft hold" + (grew === 1 ? "" : "s"));
      }
      if (textEl) textEl.textContent = bits.join(" · ");
      bar.hidden = false;
    }
    function stop(message) {
      if (timer) window.clearInterval(timer);
      timer = null;
      if (textEl) textEl.textContent = message;
      bar.hidden = false;
    }
    function poll() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActive > ${IDLE_STOP_MS}) {
        stop("Not checking any more.");
        return;
      }
      fetch("/v1/web/board/digest", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.etag) return;
          if (etag === null) { etag = d.etag; etagCounts = d.counts; return; }
          if (d.etag !== etag) { announce(d.counts); etag = d.etag; etagCounts = d.counts; }
        })
        .catch(function () { /* a failed probe is not news */ });
    }
    timer = window.setInterval(poll, ${POLL_MS});
    poll();
  }
`;

/**
 * Nothing closes a `.row-manage` popover today, so on a page with many rows
 * they simply accumulate open. Escape, outside-click, and one-at-a-time.
 */
const POPOVERS = `
  document.addEventListener("click", function (e) {
    document.querySelectorAll("details.row-manage[open]").forEach(function (d) {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = document.querySelector("details.row-manage[open]");
    if (open) { open.open = false; open.querySelector("summary").focus(); }
  });
  document.addEventListener("toggle", function (e) {
    var el = e.target;
    if (!el.matches || !el.matches("details.row-manage[open]")) return;
    document.querySelectorAll("details.row-manage[open]").forEach(function (d) {
      if (d !== el) d.open = false;
    });
  }, true);
`;

/**
 * Movement is native focus movement, not a selection model — so scroll-into-view,
 * :focus-visible and screen-reader announcement are all free, and Tab walks the
 * same order when this never loads.
 */
const KEYS = `
  var search = document.querySelector(".filters input[name=q]");
  function rows() { return Array.prototype.slice.call(document.querySelectorAll(".arow th a")); }
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && t.matches && t.matches("input, select, textarea, [contenteditable]")) {
      if (e.key === "Escape" && t === search) { t.blur(); }
      return;
    }
    if (e.key === "/") { e.preventDefault(); if (search) search.focus(); return; }
    if (e.key === "?") {
      var box = document.getElementById("kbd-help");
      if (box) { e.preventDefault(); box.open = !box.open; }
      return;
    }
    if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
      var list = rows();
      if (!list.length) return;
      var back = e.key === "k" || e.key === "ArrowUp";
      var at = list.indexOf(document.activeElement);
      var next = at === -1 ? (back ? list.length - 1 : 0) : at + (back ? -1 : 1);
      if (next < 0 || next >= list.length) return;
      e.preventDefault();
      list[next].focus();
    }
  });
`;

/**
 * Narrows the rows already on the page. It says which mode it is in, because a
 * client-side filter that silently pretends to be a query is the failure mode
 * here — the server searches file paths the row never displays.
 */
const LOCAL_FILTER = `
  if (search) {
    var counter = document.createElement("p");
    counter.className = "tail";
    counter.setAttribute("role", "status");
    counter.hidden = true;
    var agate = document.getElementById("agate");
    if (agate) agate.parentNode.insertBefore(counter, agate.nextSibling);
    var total = document.querySelectorAll(".arow").length;
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      if (!q) {
        document.querySelectorAll(".arow").forEach(function (r) { r.hidden = false; });
        counter.hidden = true;
        return;
      }
      var shown = 0;
      document.querySelectorAll(".arow").forEach(function (r) {
        var hit = r.textContent.toLowerCase().indexOf(q) !== -1;
        r.hidden = !hit;
        if (hit) shown++;
      });
      counter.hidden = false;
      counter.textContent =
        "showing " + shown + " of " + total + " on this page · press Enter to search all claims, including file paths";
    });
  }
`;

function wrap(body: string): string {
  return `<script>(function(){${body}})();</script>`;
}

/** Islands for the fold: times and the change announcement. No keyboard model —
 *  findings are ranked, so the first Tab lands on the most urgent decision. */
export function foldIslands(): string {
  return wrap(`${RETICK}\n${DIGEST}\n${POPOVERS}`);
}

/** Islands for the dense table: everything above, plus movement and narrowing. */
export function boardIslands(): string {
  return wrap(`${RETICK}\n${DIGEST}\n${POPOVERS}\n${KEYS}\n${LOCAL_FILTER}`);
}

/** Islands for a single claim: times only. */
export function claimIslands(): string {
  return wrap(`${RETICK}\n${POPOVERS}`);
}
