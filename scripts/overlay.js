// Injected into every page by show.mjs (explain-yourself skill). Draws a hand-drawn pencil circle around each change and a small draggable pill
// (play/pause, next, transcript toggle) in a shadow root so page CSS can't touch it, and plays
// the narration. Talks to Node via window.__vrEvent("next"|"prev"|"ended"|"restart"|"goto:N").
(() => {
  if (window.top !== window || window.__vr) return;
  const send = (e) => window.__vrEvent?.(e);
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`voice-review:${k}`);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`voice-review:${k}`, JSON.stringify(v));
      } catch {}
    },
  };
  const state = {
    ui: null,
    paused: false,
    transcript: store.get("transcript", false),
    pos: store.get("pos", null), // {x, y} of the pill's top-left, or null = bottom center
  };
  let host, root, spot, wrap, target, raf, audio, utter, timer, drawnFor;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .ann { position: fixed; pointer-events: none; display: none; overflow: visible; }
    .ann path { fill: none; stroke: #e8432e; stroke-linecap: round; stroke-linejoin: round; }
    .wrap { position: fixed; display: flex; flex-direction: column; align-items: center; gap: 8px;
      pointer-events: none; }
    .pill { pointer-events: auto; display: flex; align-items: center; gap: 2px; padding: 5px;
      background: rgba(22,22,29,.92); color: #f4f4f7; border-radius: 999px; cursor: grab;
      box-shadow: 0 8px 28px rgba(0,0,0,.3); backdrop-filter: blur(8px); user-select: none; touch-action: none; }
    .pill.dragging { cursor: grabbing; }
    .pill button { all: unset; width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center;
      cursor: pointer; color: #f4f4f7; }
    .pill button:hover { background: rgba(255,255,255,.1); }
    .pill button:focus-visible { outline: 2px solid #c9c2ff; outline-offset: 1px; }
    .pill button.play { background: #7c6cff; }
    .pill button.play:hover { background: #8d7fff; }
    .pill button.on { color: #c9c2ff; background: rgba(124,108,255,.22); }
    .pill svg { width: 16px; height: 16px; fill: currentColor; }
    .count { font-size: 12px; color: #a9a9b8; padding: 0 6px 0 4px; font-variant-numeric: tabular-nums; }
    .card { pointer-events: auto; width: min(420px, calc(100vw - 24px)); background: rgba(22,22,29,.94);
      color: #f4f4f7; border-radius: 14px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(0,0,0,.3); }
    .card .t { font-size: 12px; font-weight: 600; color: #c9c2ff; margin-bottom: 4px; }
    .card .s { font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
    .card .w { font-size: 12px; color: #ffcf6e; margin-top: 6px; }
    .code { position: fixed; left: 50%; top: 24px; transform: translateX(-50%); width: min(860px, calc(100vw - 32px));
      max-height: calc(100vh - 160px); overflow: auto; background: #0f0f14; color: #e6e6ef; border-radius: 14px;
      pointer-events: auto; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
    .code h4 { margin: 0; padding: 10px 14px; font-size: 13px; color: #a9a9b8; border-bottom: 1px solid #262630; font-weight: 600; }
    .code pre { margin: 0; padding: 12px 14px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
    
  `;
  const ICON = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M2.5 2.5v11l7-5.5zM10.5 2.5h3v11h-3z"/></svg>',
    replay: '<svg viewBox="0 0 16 16"><path d="M8 3V0L4 4l4 4V5a4 4 0 1 1-4 4H2a6 6 0 1 0 6-6z"/></svg>',
    cc: '<svg viewBox="0 0 16 16"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1.5 3v4h4V9h-3V7h3V6zm5 0v4h4V9h-3V7h3V6z"/></svg>',
  };

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement("voice-review-overlay");
    host.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><svg class="ann" aria-hidden="true"><defs>
      <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3 0 0 0 -0.45" result="grain"/>
        <feComposite in="rough" in2="grain" operator="in"/>
      </filter></defs><g filter="url(#pencil)"></g></svg>`;
    spot = root.querySelector(".ann");
    document.documentElement.appendChild(host);
    try {
      host.setAttribute("popover", "manual");
      host.showPopover();
    } catch {}
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (icon, label, fn, cls) => {
    const b = el("button", cls);
    b.innerHTML = ICON[icon]; // static icons only, never tour text
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.onclick = fn;
    return b;
  };

  function place() {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    if (!state.pos) {
      wrap.style.left = `${Math.round((innerWidth - r.width) / 2)}px`;
      wrap.style.top = `${Math.round(innerHeight - r.height - 20)}px`;
      return;
    }
    const x = Math.min(Math.max(8, state.pos.x), innerWidth - r.width - 8);
    const y = Math.min(Math.max(8, state.pos.y), innerHeight - r.height - 8);
    wrap.style.left = `${x}px`;
    wrap.style.top = `${y}px`;
  }

  function render() {
    mount();
    wrap?.remove();
    root.querySelector(".code")?.remove();
    const u = state.ui;
    if (!u) return;

    wrap = el("div", "wrap");
    if (state.transcript) {
      const card = el("div", "card");
      card.setAttribute("aria-live", "polite");
      card.append(
        el("div", "t", u.done ? "That's everything." : u.title),
        el("div", "s", u.done ? "Press replay to watch it again." : u.say),
      );
      if (u.missing && !u.done) card.append(el("div", "w", `Couldn't find ${u.missing} on this page.`));
      wrap.append(card);
    }

    const pill = el("div", "pill");
    pill.setAttribute("role", "toolbar");
    pill.setAttribute("aria-label", "voice-review tour");
    if (u.done) pill.append(button("replay", "Replay", () => go("restart"), "play"));
    else
      pill.append(
        button(state.paused ? "play" : "pause", state.paused ? "Play (space)" : "Pause (space)", togglePause, "play"),
      );
    pill.append(button("next", "Next step (→)", () => go("next")));
    pill.append(el("span", "count", u.done ? `${u.total}/${u.total}` : `${u.index + 1}/${u.total}`));
    pill.append(
      button("cc", state.transcript ? "Hide transcript" : "Show transcript", toggleTranscript, state.transcript ? "on" : ""),
    );
    drag(pill);
    wrap.append(pill);
    root.append(wrap);
    place();

    if (u.code && !u.done) {
      const c = el("div", "code");
      c.append(el("h4", "", u.code.file), el("pre", "", u.code.text));
      root.append(c);
    }
  }

  function drag(pill) {
    pill.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = wrap.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      pill.setPointerCapture(e.pointerId);
      pill.classList.add("dragging");
      const move = (m) => {
        state.pos = { x: m.clientX - dx, y: m.clientY - dy };
        place();
      };
      const up = () => {
        pill.classList.remove("dragging");
        pill.removeEventListener("pointermove", move);
        pill.removeEventListener("pointerup", up);
        pill.removeEventListener("pointercancel", up);
        const now = wrap.getBoundingClientRect();
        state.pos = { x: now.left, y: now.top };
        store.set("pos", state.pos);
      };
      pill.addEventListener("pointermove", move);
      pill.addEventListener("pointerup", up);
      pill.addEventListener("pointercancel", up);
    });
  }
  addEventListener("resize", () => place());

  function toggleTranscript() {
    // Keep the pill where it is when the card above it appears or disappears.
    const before = wrap?.getBoundingClientRect();
    state.transcript = !state.transcript;
    store.set("transcript", state.transcript);
    render();
    if (before && state.pos) {
      const after = wrap.getBoundingClientRect();
      state.pos = { x: state.pos.x, y: state.pos.y + (before.height - after.height) };
      store.set("pos", state.pos);
      place();
    }
  }

  // A hand-drawn loop around the element: wobbly ellipse that overshoots its start, drawn in
  // with a stroke animation, two passes, pencil grain from the SVG filter.
  const M = 34; // svg margin around the element
  function rand(seed) {
    let x = seed;
    return () => ((x = (x * 16807) % 2147483647) / 2147483647);
  }
  function loopPath(w, h, seed, tighten) {
    const r = rand(seed);
    const cx = w / 2 + M, cy = h / 2 + M;
    const rx = w / 2 + Math.min(26, 12 + w * 0.05), ry = Math.max(h / 2 + 12, 20);
    const p1 = r() * 6.28, p2 = r() * 6.28, a1 = 0.035 + r() * 0.03, a2 = 0.02 + r() * 0.02;
    const start = -2.2 + r() * 0.6, sweep = 6.28 + 0.45 + r() * 0.35;
    const pts = [];
    const n = 36;
    for (let k = 0; k <= n; k++) {
      const t = k / n, a = start + sweep * t;
      const wob = 1 + a1 * Math.sin(a * 2 + p1) + a2 * Math.sin(a * 3 + p2);
      const shrink = 1 - tighten * t; // slight spiral so the overshoot lands inside
      pts.push([cx + Math.cos(a) * rx * wob * shrink, cy + Math.sin(a) * ry * wob * shrink]);
    }
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k - 1] ?? pts[k], q1 = pts[k], q2 = pts[k + 1], p3 = pts[k + 2] ?? q2;
      const c1 = [q1[0] + (q2[0] - p0[0]) / 6, q1[1] + (q2[1] - p0[1]) / 6];
      const c2 = [q2[0] - (p3[0] - q1[0]) / 6, q2[1] - (p3[1] - q1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${q2[0].toFixed(1)},${q2[1].toFixed(1)}`;
    }
    return d;
  }
  function draw(w, h) {
    const g = spot.querySelector("g");
    g.replaceChildren();
    spot.setAttribute("width", w + M * 2);
    spot.setAttribute("height", h + M * 2);
    const seed = 1 + Math.floor(Math.random() * 1e6);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    [
      { width: 4.2, opacity: 0.95, tighten: 0.05, delay: 0, dur: 900 },
      { width: 2.2, opacity: 0.6, tighten: 0.03, delay: 450, dur: 750 },
    ].forEach((pass, k) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", loopPath(w, h, seed + k * 977, pass.tighten));
      path.style.strokeWidth = String(pass.width);
      path.style.opacity = String(pass.opacity);
      g.append(path);
      if (reduce) return;
      // Web Animations API: unlike a CSS transition, it runs even though the path was created
      // in the same frame (and while its svg was still hidden).
      const len = path.getTotalLength() + 2;
      path.style.strokeDasharray = `${len}`;
      path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: pass.dur,
        delay: pass.delay,
        easing: "cubic-bezier(.45,.05,.3,1)",
        fill: "both",
      });
    });
  }
  function track() {
    cancelAnimationFrame(raf);
    if (!target?.isConnected) {
      spot.style.display = "none";
      return;
    }
    const r = target.getBoundingClientRect();
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
    spot.style.display = "block";
    spot.style.left = `${r.left - M}px`;
    spot.style.top = `${r.top - M}px`;
    if (drawnFor !== key) {
      drawnFor = key;
      draw(r.width, r.height);
    }
    raf = requestAnimationFrame(track);
  }

  function stop() {
    clearTimeout(timer);
    if (audio) {
      audio.onended = null;
      audio.pause();
      audio = null;
    }
    if (utter) {
      utter.onend = null;
      speechSynthesis.cancel();
      utter = null;
    }
  }

  function go(e) {
    stop();
    send(e);
  }

  function togglePause() {
    state.paused = !state.paused;
    if (audio) state.paused ? audio.pause() : audio.play().catch(() => {});
    if (utter) state.paused ? speechSynthesis.pause() : speechSynthesis.resume();
    render();
  }

  function speak(src, text) {
    stop();
    state.paused = false;
    const ended = () => send("ended");
    const silent = () => {
      timer = setTimeout(ended, Math.max(2500, (text.split(/\s+/).length / 2.6) * 1000));
    };
    if (src) {
      audio = new Audio(src);
      audio.onended = () => setTimeout(ended, 700);
      audio.play().catch(() => {
        audio = null;
        silent();
      });
    } else if ("speechSynthesis" in window) {
      utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => setTimeout(ended, 700);
      utter.onerror = () => silent();
      speechSynthesis.speak(utter);
    } else silent();
    render();
  }

  addEventListener(
    "keydown",
    (e) => {
      if (!state.ui || e.target?.closest?.("input,textarea,select,[contenteditable]")) return;
      if (e.key === "ArrowRight") go("next");
      else if (e.key === "ArrowLeft") go("prev");
      else if (e.key === " " && !state.ui.done) togglePause();
      else return;
      e.preventDefault();
    },
    true,
  );

  window.__vr = {
    ready: false,
    show(ui) {
      stop();
      target = null;
      cancelAnimationFrame(raf);
      if (spot) spot.style.display = "none";
      state.ui = ui;
      render();
    },
    spotlight(node) {
      target = node;
      drawnFor = null;
      track();
    },
    speak,
    done() {
      stop();
      target = null;
      if (spot) spot.style.display = "none";
      state.ui = { ...state.ui, done: true };
      render();
    },
  };
  const init = () => {
    mount();
    window.__vr.ready = true;
  };
  if (document.documentElement && document.readyState !== "loading") init();
  else addEventListener("DOMContentLoaded", init, { once: true });
})();
