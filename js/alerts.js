/**
 * alerts.js
 * Fully client-side price alert system. Nothing here talks to a backend —
 * the alert configuration lives in localStorage, and triggering happens
 * entirely in the browser as live prices stream in.
 */

class AlertManager {
  /**
   * @param {(alert: {price:number, direction:string}) => void} onTrigger
   */
  constructor(onTrigger) {
    this.onTrigger = onTrigger;
    this.alert = this._load();
    this.soundOn = localStorage.getItem(CONFIG.STORAGE_KEYS.ALERT_SOUND) === 'true';
    this._armed = !!this.alert;
    this._audioCtx = null;
  }

  _load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEYS.ALERT);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.price === 'number' &&
        (parsed.direction === 'above' || parsed.direction === 'below')
      ) {
        return parsed;
      }
    } catch (_) {
      /* ignore corrupt storage */
    }
    return null;
  }

  setAlert(price, direction) {
    if (!Number.isFinite(price) || price <= 0) return false;
    if (direction !== 'above' && direction !== 'below') return false;
    this.alert = { price, direction };
    this._armed = true;
    localStorage.setItem(CONFIG.STORAGE_KEYS.ALERT, JSON.stringify(this.alert));
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    return true;
  }

  clearAlert() {
    this.alert = null;
    this._armed = false;
    localStorage.removeItem(CONFIG.STORAGE_KEYS.ALERT);
  }

  setSound(on) {
    this.soundOn = on;
    localStorage.setItem(CONFIG.STORAGE_KEYS.ALERT_SOUND, String(on));
  }

  /** Call on every live price tick. */
  checkPrice(price) {
    if (!this._armed || !this.alert || !Number.isFinite(price)) return;

    const { price: target, direction } = this.alert;
    const hit = direction === 'above' ? price >= target : price <= target;
    if (!hit) return;

    this._armed = false; // fire once per configured level
    this._notify(price);
    if (this.soundOn) this._playSound();
    this.onTrigger?.({ price, direction, target });
  }

  /** Re-arm the same stored alert (e.g. user dismisses the banner but wants to keep watching). */
  rearm() {
    if (this.alert) this._armed = true;
  }

  _notify(price) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('BTC/USDC Price Alert', {
        body: `BTC/USDC has reached $${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      });
    } catch (_) {
      /* Notifications unsupported in this context — ignore. */
    }
  }

  _playSound() {
    // Must only run after a user interaction elsewhere on the page has
    // unlocked the AudioContext (browser autoplay policy).
    try {
      if (!this._audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._audioCtx = new Ctx();
      }
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const now = ctx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.4);
      });
    } catch (_) {
      /* audio not available — fail silently, visual/notification alert still fires */
    }
  }

  unlockAudio() {
    try {
      if (!this._audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this._audioCtx = new Ctx();
      } else if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume();
      }
    } catch (_) {
      /* no-op */
    }
  }
}
