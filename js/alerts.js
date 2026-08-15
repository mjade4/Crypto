/**
 * alerts.js
 * A single, simple price alert stored in localStorage. No backend, no push
 * service — this only works while the tab is open, which is stated plainly
 * in the UI so nobody expects otherwise.
 */
const Alerts = (() => {
  let current = null; // { price, condition: 'above'|'below', enabled, triggered }

  function load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_ALERT);
      current = raw ? JSON.parse(raw) : null;
    } catch (e) {
      current = null;
    }
    return current;
  }

  function save() {
    try {
      if (current) {
        localStorage.setItem(CONFIG.STORAGE_ALERT, JSON.stringify(current));
      } else {
        localStorage.removeItem(CONFIG.STORAGE_ALERT);
      }
    } catch (e) {
      console.warn('[Alerts] localStorage unavailable, alert will not persist across reloads');
    }
  }

  function set(price, condition) {
    current = { price: Number(price), condition, enabled: true, triggered: false };
    save();
    return current;
  }

  function setEnabled(enabled) {
    if (!current) return;
    current.enabled = enabled;
    if (enabled) current.triggered = false;
    save();
  }

  function clear() {
    current = null;
    save();
  }

  function get() {
    return current;
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    try {
      return await Notification.requestPermission();
    } catch (e) {
      return 'denied';
    }
  }

  function notify(price) {
    const body = `${CONFIG.DISPLAY_SYMBOL} has reached $${formatUsd(price)}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🔔 BTC/USDC price alert', { body });
      } catch (e) {
        /* fall through to in-page banner, handled by app.js */
      }
    }
  }

  function formatUsd(value) {
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Checks a fresh price against the active alert. Returns true exactly
   * once when the threshold is crossed, so callers can fire a single
   * notification instead of repeating it on every tick.
   */
  function checkPrice(price) {
    if (!current || !current.enabled || current.triggered) return false;
    const crossed =
      (current.condition === 'above' && price >= current.price) ||
      (current.condition === 'below' && price <= current.price);
    if (crossed) {
      current.triggered = true;
      save();
      notify(price);
      return true;
    }
    return false;
  }

  load();

  return { set, setEnabled, clear, get, checkPrice, requestNotificationPermission };
})();
