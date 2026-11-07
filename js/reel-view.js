// The Bench: one reel frame drawn from a reel card. The set and the cast are <use> elements on the
// sprite in index.html; mouths and blinks are switched with CSS variables on each <use>
// (--mc/--mo/--mw for the mouth, --eo/--eb for the eyes), so a frame never redraws the art.
// Captions, the pop and the progress bar are HTML over the scene, sized in frame units (--u).
//
// The player: in the feed the most visible reel plays muted (animation only) and every other
// reel is paused. Sound starts only from a tap: the inline sound button, or a tap on the stage,
// which opens the reel full screen with sound on. Audio is a Web Audio buffer started at the
// clock's position; the clock, not the audio, drives the frame.

import { h, renderGraphic } from "./graphics.js";
import { saveButton } from "./render.js";
import {
  BLINK_MS, DEFAULT_CAST, FRAME_MS, SHOT_LAYOUT, beatAt, blinkTimes, createReelClock, frameMsOf, loadReelAudio, mouthAt, onInk, shotCast,
} from "./reels.js";

const SVG = "http://www.w3.org/2000/svg";
const MOUTH = {
  closed: { mc: "inline", mo: "none", mw: "none" },
  open: { mc: "none", mo: "inline", mw: "none" },
  wide: { mc: "none", mo: "none", mw: "inline" },
};
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 H7 L12 5 V19 L7 15 H3Z" fill="#1b1f36"/>';
const SOUND_OFF = SPEAKER
  + '<path d="M15.5 9 L21 15 M21 9 L15.5 15" fill="none" stroke="#f15060" stroke-width="2.6" stroke-linecap="round"/></svg>';
const SOUND_ON = SPEAKER
  + '<path d="M15.5 9 Q18 12 15.5 15 M18 6.5 Q22.5 12 18 17.5" fill="none" stroke="#1b1f36" stroke-width="2.4" stroke-linecap="round"/></svg>';
const PLAY_AT = 0.6; // the most visible reel plays once this much of it is on screen

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function place(use, { x, y, w }) {
  use.setAttribute("x", x);
  use.setAttribute("y", y);
  use.setAttribute("width", w);
  use.setAttribute("height", ((w * 284) / 240).toFixed(1));
}

