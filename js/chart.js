/**
 * chart.js
 * Thin wrapper around TradingView's Lightweight Charts (loaded via CDN in
 * index.html as the global `LightweightCharts`). Renders BTC/USDC candles
 * and a live current-price line, and exposes a small update API for app.js.
 */

class PriceChart {
  constructor(containerEl) {
    this.container = containerEl;
    this.chart = null;
    this.series = null;
    this.priceLine = null;
    this._lastBarTime = null;

    this._init();
    window.addEventListener('resize', () => this._resize());
  }

  _init() {
    if (typeof LightweightCharts === 'undefined') {
      this.container.innerHTML =
        '<div class="chart-fallback">Chart library failed to load. Check your network connection.</div>';
      return;
    }

    this.chart = LightweightCharts.createChart(this.container, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#9aa4b2',
        fontFamily:
          "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 3 },
        horzLine: { color: 'rgba(255,255,255,0.2)', width: 1, style: 3 },
      },
      autoSize: true,
    });

    this.series = this.chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
  }

  setHistory(candles) {
    if (!this.series || !candles.length) return;
    this.series.setData(candles);
    this._lastBarTime = candles[candles.length - 1].time;
    this.chart.timeScale().fitContent();
  }

  updateBar(candle) {
    if (!this.series) return;
    this.series.update(candle);
    this._lastBarTime = candle.time;
  }

  setCurrentPriceLine(price) {
    if (!this.series) return;
    if (this.priceLine) {
      this.series.removePriceLine(this.priceLine);
    }
    this.priceLine = this.series.createPriceLine({
      price,
      color: 'rgba(255,255,255,0.5)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '',
    });
  }

  clear() {
    if (this.series) this.series.setData([]);
    this._lastBarTime = null;
  }

  _resize() {
    if (!this.chart) return;
    this.chart.resize(this.container.clientWidth, this.container.clientHeight);
  }
}
