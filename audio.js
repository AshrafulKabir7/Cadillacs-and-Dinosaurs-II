/* User-supplied soundtrack. Only the current cue is downloaded. */
(() => {
  'use strict';
  const tracks = new Map(window.SOUNDTRACK.map(t => [t.id, t]));
  class ArcadeSoundtrack {
    constructor() {
      this.element = new Audio();
      this.element.preload = 'none';
      this.element.volume = .52;
      this.enabled = true;
      this.unlocked = false;
      this.paused = false;
      this.key = '';
      this.id = '';
      this.queue = [];
      this.error = '';
      this.limit = Infinity;
      this.element.addEventListener('ended', () => this.advance());
      this.element.addEventListener('timeupdate', () => {
        if (this.element.currentTime >= this.limit) this.advance();
      });
      this.element.addEventListener('error', () => {
        this.error = `Unable to load track ${this.id}`;
      });
    }
    unlock() { this.unlocked = true; this.resume(); }
    resume() {
      if (this.enabled && this.unlocked && !this.paused && this.id && this.element.paused) {
        this.element.play().catch(() => { /* A later user gesture retries autoplay. */ });
      }
    }
    cue(key, sequence) {
      if (key === this.key) return;
      this.key = key;
      this.queue = sequence.map(c => typeof c === 'string' ? { id: c, loop: true } : c);
      this.advance();
    }
    advance() {
      const cue = this.queue.shift();
      if (!cue) return;
      const track = tracks.get(cue.id);
      if (!track) return;
      this.id = cue.id;
      this.error = '';
      this.element.pause();
      this.element.src = track.file;
      this.element.loop = !!cue.loop;
      this.limit = cue.seconds || Infinity;
      this.element.load();
      this.resume();
    }
    update(enabled, paused, volume = .52) {
      this.enabled = enabled;
      this.paused = paused;
      this.element.volume = volume;
      if (!enabled || paused) this.element.pause();
      else this.resume();
    }
    get status() {
      return { id: this.id, title: tracks.get(this.id)?.title || '', playing: !this.element.paused,
        time: this.element.currentTime, ready: this.element.readyState, error: this.error };
    }
  }
  window.ArcadeSoundtrack = ArcadeSoundtrack;
})();