export function reelStage(card, cast) {
  const reel = card.reel;
  const beats = reel.beats;
  // Per field, so a bundle entry missing (say) its ink still gets the default ink.
  const who = (id) => {
    const base = DEFAULT_CAST[id] ?? { name: id, short: id, role: "", ink: "#1b1f36" };
    const given = cast?.[id] ?? {};
    return Object.fromEntries(Object.keys(base).map((k) => [k, given[k] || base[k]]));
  };

  const castLayer = svg("g", { class: "reel-cast" });
  const scene = svg("svg", { class: "reel-scene", viewBox: "0 75.33 390 768.67", preserveAspectRatio: "xMidYMin slice", "aria-hidden": "true", focusable: "false" });
  scene.append(
    svg("use", { href: `#set-${reel.set}`, width: 390, height: 844 }),
    castLayer,
    // The bench top again, over the cast, so they stand behind it.
    svg("use", { href: `#set-${reel.set}`, width: 390, height: 844, "clip-path": "url(#reel-front)" }));

  const pop = h("div", { class: "reel-pop", hidden: true });
  const lower = h("div", { class: "reel-lower", hidden: true }, h("b"), h("span"));
  const whoEl = h("span", { class: "reel-who" });
  const lineEl = h("p", { class: "reel-line" });
  const cc = h("div", { class: "reel-cc", hidden: true }, whoEl, lineEl);
  const fill = h("i");
  const time = h("span", { class: "reel-time" });
  const el = h("div", { class: "reel-stage", "data-set": reel.set },
    scene,
    h("div", { class: "reel-top" },
      h("span", { class: "reel-show" }, "The Bench"),
      h("span", { class: "reel-ep" }, `Ep. ${reel.episode}`)),
    pop, lower, cc,
    h("div", { class: "reel-bar" }, h("div", { class: "reel-track" }, fill), time));

  // How many frame units a shorter-than-9:16 stage (the inline card) cuts, as a plain number in
  // --cropu, so the CSS can share the cut between the wall and the floor and scale the pop with it.
  let cropu = "";
  new ResizeObserver(() => {
    const w = el.clientWidth;
    const v = w ? String(Math.max(0, Math.round((390 * 16) / 9 - (el.clientHeight * 390) / w))) : "0";
    if (v !== cropu) el.style.setProperty("--cropu", cropu = v);
  }).observe(el);

  const uses = {};
  const blinks = {};
  const useFor = (id) => {
    if (!uses[id]) {
      uses[id] = svg("use", { href: `#ch-${id}`, "data-cast": id });
      blinks[id] = blinkTimes(`${card.id}|${id}`, reel.duration_ms);
    }
    return uses[id];
  };
  const blinking = (id, ms) => blinks[id].some((t) => ms >= t && ms < t + BLINK_MS);

  let shownBeat = null;
  let shownCast = "";
  // What paint last wrote, so a frame only touches what changed.
  const face = {}; // id -> "mouth|blink"
  let shownWidth = "";
  let shownTime = "";
  const set = (u, k, v) => u.style.setProperty(k, v);

  function showBeat(k) {
    const b = beats[k];
    const sc = shotCast(beats, k);
    const key = `${sc.left}|${sc.right}`;
    if (key !== shownCast) {
      shownCast = key;
      const on = sc.right
        ? [[sc.left, SHOT_LAYOUT.two_shot.left], [sc.right, SHOT_LAYOUT.two_shot.right]]
        : [[sc.left, SHOT_LAYOUT.talking_head]];
      castLayer.replaceChildren(...on.map(([id, at]) => {
        const u = useFor(id);
        place(u, at);
        return u;
      }));
    }
    el.dataset.shot = sc.shot;

    const g = b.pop ? renderGraphic(b.pop) : null;
    pop.hidden = !g || g.classList.contains("g-empty");
    pop.classList.toggle("is-card", sc.shot === "card");
    pop.replaceChildren(...(pop.hidden ? [] : [g]));
    // A new pop springs in again, even when the last beat's pop was still showing.
    if (!pop.hidden) for (const a of pop.getAnimations?.() ?? []) { a.cancel(); a.play(); }

    const p = who(b.speaker);
    cc.hidden = false;
    cc.style.setProperty("--a", p.ink);
    cc.style.setProperty("--on", onInk(p.ink));
    whoEl.textContent = p.short;
    lineEl.textContent = b.line;
    const n = b.line.length;
    lineEl.dataset.len = n > 90 ? "long" : n > 48 ? "mid" : "short";

    lower.hidden = sc.shot !== "talking_head";
    lower.querySelector("b").textContent = p.name;
    lower.querySelector("span").textContent = p.role;
  }

  function paint(ms, loud, frameMs) {
    const at = Math.min(Math.max(ms, 0), reel.duration_ms);
    const width = `${((100 * at) / reel.duration_ms).toFixed(2)}%`;
    if (width !== shownWidth) fill.style.width = shownWidth = width;
    const t = `${clock(at)} / ${clock(reel.duration_ms)}`;
    if (t !== shownTime) time.textContent = shownTime = t;
    if (!beats.length) return; // nothing to say: the set, the top bar and the progress bar only

    const i = beatAt(beats, ms);
    // In a gap between lines, hold the last line on screen with every mouth closed.
    let k = i;
    if (k === -1) for (let j = 0; j < beats.length && beats[j].start_ms <= ms; j++) k = j;
    if (k === -1) k = 0;
    if (k !== shownBeat) {
      shownBeat = k;
      showBeat(k);
    }
    const speaker = beats[k].speaker;
    for (const u of castLayer.children) {
      const id = u.dataset.cast;
      const mouth = id === "r2" ? "" : mouthAt(loud, ms, i !== -1 && id === speaker, frameMs);
      const shut = blinking(id, ms);
      const state = `${mouth}|${shut}`;
      if (face[id] === state) continue;
      face[id] = state;
      if (mouth) {
        const m = MOUTH[mouth];
        set(u, "--mc", m.mc);
        set(u, "--mo", m.mo);
        set(u, "--mw", m.mw);
      }
      set(u, "--eo", shut ? "none" : "inline");
      set(u, "--eb", shut ? "inline" : "none");
    }
  }

  return { el, paint };
}

