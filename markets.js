/* =========================================================
   Märkte & Nachrichten – Live-Daten
   ---------------------------------------------------------
   Edelmetalle  : gold-api.com (Spot, USD)  → Umrechnung in EUR
   Wechselkurs  : CoinGecko (Ersatz: EZB-Referenzkurs via Frankfurter)
   Krypto       : CoinGecko (Ersatz: CoinPaprika)
   ETFs/Aktien  : TradingView-Widgets (erst nach Einwilligung)
   Nachrichten  : RSS-Feeds der Finanzmedien via rss2json.com

   Prinzipien: nur laden, was sichtbar wird · Antworten cachen ·
   Abfragen pausieren, wenn der Tab im Hintergrund ist ·
   Fremddaten nie als HTML einsetzen (nur textContent).
   ========================================================= */
(() => {
    'use strict';

    /* ---------- Konfiguration (hier lassen sich Werte & Quellen anpassen) ---------- */
    const CONFIG = {
        refresh: { metals: 60e3, crypto: 120e3, news: 15 * 60e3 }, // ms
        timeout: 9000,
        consentKey: 'rfw-ext-charts',
        metals: ['XAU', 'XAG', 'XPT'],

        // Aktien-Widget: Tabs mit [TradingView-Symbol, Anzeigename]
        stocks: [
            { title: 'US-Tech', symbols: [
                ['NASDAQ:NVDA', 'NVIDIA'], ['NASDAQ:AAPL', 'Apple'], ['NASDAQ:MSFT', 'Microsoft'],
                ['NASDAQ:AMZN', 'Amazon'], ['NASDAQ:GOOGL', 'Alphabet'], ['NASDAQ:META', 'Meta'],
                ['NASDAQ:TSLA', 'Tesla'], ['NASDAQ:AVGO', 'Broadcom']
            ] },
            { title: 'Deutschland', symbols: [
                ['GETTEX:SAP', 'SAP'], ['GETTEX:SIE', 'Siemens'], ['GETTEX:ALV', 'Allianz'],
                ['GETTEX:RHM', 'Rheinmetall'], ['GETTEX:DTE', 'Dt. Telekom'], ['GETTEX:MUV2', 'Münchener Rück'],
                ['GETTEX:IFX', 'Infineon'], ['GETTEX:ENR', 'Siemens Energy']
            ] },
            { title: 'Rohstoff-Titel', symbols: [
                ['NYSE:NEM', 'Newmont (Gold)'], ['NYSE:AEM', 'Agnico Eagle (Gold)'], ['NYSE:WPM', 'Wheaton (Edelmetalle)'],
                ['NYSE:CCJ', 'Cameco (Uran)'], ['NYSE:MP', 'MP Materials (Seltene Erden)'], ['NYSE:FCX', 'Freeport (Kupfer)']
            ] }
        ],

        // Nachrichtenquellen (RSS). "cat" = Thema, dem alle Meldungen der Quelle zugeordnet werden.
        feeds: [
            { name: 'tagesschau', url: 'https://www.tagesschau.de/wirtschaft/finanzen/index~rss2.xml' },
            { name: 'Handelsblatt', url: 'https://www.handelsblatt.com/contentexport/feed/finanzen' },
            { name: 'FAZ', url: 'https://www.faz.net/rss/aktuell/finanzen/' },
            { name: 'manager magazin', url: 'https://www.manager-magazin.de/finanzen/index.rss' },
            { name: 'n-tv', url: 'https://www.n-tv.de/wirtschaft/rss' },
            { name: 'finanznachrichten.de', url: 'https://www.finanznachrichten.de/rss-aktien-nachrichten' },
            { name: 'wallstreet-online', url: 'https://www.wallstreet-online.de/rss/nachrichten-alle.xml' },
            { name: 'DER AKTIONÄR', url: 'https://www.deraktionaer.de/aktionaer-news.rss' },
            { name: 'Goldreporter', url: 'https://www.goldreporter.de/feed/', cat: 'metal' },
            { name: 'BTC-ECHO', url: 'https://www.btc-echo.de/feed/', cat: 'crypto' }
        ]
    };

    const OZ_IN_G = 31.1034768;
    const root = document.documentElement;
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

    /* =========================================================
       HILFSFUNKTIONEN
       ========================================================= */
    const store = {
        get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll/gesperrt */ } },
        del(k) { try { localStorage.removeItem(k); } catch { /* ignorieren */ } }
    };

    /** JSON laden mit Timeout und optionalem Cache (ttl in ms, über Seitenaufrufe hinweg). */
    async function getJSON(url, { ttl = 0, force = false } = {}) {
        const key = 'rfw-c:' + url;
        if (ttl && !force) {
            const hit = store.get(key);
            if (hit && Date.now() - hit.t < ttl) return hit.d;
        }
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), CONFIG.timeout);
        try {
            const res = await fetch(url, { signal: ctl.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (ttl) store.set(key, { t: Date.now(), d: data });
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    /* Zahlenformate (Intl-Formatter werden einmal erzeugt und wiederverwendet) */
    const fmtCache = new Map();
    const nf = opts => {
        const k = JSON.stringify(opts);
        if (!fmtCache.has(k)) fmtCache.set(k, new Intl.NumberFormat('de-DE', opts));
        return fmtCache.get(k);
    };
    const num = (v, d = 2) => nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
    const money = (v, cur = 'EUR', d = 2) => nf({ style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
    const compact = (v, cur = 'EUR') => nf({ style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 2 }).format(v);
    const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + num(Math.abs(v), 2) + ' %';
    const trend = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
    const clock = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
    const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
    const ago = ts => {
        const s = Math.round((ts - Date.now()) / 1000);
        const a = Math.abs(s);
        if (a < 60) return 'gerade eben';
        if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
        if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
        return rtf.format(Math.round(s / 86400), 'day');
    };

    /** Element mit Klassen/Text bauen – Fremddaten landen ausschließlich in textContent. */
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

    /** Wert setzen und bei Änderung kurz grün/rot aufblitzen lassen. */
    function setVal(node, text, dir = 0) {
        if (!node || node.textContent === text) return;
        node.textContent = text;
        if (!dir) return;
        node.classList.remove('flash-up', 'flash-down');
        void node.offsetWidth; // Animation neu starten
        node.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
    }

    /* Markt-Überblick ganz oben: kleine Kacheln, gespeist aus denselben Abfragen wie die Detailbereiche */
    const Snap = {
        item: key => $(`[data-snap-item="${key}"]`),
        set(key, price, sub, dir = 0, subDir = '') {
            const it = Snap.item(key);
            if (!it) return;
            it.classList.remove('is-loading');
            setVal($('.snap-price', it), price, dir);
            const s = $('.snap-sub', it);
            s.textContent = sub;
            s.className = 'snap-sub' + (subDir ? ' ' + subDir : '');
        },
        time(d) { const t = $('[data-snap="time"]'); if (t) t.textContent = clock(d); }
    };
    $$('[data-snap-item]').forEach(i => i.classList.add('is-loading'));

    /** Aufgabe periodisch ausführen – pausiert, solange der Tab verborgen ist. */
    function poll(task, every) {
        let timer = 0, last = 0;
        const run = async () => {
            clearTimeout(timer);
            last = Date.now();
            try { await task(); } catch (err) { console.warn('[Märkte]', err); }
            if (!document.hidden) timer = setTimeout(run, every);
        };
        document.addEventListener('visibilitychange', () => {
            clearTimeout(timer);
            if (document.hidden) return;
            const wait = every - (Date.now() - last);
            wait <= 0 ? run() : (timer = setTimeout(run, wait));
        });
        run();
        return run; // erlaubt manuelles Neuladen
    }

    /** Callback einmalig ausführen, sobald ein Element in die Nähe des Viewports kommt. */
    function whenNear(node, fn, margin = '400px') {
        if (!node) return;
        if (!('IntersectionObserver' in window)) { fn(); return; }
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
        }, { rootMargin: margin });
        io.observe(node);
    }

    /* =========================================================
       WECHSELKURS  (USD → EUR)
       ========================================================= */
    async function usdToEur() {
        try {
            const { rates } = await getJSON('https://api.coingecko.com/api/v3/exchange_rates', { ttl: 5 * 60e3 });
            const r = rates.eur.value / rates.usd.value;
            if (r > 0) return r;
        } catch { /* nächste Quelle */ }
        try {
            const j = await getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', { ttl: 60 * 60e3 });
            if (j.rates.EUR > 0) return j.rates.EUR;
        } catch { /* nächste Quelle */ }
        const g = await getJSON('https://api.gold-api.com/price/XAU/EUR', { ttl: 30 * 60e3 });
        return g.exchangeRate;
    }

    /* =========================================================
       TRADINGVIEW-WIDGETS  (mit Einwilligung, lazy geladen)
       ========================================================= */
    const TV = (() => {
        const BASE = 'https://s3.tradingview.com/external-embedding/embed-widget-';
        const GOLD = 'rgba(230, 194, 90, 1)';
        const slots = $$('.tv-slot');
        let io = null;

        const widgetFor = slot => {
            if (slot.dataset.tv === 'market-overview') {
                return ['market-overview', {
                    colorTheme: 'dark', isTransparent: true, locale: 'de_DE',
                    width: '100%', height: '100%', dateRange: '1D',
                    showChart: true, showSymbolLogo: true, showFloatingTooltip: true,
                    largeChartUrl: '',
                    plotLineColorGrowing: GOLD, plotLineColorFalling: 'rgba(255, 107, 107, 1)',
                    gridLineColor: 'rgba(255, 255, 255, 0.05)', scaleFontColor: 'rgba(154, 167, 196, 1)',
                    belowLineFillColorGrowing: 'rgba(230, 194, 90, 0.22)', belowLineFillColorGrowingBottom: 'rgba(230, 194, 90, 0)',
                    belowLineFillColorFalling: 'rgba(255, 107, 107, 0.18)', belowLineFillColorFallingBottom: 'rgba(255, 107, 107, 0)',
                    symbolActiveColor: 'rgba(217, 180, 74, 0.12)',
                    tabs: CONFIG.stocks.map(t => ({ title: t.title, originalTitle: t.title, symbols: t.symbols.map(([s, d]) => ({ s, d })) }))
                }];
            }
            return ['mini-symbol-overview', {
                symbol: slot.dataset.symbol, locale: 'de_DE', dateRange: slot.dataset.range || '12M',
                colorTheme: 'dark', isTransparent: true, autosize: true, width: '100%', height: '100%',
                largeChartUrl: '', noTimeScale: false, chartOnly: false,
                trendLineColor: GOLD, underLineColor: 'rgba(230, 194, 90, 0.22)', underLineBottomColor: 'rgba(230, 194, 90, 0)'
            }];
        };

        function placeholder(slot) {
            delete slot.dataset.mounted;
            slot.classList.remove('is-mounted');
            slot.replaceChildren();
            const box = el('div', 'tv-placeholder');
            box.innerHTML = '<svg class="tv-ghost" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 46 L22 40 L40 44 L62 30 L84 34 L104 22 L126 28 L148 14 L170 20 L200 8"/></svg>';
            box.append(
                el('p', 'tv-label', slot.dataset.label || 'Live-Kurs & Chart'),
                Object.assign(el('button', 'tv-load', 'Live-Chart laden'), { type: 'button' })
            );
            $('.tv-load', box).dataset.consent = 'on';
            slot.append(box);
        }

        function mount(slot) {
            const key = slot.dataset.tv + '|' + (slot.dataset.symbol || '');
            if (slot.dataset.mounted === key) return;
            slot.dataset.mounted = key;
            const [name, cfg] = widgetFor(slot);
            const wrap = el('div', 'tradingview-widget-container');
            const inner = el('div', 'tradingview-widget-container__widget');
            const script = document.createElement('script');
            script.src = BASE + name + '.js';
            script.async = true;
            script.textContent = JSON.stringify(cfg);
            wrap.append(inner, script);
            slot.replaceChildren(wrap);
            slot.classList.add('is-mounted');
        }

        const consented = () => root.classList.contains('tv-on');

        function observe() {
            if (io || !consented()) return;
            if (!('IntersectionObserver' in window)) { slots.forEach(mount); return; }
            io = new IntersectionObserver(entries => {
                entries.forEach(e => { if (e.isIntersecting) { mount(e.target); io.unobserve(e.target); } });
            }, { rootMargin: '250px' });
            slots.forEach(s => io.observe(s));
        }

        function setConsent(on) {
            root.classList.toggle('tv-on', on);
            if (on) { store.set(CONFIG.consentKey, 1); observe(); return; }
            store.del(CONFIG.consentKey);
            if (io) { io.disconnect(); io = null; }
            slots.forEach(placeholder);
        }

        /** Nach Symbolwechsel neu laden (nur wenn bereits eingebunden). */
        function refresh(slot) {
            if (!consented()) return;
            if (slot.classList.contains('is-mounted')) mount(slot);
        }

        // Start
        if (consented()) observe(); else slots.forEach(placeholder);
        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-consent]');
            if (btn) setConsent(btn.dataset.consent === 'on');
        });

        return { refresh };
    })();

    /* =========================================================
       ETFs: Alternativen umschalten
       ========================================================= */
    $$('[data-etf]').forEach(card => {
        const buttons = $$('.alt-btn', card);
        if (!buttons.length) return;
        card.addEventListener('click', e => {
            const btn = e.target.closest('.alt-btn');
            if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
            buttons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            const d = btn.dataset;
            for (const f of ['name', 'isin', 'wkn', 'ter', 'ticker', 'note']) {
                const node = $(`[data-f="${f}"]`, card);
                if (node && f in d) node.textContent = d[f];
            }
            $('[data-f="link"]', card).href = 'https://www.justetf.com/de/etf-profile.html?isin=' + encodeURIComponent(d.isin);
            const slot = $('.tv-slot', card);
            slot.dataset.symbol = d.symbol;
            TV.refresh(slot);
        });
    });

    /* =========================================================
       EDELMETALLE
       ========================================================= */
    const Metals = (() => {
        const section = $('#edelmetalle');
        if (!section) return null;
        const cards = new Map($$('[data-metal]', section).map(c => [c.dataset.metal, c]));
        const v = (key, ctx = section) => $(`[data-v="${key}"]`, ctx);
        let state = null; // { XAU: { usd, eur }, …, fx }

        async function update() {
            const [fxRes, ...priceRes] = await Promise.allSettled([
                usdToEur(),
                ...CONFIG.metals.map(s => getJSON(`https://api.gold-api.com/price/${s}`))
            ]);
            const fx = fxRes.status === 'fulfilled' ? fxRes.value : state?.fx;
            const next = { fx };
            let newest = 0;

            CONFIG.metals.forEach((sym, i) => {
                const card = cards.get(sym);
                const r = priceRes[i];
                const status = $('[data-status]', card);
                if (r.status !== 'fulfilled' || !(r.value.price > 0) || !fx) {
                    status.textContent = state ? 'Offline' : 'Nicht verfügbar';
                    status.className = 'status is-off';
                    if (state?.[sym]) next[sym] = state[sym];
                    return;
                }
                const usd = r.value.price;
                const eur = usd * fx;
                const dir = state?.[sym] ? Math.sign(eur - state[sym].eur) : 0;
                next[sym] = { usd, eur };
                newest = Math.max(newest, Date.parse(r.value.updatedAt) || Date.now());

                setVal(v('eurOz', card), num(eur, 2), dir);
                setVal(v('eurG', card), money(eur / OZ_IN_G, 'EUR', 2));
                setVal(v('eurKg', card), money(eur / OZ_IN_G * 1000, 'EUR', 0));
                setVal(v('usdOz', card), money(usd, 'USD', 2));
                Snap.set(sym, num(eur, 2), '€ je Unze', dir);
                status.textContent = 'Live';
                status.className = 'status is-live';
            });

            state = next;
            const { XAU, XAG, XPT } = state;
            if (XAU && XAG) { setVal(v('gsr'), num(XAU.usd / XAG.usd, 2)); Snap.set('GSR', num(XAU.usd / XAG.usd, 1), 'Ratio'); }
            if (XAU && XPT) setVal(v('gpr'), num(XAU.usd / XPT.usd, 2));
            if (fx) setVal(v('fx'), num(1 / fx, 4));
            if (newest) { setVal(v('metalTime'), clock(new Date(newest))); Snap.time(new Date(newest)); }
            calc();
        }

        /* Rechner */
        const form = $('#metal-calc');
        const UNIT_G = { oz: OZ_IN_G, g: 1, kg: 1000 };
        function calc() {
            if (!form) return;
            const out = form.elements.result;
            const metal = state?.[form.elements.metal.value];
            const qty = parseFloat(String(form.elements.qty.value).replace(',', '.'));
            if (!metal || !(qty >= 0)) { out.textContent = '–'; return; }
            const grams = qty * UNIT_G[form.elements.unit.value];
            out.textContent = money(grams / OZ_IN_G * metal.eur, 'EUR', 2);
        }
        if (form) {
            form.addEventListener('input', calc);
            form.addEventListener('submit', e => e.preventDefault());
        }

        return { start: () => poll(update, CONFIG.refresh.metals) };
    })();

    /* =========================================================
       KRYPTOWÄHRUNGEN
       ========================================================= */
    const Crypto = (() => {
        const panel = $('#krypto');
        const list = $('[data-crypto-list]');
        if (!panel || !list) return null;
        const STABLE = /^(USDT|USDC|DAI|USDE|FDUSD|USDS|PYUSD|TUSD)$/i;
        const lastPrice = new Map();
        const lastPriceSnap = new Map();
        const c = key => $(`[data-c="${key}"]`, panel);

        /** Sparkline als SVG-Pfad (auf ~48 Punkte reduziert). */
        function sparkline(values, up) {
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 100 32');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.setAttribute('class', 'c-spark ' + (up ? 'up' : 'down'));
            svg.setAttribute('aria-hidden', 'true');
            if (values.length < 2) return svg;
            const step = Math.max(1, Math.floor(values.length / 48));
            const pts = values.filter((_, i) => i % step === 0 || i === values.length - 1);
            const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
            const xy = pts.map((p, i) => [(i / (pts.length - 1)) * 100, 30 - ((p - min) / span) * 28]);
            const line = xy.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)).join('');
            const area = document.createElementNS(NS, 'path');
            area.setAttribute('d', line + 'L100 32L0 32Z');
            area.setAttribute('class', 'area');
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', line);
            path.setAttribute('class', 'line');
            svg.append(area, path);
            return svg;
        }

        function row(coin, rank) {
            const li = el('li', 'crypto-row');
            const logo = coin.img
                ? Object.assign(el('img', 'c-logo'), { src: coin.img, alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' })
                : el('span', 'c-logo c-logo-text', coin.sym.slice(0, 1));

            const name = el('div', 'c-name');
            const title = el('strong', null, coin.name);
            if (STABLE.test(coin.sym)) {
                const b = el('a', 'badge', 'Stablecoin');
                b.href = '#g-stable';
                title.append(' ', b);
            }
            name.append(title, el('span', null, `${coin.sym} · ${compact(coin.mcap)}`));

            const price = el('div', 'c-price');
            const p = el('strong', 'num', money(coin.price, 'EUR', coin.price >= 1 ? 2 : 4));
            const prev = lastPrice.get(coin.id);
            if (prev != null && prev !== coin.price) p.classList.add(coin.price > prev ? 'flash-up' : 'flash-down');
            lastPrice.set(coin.id, coin.price);
            const ch = el('span', 'c-change');
            ch.append(
                el('span', 'chg ' + trend(coin.ch24), coin.ch24 == null ? '–' : pct(coin.ch24)),
                el('span', 'chg small ' + trend(coin.ch7), coin.ch7 == null ? '' : '7T ' + pct(coin.ch7))
            );
            price.append(p, ch);

            li.append(el('span', 'c-rank', String(rank)), logo, name, sparkline(coin.spark, (coin.ch7 ?? coin.ch24 ?? 0) >= 0), price);
            return li;
        }

        async function update() {
            let coins, source = 'CoinGecko';
            try {
                const data = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=5&page=1&sparkline=true&price_change_percentage=24h,7d', { ttl: 60e3 });
                coins = data.map(x => ({
                    id: x.id, name: x.name, sym: x.symbol.toUpperCase(), img: safeUrl(x.image),
                    price: x.current_price, mcap: x.market_cap,
                    ch24: x.price_change_percentage_24h_in_currency ?? x.price_change_percentage_24h,
                    ch7: x.price_change_percentage_7d_in_currency,
                    spark: x.sparkline_in_7d?.price || [],
                    t: Date.parse(x.last_updated)
                }));
            } catch {
                source = 'CoinPaprika';
                const data = await getJSON('https://api.coinpaprika.com/v1/tickers?quotes=EUR&limit=5', { ttl: 60e3 });
                coins = data.map(x => ({
                    id: x.id, name: x.name, sym: x.symbol, img: '',
                    price: x.quotes.EUR.price, mcap: x.quotes.EUR.market_cap,
                    ch24: x.quotes.EUR.percent_change_24h, ch7: x.quotes.EUR.percent_change_7d,
                    spark: [], t: Date.parse(x.last_updated)
                }));
            }
            list.replaceChildren(...coins.map((coin, i) => row(coin, i + 1)));
            coins.forEach(coin => {
                if (coin.sym !== 'BTC' && coin.sym !== 'ETH') return;
                const prev = lastPriceSnap.get(coin.sym);
                lastPriceSnap.set(coin.sym, coin.price);
                Snap.set(coin.sym, num(coin.price, coin.price >= 1000 ? 0 : 2),
                    coin.ch24 == null ? '€' : '24 h ' + pct(coin.ch24), prev == null ? 0 : Math.sign(coin.price - prev),
                    coin.ch24 == null ? '' : trend(coin.ch24));
            });
            const t = Math.max(...coins.map(x => x.t || 0)) || Date.now();
            c('time').textContent = clock(new Date(t)) + (source === 'CoinGecko' ? '' : ' (CoinPaprika)');

            try {
                const { data } = await getJSON('https://api.coingecko.com/api/v3/global', { ttl: 5 * 60e3 });
                setVal(c('mcap'), compact(data.total_market_cap.eur));
                setVal(c('dom'), num(data.market_cap_percentage.btc, 1) + ' %');
            } catch { /* optional */ }
        }

        async function safeUpdate() {
            try { await update(); }
            catch {
                if (!list.querySelector('.crypto-row:not(.is-skeleton)')) {
                    list.replaceChildren(el('li', 'empty-state', 'Kryptokurse sind gerade nicht erreichbar. Neuer Versuch in Kürze.'));
                }
            }
        }

        return { start: () => poll(safeUpdate, CONFIG.refresh.crypto) };
    })();

    /* =========================================================
       NACHRICHTEN – Aggregation, Themenzuordnung, Relevanz
       ========================================================= */
    const News = (() => {
        const section = $('#news');
        const grid = $('[data-news-list]');
        if (!section || !grid) return null;

        const CATS = {
            metal:  { label: 'Edelmetalle', weight: 3, re: /(gold(?!man|en\b|ene)|silber|platin(?!e)|palladium|edelmetall|feinunze)/i },
            etf:    { label: 'ETFs & Themen', weight: 3, re: /(\betfs?\b|indexfonds|sparplan|ishares|xtrackers|vaneck|wisdomtree|global x|\buran|kernkraft|atomkraft|nuklear|seltene(n)? erden|halbleiter|\bchips?\b|chipherst|robot|automatisierung|lithium|kupfer|rohstoff)/i },
            macro:  { label: 'Zinsen & Konjunktur', weight: 2, re: /(\bfed\b|federal reserve|\bezb\b|notenbank|zentralbank|leitzins|\bzins(en|wende|senkung|erhöhung|politik)?\b|inflation|anleihe|konjunktur|\bbip\b|rezession|arbeitsmarkt|arbeitslos|\bzoll|zölle|powell|lagarde|ölpreis|opec|us-dollar|dollarkurs|devisen|staatsschulden|schuldenkrise)/i },
            crypto: { label: 'Krypto', weight: 2, re: /(bitcoin|krypto|crypto|ethereum|\bether\b|blockchain|solana|\bxrp\b|ripple|stablecoin|\bbtc\b|\beth\b|binance|coinbase|tether|altcoin|cardano|\bada\b)/i },
            stock:  { label: 'Aktien', weight: 1, re: /(aktie|\bdax\b|mdax|sdax|tecdax|dow jones|\bdow\b|nasdaq|s&p|wall street|börse|quartal|dividende|kursziel|analyst|übernahme|börsengang|\bipo\b|umsatz|gewinnwarnung|hauptversammlung|\bindex\b)/i }
        };
        // Pflichtmitteilungen (Stimmrechte, Directors' Dealings …) und Werbung haben keine Marktrelevanz
        const NOISE = /^(eqs|dgap|pta|euro adhoc)[-\s]|stimmrechtsmitteilung|directors'? dealings|veröffentlichung gemäß|aktienrückkauf.{0,20}(meldung|zwischenmeldung)|\banzeige\b|werbung|sponsored|smartbroker/i;
        const PAGE = window.matchMedia('(max-width: 760px)').matches ? 4 : 9; // am Handy zunächst weniger Meldungen
        const parser = new DOMParser();
        const statusEl = $('[data-news-status]', section);
        const moreBtn = $('[data-news-more]', section);
        const sourcesEl = $('[data-news-sources]', section);
        let items = [], filter = 'all', shown = PAGE;

        const plain = html => (parser.parseFromString(html || '', 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
        const clip = (s, n) => {
            if (s.length <= n) return s;
            const cut = s.lastIndexOf(' ', n);
            return s.slice(0, cut > n * 0.6 ? cut : n).replace(/[\s,.;:–-]+$/, '') + ' …';
        };
        // rss2json liefert Zeitstempel in UTC ("YYYY-MM-DD HH:MM:SS"); Zukunftswerte werden gekappt
        const parseDate = s => Math.min(Date.parse(String(s).replace(' ', 'T') + 'Z') || Date.now(), Date.now());

        function classify(item, feed) {
            const text = item.title + ' ' + item.teaser;
            const cats = Object.keys(CATS).filter(k => CATS[k].re.test(text));
            if (feed.cat && !cats.includes(feed.cat)) cats.unshift(feed.cat);
            const score = cats.reduce((s, k) => s + CATS[k].weight, 0);
            return { cats, score };
        }

        async function loadFeed(feed, force) {
            const j = await getJSON('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feed.url), { ttl: force ? 0 : 10 * 60e3 });
            if (j.status !== 'ok') throw new Error(j.message || 'Feed-Fehler');
            return j.items.map(raw => {
                const item = {
                    title: plain(raw.title),
                    teaser: clip(plain(raw.description || raw.content), 190),
                    link: safeUrl(raw.link),
                    ts: parseDate(raw.pubDate),
                    source: feed.name
                };
                return Object.assign(item, classify(item, feed));
            }).filter(i => i.link && i.title && i.cats.length && !NOISE.test(i.title));
        }

        async function load(force = false) {
            grid.setAttribute('aria-busy', 'true');
            const results = await Promise.allSettled(CONFIG.feeds.map(f => loadFeed(f, force)));
            const seen = new Set();
            const fresh = [];
            results.forEach(r => {
                if (r.status !== 'fulfilled') return;
                for (const it of r.value) {
                    const key = it.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '').slice(0, 70);
                    if (seen.has(key) || seen.has(it.link)) continue;
                    seen.add(key); seen.add(it.link);
                    fresh.push(it);
                }
            });
            const failed = results.filter(r => r.status !== 'fulfilled').length;
            grid.setAttribute('aria-busy', 'false');

            if (!fresh.length) {
                if (!items.length) grid.replaceChildren(el('p', 'empty-state', 'Nachrichten sind gerade nicht erreichbar. Bitte später erneut versuchen.'));
                statusEl.textContent = 'Keine Verbindung zu den Quellen';
                return;
            }

            // Neueste zuerst; die relevanteste Meldung der letzten 12 Stunden wird hervorgehoben.
            fresh.sort((a, b) => b.ts - a.ts);
            const recent = fresh.filter(i => Date.now() - i.ts < 12 * 3600e3);
            const top = (recent.length ? recent : fresh).reduce((best, i) => (i.score > best.score ? i : best));
            fresh.forEach(i => { i.featured = i === top; });
            items = [top, ...diversify(fresh.filter(i => i !== top))];

            statusEl.textContent = `Stand ${clock(new Date())} · ${items.length} Meldungen` + (failed ? ` · ${failed} Quelle${failed > 1 ? 'n' : ''} nicht erreichbar` : '');
            const okFeeds = CONFIG.feeds.filter((_, i) => results[i].status === 'fulfilled').map(f => f.name);
            sourcesEl.textContent = 'Quellen: ' + okFeeds.join(' · ') + ' – Überschriften und Anreißer verlinken auf die Originalartikel.';
            updateCounts();
            render();
        }

        /** Reihenfolge nach Zeit beibehalten, aber keine Quelle darf die Liste dominieren. */
        function diversify(list, span = 6, max = 2) {
            const out = [], queue = [...list];
            while (queue.length) {
                const recentSrc = out.slice(-span).map(i => i.source);
                const idx = queue.findIndex(i => recentSrc.filter(s => s === i.source).length < max);
                out.push(queue.splice(idx < 0 ? 0 : idx, 1)[0]);
            }
            return out;
        }

        function card(item) {
            const art = el('article', 'news-card spotlight' + (item.featured && filter === 'all' ? ' is-featured' : ''));
            const top = el('div', 'news-top');
            const time = el('time', null, ago(item.ts));
            time.dateTime = new Date(item.ts).toISOString();
            time.dataset.ts = item.ts;
            top.append(el('span', 'news-src', item.source), time);
            if (item.featured && filter === 'all') top.prepend(el('span', 'news-flag', 'Im Fokus'));

            const h = el('h3');
            const a = el('a', null, item.title);
            a.href = item.link;
            a.target = '_blank';
            a.rel = 'noopener';
            h.append(a);

            const tags = el('div', 'news-tags');
            item.cats.slice(0, 3).forEach(k => tags.append(el('span', 'tag tag-' + k, CATS[k].label)));
            art.append(top, h);
            if (item.teaser) art.append(el('p', null, item.teaser));
            art.append(tags);
            return art;
        }

        function render() {
            const list = filter === 'all' ? items : items.filter(i => i.cats.includes(filter)).sort((a, b) => b.ts - a.ts);
            const page = list.slice(0, shown);
            grid.replaceChildren(...(page.length ? page.map(card) : [el('p', 'empty-state', 'Zu diesem Thema gibt es gerade keine aktuellen Meldungen.')]));
            moreBtn.hidden = list.length <= shown;
        }

        function updateCounts() {
            $$('[data-count]', section).forEach(n => {
                const k = n.dataset.count;
                n.textContent = k === 'all' ? items.length : items.filter(i => i.cats.includes(k)).length;
            });
        }

        // Filter, „Mehr", Neu laden
        $$('[data-cat]', section).forEach(btn => btn.addEventListener('click', () => {
            filter = btn.dataset.cat;
            shown = PAGE;
            $$('[data-cat]', section).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            render();
        }));
        moreBtn.addEventListener('click', () => { shown += PAGE; render(); });
        const refreshBtn = $('[data-news-refresh]', section);
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('is-spinning');
            statusEl.textContent = 'Aktualisiere …';
            try { await load(true); } finally { refreshBtn.classList.remove('is-spinning'); }
        });

        // relative Zeitangaben aktuell halten
        setInterval(() => {
            if (document.hidden) return;
            $$('time[data-ts]', grid).forEach(t => { t.textContent = ago(+t.dataset.ts); });
        }, 60e3);

        return { start: () => poll(() => load(false), CONFIG.refresh.news) };
    })();

    /* =========================================================
       GLOSSAR: Begriffs-Links klappen den passenden Eintrag auf
       ========================================================= */
    const openTerm = id => {
        let n = id && document.getElementById(id);
        while (n) { if (n.tagName === 'DETAILS') n.open = true; n = n.parentElement; }
    };
    document.addEventListener('click', e => {
        const a = e.target.closest('a[href^="#"]');
        if (a && a.getAttribute('href').length > 1) openTerm(a.getAttribute('href').slice(1));
    });
    if (location.hash.length > 1) openTerm(location.hash.slice(1));

    /* =========================================================
       UNTERNAVIGATION (Scroll-Spy für die Marktbereiche)
       ========================================================= */
    const tabs = $$('.market-tabs a');
    if (tabs.length && 'IntersectionObserver' in window) {
        const targets = tabs.map(a => $(a.getAttribute('href'))).filter(Boolean);
        const spy = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                tabs.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
            });
        }, { rootMargin: '-40% 0px -55% 0px' });
        targets.forEach(t => spy.observe(t));
    }

    /* =========================================================
       START – jeder Bereich lädt erst, wenn er in Sichtweite kommt
       ========================================================= */
    const started = {};
    const go = (key, mod) => { if (!started[key] && mod) { started[key] = true; mod.start(); } };
    // Der Markt-Überblick steht ganz oben, also werden Edelmetalle und Krypto sofort geladen.
    whenNear($('#snapshot'), () => { go('metals', Metals); go('crypto', Crypto); }, '300px');
    whenNear($('#edelmetalle'), () => go('metals', Metals), '600px');
    whenNear($('#krypto'), () => go('crypto', Crypto), '600px');
    whenNear($('#news'), () => go('news', News), '800px');
})();
