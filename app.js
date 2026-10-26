/* Chmod Calc — Unix permission bits <-> octal <-> symbolic. Pure local maths. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;

  var WHO = [["u", "Owner", 6], ["g", "Group", 3], ["o", "Others", 0]];
  var PERM = [["r", "Read", 4], ["w", "Write", 2], ["x", "Execute", 1]];
  var SPECIAL = [
    ["setuid", 0o4000, "Runs as the file's owner"],
    ["setgid", 0o2000, "Runs as the group; new files in a folder inherit its group"],
    ["sticky", 0o1000, "In a folder, only a file's owner can delete or rename it"]
  ];
  var PRESETS = [
    ["644", "Regular file"], ["755", "Script / folder"], ["600", "Private file"], ["700", "Private folder"],
    ["664", "Shared file"], ["775", "Shared folder"], ["400", "SSH key, read-only"], ["750", "Group can run"],
    ["1777", "/tmp style"], ["2775", "Team folder (setgid)"], ["4755", "setuid binary"], ["777", "Everyone, everything"]
  ];

  // ---------- core ----------
  function toOctal(mode) {
    var s = (mode & 0o777).toString(8).padStart(3, "0");
    return mode & 0o7000 ? ((mode >> 9) & 7) + s : s;
  }
  function toSymbolic(mode) {
    var out = "";
    WHO.forEach(function (w, i) {
      var t = (mode >> w[2]) & 7, x = t & 1;
      out += (t & 4 ? "r" : "-") + (t & 2 ? "w" : "-");
      var sp = i === 0 ? mode & 0o4000 : i === 1 ? mode & 0o2000 : mode & 0o1000, ch = i === 2 ? "t" : "s";
      out += sp ? (x ? ch : ch.toUpperCase()) : x ? "x" : "-";
    });
    return out;
  }
  // Canonical clause form, e.g. 4755 -> "u=rwxs,g=rx,o=rx"
  function toClauses(mode) {
    return WHO.map(function (w, i) {
      var t = (mode >> w[2]) & 7, s = (t & 4 ? "r" : "") + (t & 2 ? "w" : "") + (t & 1 ? "x" : "");
      if (i === 0 && mode & 0o4000) s += "s";
      if (i === 1 && mode & 0o2000) s += "s";
      if (i === 2 && mode & 0o1000) s += "t";
      return w[0] + "=" + s;
    }).join(",");
  }
  function parseOctal(str) {
    var s = String(str).trim();
    if (!/^[0-7]{1,4}$/.test(s)) return null;
    return parseInt(s, 8);
  }
  // Accepts "rwxr-xr-x", "-rwsr-xr-x" (ls -l style) or clauses "u=rwx,g+w,o-r,a+x" applied to `base`.
  function parseSymbolic(str, base) {
    var s = String(str).trim();
    var m = /^[-dlcbps]?([r-])([w-])([xsS-])([r-])([w-])([xsS-])([r-])([w-])([xtT-])$/.exec(s);
    if (m) {
      var mode = 0, c = m.slice(1);
      [0, 3, 6].forEach(function (o, i) {
        var shift = WHO[i][2];
        if (c[o] === "r") mode |= 4 << shift;
        if (c[o + 1] === "w") mode |= 2 << shift;
        var x = c[o + 2];
        if (x === "x" || x === "s" || x === "t") mode |= 1 << shift;
        if (x === "s" || x === "S") mode |= i === 0 ? 0o4000 : 0o2000;
        if (x === "t" || x === "T") mode |= 0o1000;
      });
      return mode;
    }
    if (!s) return null;
    var mode2 = base || 0, ok = true;
    s.split(",").forEach(function (cl) {
      var p = /^([ugoa]*)([+\-=])([rwxst]*)$/.exec(cl.trim());
      if (!p) { ok = false; return; }
      var who = p[1] || "a", bits = 0, mask = 0;
      if (who.indexOf("a") >= 0) who = "ugo";
      who.split("").forEach(function (w) {
        var shift = w === "u" ? 6 : w === "g" ? 3 : 0;
        mask |= 7 << shift;
        if (w === "u") mask |= 0o4000;
        if (w === "g") mask |= 0o2000;
        if (w === "o") mask |= 0o1000;
        p[3].split("").forEach(function (ch) {
          if (ch === "r") bits |= 4 << shift;
          if (ch === "w") bits |= 2 << shift;
          if (ch === "x") bits |= 1 << shift;
          if (ch === "s" && w === "u") bits |= 0o4000;
          if (ch === "s" && w === "g") bits |= 0o2000;
          if (ch === "t") bits |= 0o1000;
        });
      });
      if (p[2] === "+") mode2 |= bits;
      else if (p[2] === "-") mode2 &= ~bits;
      else mode2 = (mode2 & ~mask) | bits;
    });
    return ok ? mode2 & 0o7777 : null;
  }
  function shellQuote(name) {
    if (/^[\w@%+=:,./-]+$/.test(name)) return name;
    return "'" + name.replace(/'/g, "'\\''") + "'";
  }
  function describe(mode) {
    var lines = WHO.map(function (w) {
      var t = (mode >> w[2]) & 7, can = [];
      if (t & 4) can.push("read");
      if (t & 2) can.push("write");
      if (t & 1) can.push("execute");
      return [w[1], can.length ? "can " + (can.length > 1 ? can.slice(0, -1).join(", ") + " and " + can[can.length - 1] : can[0]) : "has no access"];
    });
    SPECIAL.forEach(function (sp) { if (mode & sp[1]) lines.push([sp[0], sp[2]]); });
    return lines;
  }

  // ---------- UI ----------
  var mode = S3.store("chmod.mode");
  if (typeof mode !== "number") mode = 0o755;
  var octal = $("#octal"), symbolic = $("#symbolic"), err = $("#parse-err");
  var tbody = $("#grid tbody");

  WHO.forEach(function (w) {
    var tr = h("tr", null, [h("th", { scope: "row", text: w[1] })]);
    PERM.forEach(function (p) {
      var bit = p[2] << w[2];
      tr.appendChild(h("td", null, [h("label", { "class": "perm" }, [
        h("input", { type: "checkbox", "data-bit": bit, "aria-label": w[1] + " " + p[1].toLowerCase() }),
        h("span", { text: p[0] })
      ])]));
    });
    tbody.appendChild(tr);
  });
  SPECIAL.forEach(function (sp) {
    $("#specials").appendChild(h("label", { "class": "check", title: sp[2] }, [
      h("input", { type: "checkbox", "data-bit": sp[1] }), h("span", { text: sp[0] })
    ]));
  });
  PRESETS.forEach(function (p) {
    $("#presets").appendChild(h("button", { "class": "preset", "data-mode": p[0] }, [h("b", { "class": "mono", text: p[0] }), h("span", { text: p[1] })]));
  });

  function render(from) {
    $$("input[data-bit]").forEach(function (c) { c.checked = !!(mode & +c.dataset.bit); });
    if (from !== "octal") octal.value = toOctal(mode);
    if (from !== "symbolic") symbolic.value = toSymbolic(mode);
    var file = shellQuote($("#file").value.trim() || "file"), r = $("#recursive").checked ? "-R " : "";
    $("#cmd-oct").textContent = "chmod " + r + toOctal(mode) + " " + file;
    $("#cmd-sym").textContent = "chmod " + r + toClauses(mode) + " " + file;
    var ex = $("#explain"); ex.textContent = "";
    describe(mode).forEach(function (l) { ex.appendChild(h("li", null, [h("b", { text: l[0] }), " " + l[1]])); });
    var flags = $("#flags"); flags.textContent = "";
    if ((mode & 0o777) === 0o777) flags.appendChild(h("span", { "class": "chip bad", text: "Anyone can change or replace this" }));
    else if (mode & 0o002) flags.appendChild(h("span", { "class": "chip warn", text: "World-writable" }));
    if (mode & 0o4000 && mode & 0o022) flags.appendChild(h("span", { "class": "chip bad", text: "setuid + writable by others: risky" }));
    if (((mode >> 6) & 7) < (mode & 7)) flags.appendChild(h("span", { "class": "chip warn", text: "Others have more access than the owner" }));
    if (!flags.childNodes.length) flags.appendChild(h("span", { "class": "chip ok", text: "Looks sensible" }));
    $$(".preset").forEach(function (b) { b.setAttribute("aria-pressed", String(parseInt(b.dataset.mode, 8) === mode)); });
    S3.store("chmod.mode", mode);
  }

  document.addEventListener("change", function (e) {
    var bit = e.target.dataset && e.target.dataset.bit;
    if (!bit) return;
    mode = e.target.checked ? mode | +bit : mode & ~+bit;
    err.textContent = ""; render();
  });
  octal.addEventListener("input", function () {
    var v = parseOctal(octal.value);
    if (v === null) { err.textContent = octal.value.trim() ? "Octal uses digits 0–7, up to 4 of them (e.g. 755 or 4755)." : ""; return; }
    err.textContent = ""; mode = v; render("octal");
  });
  symbolic.addEventListener("input", function () {
    var v = parseSymbolic(symbolic.value, symBase);
    if (v === null) { err.textContent = symbolic.value.trim() ? "Try rwxr-xr-x, -rw-r--r-- or u=rwx,g=rx,o=" : ""; return; }
    err.textContent = ""; mode = v;
    render("symbolic");
  });
  // clauses like "g+w" apply to the mode as it was when the field got focus, not once per keystroke
  var symBase = mode;
  symbolic.addEventListener("focus", function () { symBase = mode; });
  [octal, symbolic].forEach(function (el) { el.addEventListener("blur", function () { err.textContent = ""; render(); }); });
  $("#file").addEventListener("input", function () { render(); });
  $("#recursive").addEventListener("change", function () { render(); });
  $("#presets").addEventListener("click", function (e) {
    var b = e.target.closest(".preset"); if (!b) return;
    mode = parseInt(b.dataset.mode, 8); err.textContent = ""; render(); S3.done();
  });
  $("#reset").addEventListener("click", function () { mode = 0o644; render(); });
  $("#copy-oct").addEventListener("click", function () { S3.copy($("#cmd-oct").textContent); S3.done(); });
  $("#copy-sym").addEventListener("click", function () { S3.copy($("#cmd-sym").textContent); S3.done(); });

  render();

  window.S3_DEMO = function () { mode = 0o2775; $("#file").value = "/srv/shared"; $("#recursive").checked = true; render(); };

  window.S3_SELFTEST = function () {
    var t = [
      toOctal(0o755) === "755", toSymbolic(0o755) === "rwxr-xr-x",
      toOctal(0o4755) === "4755", toSymbolic(0o4755) === "rwsr-xr-x",
      toSymbolic(0o1777) === "rwxrwxrwt", toSymbolic(0o2644) === "rw-r-Sr--", toSymbolic(0o1754) === "rwxr-xr-T",
      toClauses(0o4750) === "u=rwxs,g=rx,o=", toClauses(0o644) === "u=rw,g=r,o=r",
      parseOctal("0644") === 0o644, parseOctal("8") === null, parseOctal("12345") === null,
      parseSymbolic("rwxr-x---") === 0o750, parseSymbolic("-rwsr-xr-x") === 0o4755, parseSymbolic("drwxrwxrwt") === 0o1777,
      parseSymbolic("u=rw,go=r", 0) === 0o644, parseSymbolic("+x", 0o644) === 0o755, parseSymbolic("g-w,o-rwx", 0o775) === 0o750,
      parseSymbolic("u+s", 0o755) === 0o4755, parseSymbolic("q=r", 0) === null,
      shellQuote("a b") === "'a b'", shellQuote("it's") === "'it'\\''s'", shellQuote("/srv/app.sh") === "/srv/app.sh"
    ];
    // round trip every mode
    for (var m = 0; m < 0o10000; m++) if (parseSymbolic(toSymbolic(m)) !== m || parseOctal(toOctal(m)) !== m || parseSymbolic(toClauses(m), 0o777) !== m) return "roundtrip " + m.toString(8);
    var bad = t.indexOf(false);
    return bad < 0 ? true : "check " + bad;
  };
})();