function setSound(btn, muted) {
  btn.dataset.muted = String(muted);
  btn.setAttribute("aria-label", muted ? "Turn sound on" : "Mute");
  btn.innerHTML = muted ? SOUND_OFF : SOUND_ON;
}

// The card's paint function and sound button, for the controller.
const parts = new WeakMap();

// onOpen(card) is called when the stage is tapped (the feed opens it full screen).
export function reelCard(card, { cast, onSave, saved, onMore, onOpen } = {}) {
  const stage = reelStage(card, cast);
  const sound = h("button", { class: "reel-sound", type: "button" });
  setSound(sound, true);
  stage.el.addEventListener("click", () => onOpen?.(card));
  const el = h("article", { class: `card card-reel t-${card.topic}`, "data-card-id": card.id, "data-kind": "reel", "data-topic": card.topic },
    h("div", { class: "reel" }, stage.el, sound),
    h("div", { class: "body" },
      h("h3", { class: "title" }, card.title),
      h("div", { class: "actions" },
        saveButton(card, onSave, saved),
        card.ref && h("button", {
          class: "act act-more", type: "button", "aria-label": "Tell me more",
          onclick: (e) => { e.stopPropagation(); onMore?.(card); },
        }, "Tell me more"))));
  stage.paint(0, null);
  parts.set(el, { paint: stage.paint, sound });
  return el;
}

// ---------- sound ----------

let audioCtx = null;

// Call synchronously inside a tap handler, before any await: iOS only lets a tap start audio.
function soundOn() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    // She tapped for sound, so the ring/silent switch should not mute it (Safari 17+).
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch {
    // older Safari, or the session refused the type
  }
  try {
    audioCtx ??= new AC();
    if (audioCtx.state !== "running") audioCtx.resume()?.catch?.(() => {});
  } catch {
    return null;
  }
  return audioCtx;
}

// One reel's audio. start(ctx, at) plays from at() ms (read after decoding, so it matches the
// clock); stop() also cancels a start still waiting on decoding. Without bytes it does nothing.
function createVoice(bytes) {
  let decoded = null;
  let src = null;
  let gen = 0;
  const stop = () => {
    gen++;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // already stopped
    }
    src.disconnect();
    src = null;
  };
  const start = async (ctx, at) => {
    stop();
    const mine = gen;
    if (!ctx || !bytes) return;
    // decodeAudioData detaches its buffer, so it gets a copy.
    decoded ??= ctx.decodeAudioData(bytes.slice().buffer).catch(() => null);
    const buf = await decoded;
    const from = at() / 1000;
    if (!buf || mine !== gen || from >= buf.duration) return;
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0, from);
  };
  return { start, stop };
}

// ---------- the feed player ----------

