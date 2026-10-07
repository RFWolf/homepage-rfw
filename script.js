(() => {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    /* ---------- Navbar: Scroll-Status, Fortschritt, Active-Link, To-Top ---------- */
    const navbar = $('.navbar');
    const progress = $('.scroll-progress');
    const toTop = $('.to-top');
    const navLinks = $$('.nav-menu a');
    const sections = navLinks
        .map(a => $(a.getAttribute('href')))
        .filter(Boolean);

    let ticking = false;
    const onScroll = () => {
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        navbar.classList.toggle('scrolled', y > 24);
        progress.style.transform = `scaleX(${max > 0 ? Math.min(y / max, 1) : 0})`;
        toTop.classList.toggle('show', y > 700);

        // aktive Sektion: letzte, deren Oberkante über der Viewport-Mitte liegt
        const mark = y + window.innerHeight * 0.4;
        let current = sections[0];
        for (const s of sections) if (s.offsetTop <= mark) current = s;
        navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));
        ticking = false;
    };
    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

    /* ---------- Mobile-Menü ---------- */
    const toggle = $('.nav-toggle');
    const menu = $('#nav-menu');
    const setMenu = open => {
        menu.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
        document.body.style.overflow = open ? 'hidden' : '';
    };
    toggle.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
    navLinks.forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
    window.matchMedia('(min-width: 761px)').addEventListener('change', e => { if (e.matches) setMenu(false); });

    /* ---------- Reveal on Scroll ---------- */
    const revealEls = $$('[data-reveal]');
    if ('IntersectionObserver' in window && !reduceMotion) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                el.classList.add('is-in');
                // Verzögerung nach dem Einblenden entfernen, damit Hover sofort reagiert
                const d = parseFloat(getComputedStyle(el).transitionDelay) || 0;
                setTimeout(() => el.classList.add('settled'), 900 + d * 1000);
                io.unobserve(el);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
        revealEls.forEach(el => io.observe(el));
    } else {
        revealEls.forEach(el => el.classList.add('is-in', 'settled'));
    }

    /* ---------- Spotlight-Effekt auf Karten ----------
       Ein einziger delegierter Listener – funktioniert auch für Karten,
       die später dynamisch eingefügt werden (Krypto, Nachrichten). */
    if (finePointer) {
        document.addEventListener('pointermove', e => {
            const card = e.target instanceof Element && e.target.closest('.spotlight');
            if (!card) return;
            const r = card.getBoundingClientRect();
            card.style.setProperty('--mx', `${e.clientX - r.left}px`);
            card.style.setProperty('--my', `${e.clientY - r.top}px`);
        }, { passive: true });

        /* Cursor-Glow (folgt der Maus mit leichter Trägheit) */
        const glow = $('.cursor-glow');
        let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy, running = false;
        const loop = () => {
            gx += (tx - gx) * 0.12;
            gy += (ty - gy) * 0.12;
            glow.style.transform = `translate(${gx}px, ${gy}px)`;
            if (Math.abs(tx - gx) + Math.abs(ty - gy) > 0.5) requestAnimationFrame(loop);
            else running = false;
        };
        window.addEventListener('pointermove', e => {
            tx = e.clientX; ty = e.clientY;
            glow.classList.add('on');
            if (!running) { running = true; requestAnimationFrame(loop); }
        }, { passive: true });
        document.addEventListener('pointerleave', () => glow.classList.remove('on'));

        /* Magnetische Buttons */
        if (!reduceMotion) {
            $$('[data-magnetic]').forEach(btn => {
                btn.addEventListener('pointermove', e => {
                    const r = btn.getBoundingClientRect();
                    const x = (e.clientX - r.left - r.width / 2) * 0.22;
                    const y = (e.clientY - r.top - r.height / 2) * 0.35;
                    btn.style.transform = `translate(${x}px, ${y - 3}px)`;
                });
                btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
            });
        }
    }

    /* ---------- Rotierendes Wort im Hero ---------- */
    const words = $$('.rotator-word');
    const rotator = $('.rotator');
    const fitRotator = () => { if (rotator) rotator.style.width = `${words.find(w => w.classList.contains('is-active')).offsetWidth}px`; };
    if (rotator && words.length) {
        fitRotator();
        document.fonts && document.fonts.ready.then(fitRotator);
        window.addEventListener('resize', fitRotator);
    }
    if (words.length > 1 && !reduceMotion) {
        let i = 0;
        setInterval(() => {
            const prev = words[i];
            i = (i + 1) % words.length;
            const next = words[i];
            prev.classList.remove('is-active');
            prev.classList.add('is-leaving');
            // neues Wort startet unten
            next.classList.remove('is-leaving');
            void next.offsetWidth;
            next.classList.add('is-active');
            fitRotator();
            setTimeout(() => {
                prev.classList.remove('is-leaving');
            }, 700);
        }, 2600);
    }

    /* ---------- Parallax der Aurora-Flächen ---------- */
    const auroras = $$('.aurora');
    if (!reduceMotion && auroras.length) {
        const hero = $('.hero');
        window.addEventListener('scroll', () => {
            const y = window.scrollY;
            if (y > hero.offsetHeight) return;
            auroras.forEach((a, n) => { a.style.translate = `0 ${y * (0.08 + n * 0.05)}px`; });
        }, { passive: true });
    }

    /* ---------- E-Mail kopieren ---------- */
    const copyBtn = $('.copy-btn');
    if (copyBtn) {
        const label = $('.copy-label', copyBtn);
        const original = label.textContent;
        copyBtn.addEventListener('click', async () => {
            const text = copyBtn.dataset.copy;
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch { /* ignorieren */ }
                ta.remove();
            }
            copyBtn.classList.add('done');
            label.textContent = 'Kopiert ✓';
            setTimeout(() => { copyBtn.classList.remove('done'); label.textContent = original; }, 2000);
        });
    }

    /* ---------- Animierter Chart im Hero (rein dekorativ) ---------- */
    const canvas = $('#chart-canvas');
    if (canvas && canvas.getContext) {
        const ctx = canvas.getContext('2d');
        let w = 0, h = 0, dpr = 1, visible = true, t = 0;

        // pseudo-zufällige, aber deterministische Kursverläufe (Summe von Sinuswellen)
        const series = [
            { amp: 0.20, base: 0.58, color: '217,180,74', width: 2.2, fill: true,  seed: 1.3, speed: 0.00018 },
            { amp: 0.16, base: 0.42, color: '110,150,255', width: 1.4, fill: false, seed: 4.1, speed: 0.00013 },
            { amp: 0.12, base: 0.72, color: '255,255,255', width: 1,   fill: false, seed: 7.7, speed: 0.00022 }
        ];
        const f = (s, x) =>
            s.base
            + s.amp * 0.55 * Math.sin(x * 2.1 + s.seed + t * s.speed * 1000)
            + s.amp * 0.30 * Math.sin(x * 5.3 + s.seed * 1.7 - t * s.speed * 1600)
            + s.amp * 0.15 * Math.sin(x * 11.7 + s.seed * 2.3 + t * s.speed * 2400)
            - x * 0.12; // leichter Aufwärtstrend (y wächst nach unten → minus = steigend)

        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = canvas.clientWidth; h = canvas.clientHeight;
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const draw = () => {
            ctx.clearRect(0, 0, w, h);
            const steps = Math.max(60, Math.floor(w / 8));
            series.forEach(s => {
                ctx.beginPath();
                for (let i = 0; i <= steps; i++) {
                    const x = i / steps;
                    const px = x * w, py = f(s, x) * h;
                    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
                }
                ctx.strokeStyle = `rgba(${s.color},${s.fill ? 0.9 : 0.35})`;
                ctx.lineWidth = s.width;
                ctx.lineJoin = 'round';
                ctx.stroke();
                if (s.fill) {
                    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
                    const g = ctx.createLinearGradient(0, 0, 0, h);
                    g.addColorStop(0, `rgba(${s.color},0.20)`);
                    g.addColorStop(1, `rgba(${s.color},0)`);
                    ctx.fillStyle = g;
                    ctx.fill();
                }
            });
        };

        let last = 0;
        const frame = ts => {
            if (visible) {
                t += Math.min(ts - last, 50);
                draw();
            }
            last = ts;
            if (!reduceMotion) requestAnimationFrame(frame);
        };

        resize();
        window.addEventListener('resize', () => { resize(); draw(); });
        new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }).observe(canvas);
        draw();
        if (!reduceMotion) requestAnimationFrame(ts => { last = ts; requestAnimationFrame(frame); });
    }
})();
