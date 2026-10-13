"use client";
// Website playback through YouTube's official embedded player (IFrame Player API). Browsers can't
// fetch YouTube audio themselves, so the website plays each song in an embedded YouTube player.
// This wrapper makes that player look like an <audio> element (src, play(), pause(), currentTime,
// duration, paused, error and the usual media events), so the player engine drives it unchanged.
// YouTube requires its player to stay visible: the video is shown over the song's cover in the
// player and the mini player (see showIn).

const API_URL = "https://www.youtube.com/iframe_api";
const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = API_URL;
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error("YouTube's player couldn't be loaded"));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

// The engine sets src to its stream URL (".../api/stream?id=<id>"); the video id is all we need
const videoIdFrom = (src) => String(src || "").match(/(?:[?&]id=|^yt:)([A-Za-z0-9_-]{11})/)?.[1] || null;

class YouTubeMediaElement extends EventTarget {
  constructor() {
    super();
    this._src = "";
    this._videoId = null;
    this._time = 0;
    this._duration = NaN;
    this._wantPlay = false;
    this._metadataSent = false;
    this._target = null;
    this.paused = true;
    this.ended = false;
    this.readyState = 0;
    this.error = null;
    this.playbackRate = 1;
    this.preload = "auto";
    this.buffered = { length: 0, start: () => 0, end: () => 0 };

    // The player's frame: positioned over whichever cover is showing (or tucked away)
    this.host = document.createElement("div");
    Object.assign(this.host.style, {
      position: "fixed", left: "0px", top: "0px", width: "1px", height: "1px",
      overflow: "hidden", pointerEvents: "none", zIndex: "60", borderRadius: "50%",
      background: "#000", opacity: "0", transition: "opacity 0.3s ease",
    });
    const mount = document.createElement("div");
    this.host.appendChild(mount);
    document.body.appendChild(this.host);

    this.ready = loadApi().then((YT) => new Promise((resolve) => {
      this.player = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        playerVars: {
          playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3,
          modestbranding: 1, origin: window.location.origin,
        },
        events: {
          onReady: () => resolve(this.player),
          onStateChange: (event) => this._onState(event.data),
          onError: (event) => this._onError(event.data),
        },
      });
    }));
    this.ready.catch(() => this._onError(-1));
    this._poll = setInterval(() => this._tick(), 250);
  }

  // ─── <audio>-like surface ───

  get src() { return this._src; }
  set src(value) {
    this._src = value || "";
    this._load(videoIdFrom(value));
  }

  getAttribute(name) { return name === "src" ? this._src || null : null; }
  setAttribute(name, value) { if (name === "src") this.src = value; }
  removeAttribute(name) {
    if (name !== "src") return;
    this._src = "";
    this._videoId = null;
    this._wantPlay = false;
    this.paused = true;
    this.readyState = 0;
    this.ready.then((p) => p.stopVideo?.()).catch(() => {});
    this._place();
  }
  load() { if (this._videoId) this._load(this._videoId); }

  get currentTime() { return this._time; }
  set currentTime(seconds) {
    const target = Math.max(0, Number(seconds) || 0);
    this._time = target;
    this.ready.then((p) => {
      p.seekTo(target, true);
      this._emit("seeked");
    }).catch(() => {});
  }

  get duration() { return this._duration; }

  play() {
    this._wantPlay = true;
    return this.ready.then((p) => { if (this._videoId) p.playVideo(); });
  }

  pause() {
    this._wantPlay = false;
    this.ready.then((p) => p.pauseVideo()).catch(() => {});
  }

  // ─── Showing the video ───

  // Lay the video over `element` (a cover image) and follow it as it moves; null tucks it away
  showIn(element) {
    this._target = element || null;
    cancelAnimationFrame(this._raf);
    this._place();
    if (!this._target) return;
    const follow = () => {
      this._place();
      if (this._target) this._raf = requestAnimationFrame(follow);
    };
    this._raf = requestAnimationFrame(follow);
  }

  _place() {
    const style = this.host.style;
    const target = this._target;
    if (!target?.isConnected || !this._videoId) {
      Object.assign(style, { width: "1px", height: "1px", left: "0px", top: "0px", opacity: "0" });
      return;
    }
    const rect = target.getBoundingClientRect();
    Object.assign(style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      borderRadius: getComputedStyle(target).borderRadius || "0px",
      opacity: this.readyState >= 2 ? "1" : "0",
    });
  }

  // ─── Internals ───

  _emit(type) { this.dispatchEvent(new Event(type)); }

  _load(id) {
    this._videoId = id;
    this._time = 0;
    this._duration = NaN;
    this._metadataSent = false;
    this.error = null;
    this.ended = false;
    this.paused = true;
    this.readyState = 0;
    this._place();
    if (!id) return;
    // Runs after a play() made in the same tap, so the song starts straight away
    this.ready.then((p) => {
      if (this._videoId !== id) return;
      if (this._wantPlay) p.loadVideoById(id);
      else p.cueVideoById(id);
    }).catch(() => {});
  }

  _onState(state) {
    if (state === YT_STATE.PLAYING) {
      const wasPaused = this.paused;
      this.paused = false;
      this.ended = false;
      this.readyState = 4;
      this._readDuration();
      if (wasPaused) this._emit("play");
      this._emit("playing");
    } else if (state === YT_STATE.PAUSED) {
      if (!this.paused) {
        this.paused = true;
        this._emit("pause");
      }
    } else if (state === YT_STATE.BUFFERING) {
      this.readyState = 2;
      this._emit("waiting");
    } else if (state === YT_STATE.ENDED) {
      this.paused = true;
      this.ended = true;
      this._emit("pause");
      this._emit("ended");
    } else if (state === YT_STATE.CUED) {
      this.readyState = 1;
      this._readDuration();
    }
    this._place();
  }

  // 2 bad id, 5 HTML5 player error, 100 removed/private, 101 & 150 embedding not allowed
  _onError(code) {
    this.paused = true;
    this.error = { code: code === 5 ? 3 : 4, message: `YouTube player error ${code}`, youtubeCode: code };
    this._emit("error");
  }

  _readDuration() {
    const duration = this.player?.getDuration?.();
    if (!(duration > 0) || duration === this._duration) return;
    this._duration = duration;
    this._emit("durationchange");
    if (!this._metadataSent) {
      this._metadataSent = true;
      this._emit("loadedmetadata");
    }
  }

  _tick() {
    if (!this.player?.getCurrentTime || !this._videoId) return;
    this._readDuration();
    if (this.paused) return;
    const time = this.player.getCurrentTime();
    if (Number.isFinite(time) && time !== this._time) {
      this._time = time;
      this._emit("timeupdate");
    }
  }
}

let instance = null;

// One shared player for the whole site (created on first use, in the browser only)
export function getYouTubeElement() {
  if (typeof window === "undefined") return null;
  if (!instance) instance = new YouTubeMediaElement();
  return instance;
}

export const existingYouTubeElement = () => instance;