// watch(el, card) takes an element made by reelCard. started(id) is true once that reel has
// played at all. audio(id) is its decrypted audio (a promise, shared, null when there is none;
// a null result is not kept, so the next call tries again). pauseAll() pauses every reel and
// holds them paused until resume(). onPassed(id) is called each time a reel's bottom goes above
// the top of the screen, started or not; the caller decides what that means.
// While the page is hidden every reel is paused, so background time never ends one.
export function createReelController({ fetchFn, getKey, onStarted, onEnded, onPassed } = {}) {
  const reels = new WeakMap(); // element -> reel
  const shown = new Set(); // reels at least partly on screen
  const loads = new Map(); // id -> Promise<{header, audio} | null>
  const begun = new Set();
  let active = null;
  let frame = 0;
  let held = false;

  const audio = (id) => {
    if (!loads.has(id)) {
      loads.set(id, (async () => {
        let a = null;
        try {
          a = await loadReelAudio(fetchFn, id, await getKey?.());
        } catch {
          a = null;
        }
        if (!a) loads.delete(id); // try again next time (the key or the network may be back)
        return a;
      })());
    }
    return loads.get(id);
  };

  const load = (r) => {
    if (r.loading) return;
    r.loading = true;
    audio(r.id).then((a) => {
      r.loud = a?.header?.loud ?? null;
      r.frameMs = frameMsOf(a?.header);
      r.voice = createVoice(a?.audio);
      r.el.dataset.audio = a ? "ready" : "none";
      if (r === active && !r.muted) r.voice.start(audioCtx, r.clock.time).catch(() => {});
    });
  };

  const tick = () => {
    frame = 0;
    const r = active;
    if (!r) return;
    r.paint(r.clock.time(), r.loud, r.frameMs);
    if (r.clock.ended()) finish(r);
    else frame = requestAnimationFrame(tick);
  };

  function play(r) {
    active = r;
    r.clock.play();
    r.el.dataset.reelState = "playing";
    if (!begun.has(r.id)) {
      begun.add(r.id);
      onStarted?.(r.id);
    }
    load(r);
    if (!r.muted) r.voice.start(audioCtx, r.clock.time).catch(() => {});
    frame ||= requestAnimationFrame(tick);
  }

  function pause(r) {
    r.clock.pause();
    r.voice.stop();
    if (!r.clock.ended()) r.el.dataset.reelState = "paused";
    if (active === r) active = null;
  }

  // At the end the reel rests on its last frame and is not played again inline.
  function finish(r) {
    pause(r);
    r.el.dataset.reelState = "ended";
    if (!r.done) {
      r.done = true;
      onEnded?.(r.id);
    }
  }

  function mute(r) {
    if (r.muted) return;
    r.muted = true;
    r.voice.stop();
    setSound(r.sound, true);
  }

  // The most visible reel past PLAY_AT plays (the playing one wins a tie); every other one pauses.
  function choose() {
    if (held || document.hidden) return;
    // A reel removed from the page (she changed tab) can still be in shown until the observer reports it.
    for (const r of shown) if (!r.el.isConnected) shown.delete(r);
    let best = active && active.ratio >= PLAY_AT && active.el.isConnected ? active : null;
    for (const r of shown) {
      if (r.ratio >= PLAY_AT && !r.clock.ended() && r.ratio > (best?.ratio ?? 0)) best = r;
    }
    if (active && active !== best) pause(active);
    if (best && best !== active) play(best);
  }

  const playIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const r = reels.get(e.target);
      if (!r) continue;
      r.ratio = e.isIntersecting ? e.intersectionRatio : 0;
      if (r.ratio > 0) {
        shown.add(r);
      } else {
        // Out of view: paused (below), and muted again.
        shown.delete(r);
        mute(r);
        // Scrolled past the top (a detached element reports an empty rect, which is not a pass).
        if (e.target.isConnected && e.boundingClientRect.height > 0 && e.boundingClientRect.bottom <= 0) onPassed?.(r.id);
      }
    }
    choose();
  }, { threshold: [0, 0.25, 0.5, PLAY_AT, 0.75, 0.9, 1] });

  // Fetch and decrypt the audio a screen ahead.
  const nearIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const r = reels.get(e.target);
      if (!r || !e.isIntersecting) continue;
      nearIO.unobserve(e.target);
      load(r);
    }
  }, { rootMargin: "100% 0px" });

  function watch(el, card) {
    const p = parts.get(el);
    if (!p || reels.has(el)) return;
    const r = {
      id: card.id, el, paint: p.paint, sound: p.sound, ratio: 0, muted: true, done: false, loading: false, loud: null, frameMs: FRAME_MS,
      clock: createReelClock({ durationMs: card.reel.duration_ms }), voice: createVoice(null),
    };
    reels.set(el, r);
    el.dataset.reelState = "paused";
    p.sound.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!r.muted) return mute(r);
      const ctx = soundOn(); // first, before anything async
      r.muted = false;
      setSound(r.sound, false);
      if (r === active) r.voice.start(ctx, r.clock.time).catch(() => {});
    });
    playIO.observe(el);
    nearIO.observe(el);
  }

  const onVisibility = () => {
    if (document.hidden) {
      if (active) pause(active);
    } else {
      choose();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    watch,
    started: (id) => begun.has(id),
    audio,
    pauseAll() {
      held = true;
      if (active) pause(active);
    },
    resume() {
      held = false;
      choose();
    },
    disconnect() {
      held = true;
      if (active) pause(active);
      playIO.disconnect();
      nearIO.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

// ---------- full screen ----------

// Opens the reel full screen with sound on; call it from the tap handler. audio is the decrypted
// {header, audio}, a promise of it, or null (then it plays silently with the same controls).
// A tap on the stage pauses and resumes; at the end it rests on its last frame, and a tap replays it.
// When the page is hidden it pauses, and stays paused when she comes back until she taps.
export function openReelFull(card, { cast, audio = null, onEnded, onClose } = {}) {
  let ctx = soundOn(); // first, inside the tap, before any await
  const stage = reelStage(card, cast);
  const clock = createReelClock({ durationMs: card.reel.duration_ms });
  let voice = createVoice(null);
  let loud = null;
  let frameMs = FRAME_MS;
  let muted = false;
  let frame = 0;
  let done = false;

  const sound = h("button", { class: "reel-sound", type: "button" });
  setSound(sound, false);
  const close = h("button", { class: "reel-close", type: "button" }, "Close");
  const dlg = h("dialog", { class: `reel-full card-reel t-${card.topic}`, "aria-label": card.title, "data-audio": "loading" },
    h("div", { class: "reel-full-bar" }, close, sound),
    h("div", { class: "reel-full-frame" }, stage.el));

  const tick = () => {
    frame = 0;
    stage.paint(clock.time(), loud, frameMs);
    if (clock.ended()) end();
    else if (clock.playing()) frame = requestAnimationFrame(tick);
  };
  const play = () => {
    if (clock.ended()) clock.seek(0);
    clock.play();
    dlg.dataset.reelState = "playing";
    if (!muted) voice.start(ctx, clock.time).catch(() => {});
    frame ||= requestAnimationFrame(tick);
  };
  const pause = () => {
    clock.pause();
    voice.stop();
    dlg.dataset.reelState = "paused";
  };
  const end = () => {
    clock.pause();
    voice.stop();
    dlg.dataset.reelState = "ended";
    if (!done) {
      done = true;
      onEnded?.(card.id);
    }
  };

  stage.el.addEventListener("click", () => {
    if (clock.playing()) return pause();
    // A tap: (re)start the context first, in case iOS interrupted it while she was away.
    if (!muted) ctx = soundOn() ?? ctx;
    play();
  });
  const onVisibility = () => {
    if (document.hidden && clock.playing()) pause();
  };
  document.addEventListener("visibilitychange", onVisibility);
  sound.addEventListener("click", () => {
    if (muted) {
      ctx = soundOn() ?? ctx;
      muted = false;
      if (clock.playing()) voice.start(ctx, clock.time).catch(() => {});
    } else {
      muted = true;
      voice.stop();
    }
    setSound(sound, muted);
  });
  close.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    document.removeEventListener("visibilitychange", onVisibility);
    cancelAnimationFrame(frame);
    clock.pause();
    voice.stop();
    dlg.remove();
    onClose?.();
  });

  document.body.append(dlg);
  dlg.showModal();
  play();
  Promise.resolve(audio).catch(() => null).then((a) => {
    if (!dlg.isConnected) return;
    dlg.dataset.audio = a ? "ready" : "none";
    loud = a?.header?.loud ?? null;
    frameMs = frameMsOf(a?.header);
    voice = createVoice(a?.audio);
    if (!muted && clock.playing()) voice.start(ctx, clock.time).catch(() => {});
  });
  return dlg;
}
