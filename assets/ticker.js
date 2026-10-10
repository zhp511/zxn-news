// ZXN Markets ticker: TradingView "Ticker Tape" embed (free, no API key, real market data;
// stock quotes may be delayed per exchange rules). Falls back to a plain note if it can't load.
(function () {
  const host = document.getElementById("zxn-ticker-widget");
  if (!host) return;
  const symbols = [
    { proName: "AMEX:SPY", title: "S&P 500 (SPY)" },
    { proName: "AMEX:DIA", title: "Dow (DIA)" },
    { proName: "NASDAQ:QQQ", title: "Nasdaq 100 (QQQ)" },
    { proName: "AMEX:IWM", title: "Russell 2000 (IWM)" },
    { proName: "NASDAQ:AAPL", title: "Apple" },
    { proName: "NASDAQ:MSFT", title: "Microsoft" },
    { proName: "NASDAQ:NVDA", title: "Nvidia" },
    { proName: "NASDAQ:TSLA", title: "Tesla" },
    { proName: "NASDAQ:AMZN", title: "Amazon" },
    { proName: "NASDAQ:GOOGL", title: "Alphabet" },
    { proName: "NASDAQ:META", title: "Meta" },
    { proName: "NASDAQ:DJT", title: "Trump Media (DJT)" },
    { proName: "NYSE:TKO", title: "TKO Group (WWE/UFC)" },
    { proName: "BITSTAMP:BTCUSD", title: "Bitcoin" },
    { proName: "OANDA:XAUUSD", title: "Gold" },
    { proName: "TVC:USOIL", title: "WTI Crude Oil" },
  ];
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
  s.async = true;
  s.type = "text/javascript";
  s.text = JSON.stringify({
    symbols, showSymbolLogo: true, isTransparent: true, displayMode: "regular", colorTheme: "dark", locale: "en",
  });
  const bar = host.closest(".zxn-ticker"), track = host.parentElement;
  const fail = () => {
    if (!bar || track.querySelector("iframe")) return;
    bar.classList.add("ticker-down");
    track.innerHTML = '<span class="ticker-fallback">Market quotes are unavailable right now. <a href="https://www.tradingview.com/markets/" target="_blank" rel="noopener">See markets on TradingView →</a></span>';
  };
  s.onerror = fail;
  host.parentElement.appendChild(s);
  setTimeout(fail, 12000);
})();
