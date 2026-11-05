/* Moving "mesh" of nodes behind the page tops and the sign-in page.

   - Movement is time-based, so it is equally smooth on 60Hz and 120Hz screens.
   - One shared set of nodes keeps going when you change page, so the pattern
     carries on instead of restarting.
   - It pauses when the band is scrolled out of view or the tab is hidden, and
     holds still for people who have turned motion off on their device.
   - Colours come from CSS variables (--mesh-line, --mesh-node, --mesh-hub), so
     light and dark mode each get their own.

   Usage: const mesh = MeshNodes.attach(canvas); ... mesh.destroy(); */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var LEVELS = 6; // lines are grouped into a few opacity levels, one stroke call each
  var field = { nodes: [], w: 0, h: 0 }; // shared between pages
  var active = null; // the canvas being drawn on
  var raf = 0;
  var last = 0;
  // The mouse pointer joins the mesh while it's over the band: nearby nodes
  // reach out to it. "strength" eases in and out so lines never pop.
  var pointer = { cx: 0, cy: 0, seen: false, x: 0, y: 0, strength: 0 };
  var POINTER_REACH = 170;

  function readColours(canvas) {
    var s = getComputedStyle(canvas);
    function v(name, fallback) {
      var x = s.getPropertyValue(name).trim();
      return x || fallback;
    }
    return {
      line: v('--mesh-line', '143, 189, 232'),
      lineAlpha: parseFloat(v('--mesh-line-alpha', '0.36')),
      node: v('--mesh-node', '200, 220, 240'),
      nodeAlpha: parseFloat(v('--mesh-node-alpha', '0.55')),
      hub: v('--mesh-hub', '61, 133, 198'),
    };
  }

  function wantedCount(w, h) {
    var perNode = w < 700 ? 5000 : 5600;
    return Math.round(Math.min(90, Math.max(18, (w * h) / perNode)));
  }

  function linkDistance(w) {
    return w < 700 ? 115 : 150;
  }

  function makeNode(w, h) {
    var speed = 5 + Math.random() * 9; // pixels per second
    var angle = Math.random() * Math.PI * 2;
    var hub = Math.random() < 0.16;
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hub: hub,
      phase: Math.random() * Math.PI * 2,
    };
  }

  // Match the canvas to its on-screen size (sharp on high-density screens).
  function fit() {
    var c = active.canvas;
    var cw = c.clientWidth;
    var ch = c.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!cw || !ch) return false;
    if (cw !== active.w || ch !== active.h || dpr !== active.dpr) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
      active.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      active.w = cw;
      active.h = ch;
      active.dpr = dpr;
    }
    if (cw !== field.w || ch !== field.h) {
      // Stretch the existing pattern to the new size so it carries on.
      var sx = field.w ? cw / field.w : 1;
      var sy = field.h ? ch / field.h : 1;
      for (var i = 0; i < field.nodes.length; i++) {
        field.nodes[i].x *= sx;
        field.nodes[i].y *= sy;
      }
      field.w = cw;
      field.h = ch;
    }
    var want = wantedCount(cw, ch);
    while (field.nodes.length < want) field.nodes.push(makeNode(cw, ch));
    if (field.nodes.length > want) field.nodes.length = want;
    return true;
  }

  function followPointer(dt) {
    var inside = false;
    if (pointer.seen) {
      var box = active.canvas.getBoundingClientRect();
      pointer.x = pointer.cx - box.left;
      pointer.y = pointer.cy - box.top;
      inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= box.width && pointer.y <= box.height;
    }
    pointer.strength += ((inside ? 1 : 0) - pointer.strength) * Math.min(1, dt * 5);
  }

  function step(dt) {
    var w = field.w;
    var h = field.h;
    var pad = 30; // let nodes drift a little past the edges so lines run off-screen
    for (var i = 0; i < field.nodes.length; i++) {
      var n = field.nodes[i];
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -pad) { n.x = -pad; n.vx = Math.abs(n.vx); }
      else if (n.x > w + pad) { n.x = w + pad; n.vx = -Math.abs(n.vx); }
      if (n.y < -pad) { n.y = -pad; n.vy = Math.abs(n.vy); }
      else if (n.y > h + pad) { n.y = h + pad; n.vy = -Math.abs(n.vy); }
    }
  }

  function draw(t) {
    if (!active || !field.w) return;
    var ctx = active.ctx;
    var col = active.colours;
    var nodes = field.nodes;
    var link = linkDistance(field.w);
    var link2 = link * link;
    var i, j, a, b, dx, dy, d2, k;

    ctx.clearRect(0, 0, field.w, field.h);

    var levels = [];
    for (k = 0; k < LEVELS; k++) levels.push([]);
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j];
        dx = a.x - b.x;
        if (dx > link || dx < -link) continue;
        dy = a.y - b.y;
        if (dy > link || dy < -link) continue;
        d2 = dx * dx + dy * dy;
        if (d2 >= link2) continue;
        var strength = (1 - Math.sqrt(d2) / link) * (a.hub || b.hub ? 1 : 0.6);
        k = Math.min(LEVELS - 1, Math.floor(strength * LEVELS));
        levels[k].push(a.x, a.y, b.x, b.y);
      }
    }
    ctx.lineWidth = 1;
    for (k = 0; k < LEVELS; k++) {
      var seg = levels[k];
      if (!seg.length) continue;
      ctx.strokeStyle = 'rgba(' + col.line + ',' + (((k + 1) / LEVELS) * col.lineAlpha).toFixed(3) + ')';
      ctx.beginPath();
      for (var s = 0; s < seg.length; s += 4) {
        ctx.moveTo(seg[s], seg[s + 1]);
        ctx.lineTo(seg[s + 2], seg[s + 3]);
      }
      ctx.stroke();
    }

    // Lines from nearby nodes to the mouse pointer, plus a small node at the pointer.
    if (pointer.strength > 0.01) {
      var px = pointer.x;
      var py = pointer.y;
      var reach2 = POINTER_REACH * POINTER_REACH;
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        dx = a.x - px;
        dy = a.y - py;
        d2 = dx * dx + dy * dy;
        if (d2 >= reach2) continue;
        var pull = (1 - Math.sqrt(d2) / POINTER_REACH) * pointer.strength;
        ctx.strokeStyle = 'rgba(' + col.line + ',' + (pull * col.lineAlpha * 1.6).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(' + col.hub + ',' + (0.14 * pointer.strength).toFixed(3) + ')';
      ctx.fillRect(px - 8, py - 8, 16, 16);
      ctx.fillStyle = 'rgba(' + col.hub + ',' + (0.9 * pointer.strength).toFixed(3) + ')';
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }

    // Small square nodes (Mesh's square "dot").
    ctx.fillStyle = 'rgba(' + col.node + ',' + col.nodeAlpha + ')';
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (!a.hub) ctx.fillRect(a.x - 1.25, a.y - 1.25, 2.5, 2.5);
    }
    // Hubs: a Mesh-blue square with a soft, slowly breathing halo.
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (!a.hub) continue;
      var pulse = (Math.sin(t / 1100 + a.phase) + 1) / 2;
      var halo = 10 + pulse * 6;
      ctx.fillStyle = 'rgba(' + col.hub + ',' + (0.1 + pulse * 0.14).toFixed(3) + ')';
      ctx.fillRect(a.x - halo / 2, a.y - halo / 2, halo, halo);
      ctx.fillStyle = 'rgba(' + col.hub + ',0.95)';
      ctx.fillRect(a.x - 2.5, a.y - 2.5, 5, 5);
    }
  }

  function shouldRun() {
    return !!active && active.visible && !document.hidden && !reduceMotion.matches;
  }

  function frame(t) {
    raf = 0;
    if (!shouldRun()) return;
    var dt = last ? Math.min((t - last) / 1000, 0.05) : 0; // never jump after a pause
    last = t;
    step(dt);
    followPointer(dt);
    draw(t);
    raf = requestAnimationFrame(frame);
  }

  function update() {
    if (shouldRun()) {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (active) draw(performance.now()); // still picture when motion is off
    }
  }

  function release(a) {
    a.resize.disconnect();
    a.seen.disconnect();
    if (active === a) {
      active = null;
      update();
    }
  }

  function attach(canvas) {
    if (!canvas || !canvas.getContext || !window.ResizeObserver || !window.IntersectionObserver) {
      return { destroy: function () {} };
    }
    if (active) release(active);
    var a = {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      colours: readColours(canvas),
      visible: true,
      w: 0,
      h: 0,
      dpr: 0,
    };
    active = a;
    a.resize = new ResizeObserver(function () {
      if (active !== a) return;
      if (fit()) draw(performance.now()); // resizing clears the canvas
    });
    a.resize.observe(canvas);
    a.seen = new IntersectionObserver(function (entries) {
      a.visible = entries[entries.length - 1].isIntersecting;
      if (active === a) update();
    });
    a.seen.observe(canvas);
    if (fit()) draw(performance.now());
    update();
    return {
      destroy: function () {
        release(a);
      },
    };
  }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return; // phones: no pointer to follow
    pointer.cx = e.clientX;
    pointer.cy = e.clientY;
    pointer.seen = true;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', function () {
    pointer.seen = false;
  });

  document.addEventListener('visibilitychange', update);
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', update);
  // Light/dark switch: pick up the new colours.
  new MutationObserver(function () {
    if (!active) return;
    active.colours = readColours(active.canvas);
    if (!raf) draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.MeshNodes = { attach: attach };
})();
