/**
 * chart.js
 * Wraps TradingView's Lightweight Charts (loaded from CDN in index.html)
 * to render the BTC/USDC price history and keep it live-updating.
 */
const PriceChart = (() => {
  let chart = null;
  let areaSeries = null;
  let priceLine = null;
  let container = null;
  let resizeObserver = null;
  let lastBarTime = null;

  const palette = {
    up: '#22c99b',
    down: '#ef5462',
    line: '#5ad1ac',
    topFill: 'rgba(90, 209, 172, 0.28)',
    bottomFill: 'rgba(90, 209, 172, 0.00)',
    grid: 'rgba(255, 255, 255, 0.045)',
    text: '#8b939b',
    crosshair: 'rgba(245, 246, 247, 0.35)',
  };

  function init(containerEl) {
    container = containerEl;
    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: palette.text,
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: palette.crosshair, width: 1, style: 3, labelBackgroundColor: '#1c2024' },
        horzLine: { color: palette.crosshair, width: 1, style: 3, labelBackgroundColor: '#1c2024' },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false },
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    areaSeries = chart.addSeries(LightweightCharts.AreaSeries, {
      lineColor: palette.line,
      topColor: palette.topFill,
      bottomColor: palette.bottomFill,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);
  }

  function setHistory(candles) {
    if (!areaSeries) return;
    const points = candles.map((c) => ({ time: c.time, value: c.close }));
    areaSeries.setData(points);
    lastBarTime = points.length ? points[points.length - 1].time : null;
    if (points.length) chart.timeScale().fitContent();
  }

  /** Called on every live candle update for the active interval. */
  function updateBar(candle) {
    if (!areaSeries) return;
    areaSeries.update({ time: candle.time, value: candle.close });
    lastBarTime = candle.time;
  }

  /** Moves the subtle current-price line as fresh ticks stream in. */
  function updateCurrentPriceLine(price, isUp) {
    if (!areaSeries) return;
    if (priceLine) {
      areaSeries.removePriceLine(priceLine);
      priceLine = null;
    }
    priceLine = areaSeries.createPriceLine({
      price,
      color: isUp ? palette.up : palette.down,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'now',
    });
  }

  function clear() {
    if (areaSeries) areaSeries.setData([]);
    lastBarTime = null;
  }

  function destroy() {
    if (resizeObserver && container) resizeObserver.unobserve(container);
    resizeObserver = null;
    if (chart) chart.remove();
    chart = null;
    areaSeries = null;
    priceLine = null;
  }

  return { init, setHistory, updateBar, updateCurrentPriceLine, clear, destroy };
})();
