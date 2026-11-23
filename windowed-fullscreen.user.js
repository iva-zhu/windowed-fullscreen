// ==UserScript==
// @name        Video Windowed Fullscreen (macOS)
// @namespace   https://github.com/iva-zhu/windowed-fullscreen
// @version     2.0.1
// @description macOS: videos go full screen in the current Space — no native fullscreen, no new Space, no animation
// @author      Ivan Zhukovin
// @license     MIT
// @match       *://*/*
// @run-at      document-start
// @inject-into page
// @grant       none
// ==/UserScript==

// On macOS every Chromium fullscreen request is handed to AppKit (`toggleFullScreen()`):
// the window is moved to its own Space, the screen animates, and coming back costs another
// animation. Firefox has `full-screen-api.macos-native-full-screen = false`; Chromium has
// nothing — not a flag, not a pref, not a fork option.
//
// So we answer the request ourselves: the player is pinned over the window with
// `position: fixed`, page scroll is locked, and a `resize` is dispatched so the player
// recomputes the video geometry for the new box. AppKit is never involved, so
// `document.fullscreenElement` stays null and no Space is created.
//
// Only requests that involve a <video> are hijacked; canvas games, editors and anything
// else get the real macOS fullscreen. Hold Shift while clicking fullscreen to get the real
// one too.

const TARGET = 'wfs-target';
const ROOT = 'wfs-root';
const STYLE_ID = 'wfs-style';

const CSS = `
html.${ROOT} { overflow: hidden !important; }
.${TARGET} {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  transform: none !important;
  background: #000 !important;
  z-index: 2147483000 !important;
}
.${TARGET} video,
video.${TARGET} { object-fit: contain !important; }
/* YouTube paints the masthead and the "below the player" column (title, channel, buttons)
   in higher stacking contexts than the player; real fullscreen hides them too. */
html.${ROOT} ytd-masthead,
html.${ROOT} #masthead-container,
html.${ROOT} ytd-watch-flexy #below { display: none !important; }
`;

let expanded = null;
let shiftHeld = false;

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

// Players size the video from their container when they get a resize event.
function relayout(el) {
  window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    if (el && el !== document.documentElement) el.dispatchEvent(new Event('resize'));
  });
}

function collapse() {
  const el = expanded;
  expanded = null;
  if (!el) return;
  el.classList.remove(TARGET);
  document.documentElement.classList.remove(ROOT);
  relayout(el);
}

function expand(el) {
  if (expanded === el) return;
  collapse();
  expanded = el;
  injectCss();
  document.documentElement.classList.add(ROOT);
  el.classList.add(TARGET);
  relayout(el);
}

// Which element to pin for a given fullscreen request.
function targetFor(el) {
  if (el === document.documentElement || el === document.body) {
    return document.querySelector('#movie_player') || document.querySelector('video');
  }
  return el;
}

function involvesVideo(el) {
  if (el.tagName === 'VIDEO') return true;
  return typeof el.querySelector === 'function' && !!el.querySelector('video');
}

// Returns true when the request was handled without AppKit.
function hijack(el) {
  if (expanded && (el === expanded || el.contains(expanded) || expanded.contains(el))) {
    collapse();
    return true;
  }
  // Inside a cross-origin frame (embedded Vimeo, YouTube embeds) we cannot resize the
  // parent's frame element, so those players keep the real macOS fullscreen.
  if (window.top !== window.self) return false;
  if (expanded) collapse();
  if (shiftHeld || !involvesVideo(el)) return false;
  const target = targetFor(el);
  if (!target) return false;
  expand(target);
  return true;
}

const proto = Element.prototype;
const origRequest = proto.requestFullscreen;
const origWebkitRequest = proto.webkitRequestFullscreen;
const origExit = Document.prototype.exitFullscreen;
const origWebkitExit = Document.prototype.webkitExitFullscreen;

proto.requestFullscreen = function (...args) {
  if (hijack(this)) return Promise.resolve();
  return origRequest.apply(this, args);
};
if (origWebkitRequest) {
  proto.webkitRequestFullscreen = function (...args) {
    if (hijack(this)) return Promise.resolve();
    return origWebkitRequest.apply(this, args);
  };
}
if (origExit) {
  Document.prototype.exitFullscreen = function (...args) {
    if (expanded) {
      collapse();
      return Promise.resolve();
    }
    return origExit.apply(this, args);
  };
}
if (origWebkitExit) {
  Document.prototype.webkitExitFullscreen = function (...args) {
    if (expanded) {
      collapse();
      return;
    }
    return origWebkitExit.apply(this, args);
  };
}

window.addEventListener(
  'keydown',
  (e) => {
    shiftHeld = e.shiftKey;
    if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      e.stopPropagation();
      collapse();
    }
  },
  true,
);
window.addEventListener('keyup', (e) => { shiftHeld = e.shiftKey; }, true);
window.addEventListener('blur', () => { shiftHeld = false; }, true);

// The page was swapped under the pinned element (SPA navigation, teardown).
document.addEventListener(
  'yt-navigate-start',
  () => {
    if (expanded) collapse();
  },
  true,
);
