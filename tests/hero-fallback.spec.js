// Playwright-Test für den "CLAP"-Bug-Fix im Contentix-Bibliothek-Hero.
// Stellt sicher:
//   1. Bei geladenem Bild ist das ::before 🎬-Icon NICHT sichtbar.
//   2. Bei onerror (Bild fehlt) ist ::before SICHTBAR und der Gradient ist da.
//   3. Der Hero zeigt das tatsächlich neueste published-Video.

const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:3038';

async function openBibliothek(page) {
  // Hero lebt direkt auf der Startseite in index.html
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#libHero', { state: 'visible', timeout: 10_000 });
}

test.describe('Bibliothek-Hero 🎬-Fallback (CLAP-Bug-Regression)', () => {
  test('1. Bild lädt → 🎬-Icon NICHT sichtbar (display: none)', async ({ page }) => {
    await openBibliothek(page);

    const heroThumb = page.locator('.lib-hero-thumb');
    await expect(heroThumb).toBeVisible();

    // Hat die Klasse .has-image? (Fix-Voraussetzung)
    await expect(heroThumb).toHaveClass(/has-image/);

    // Computed style vom ::before prüfen — das ist die Pointe des Fixes.
    const beforeDisplay = await heroThumb.evaluate((el) => {
      const cs = window.getComputedStyle(el, '::before');
      return cs.display;
    });

    expect(beforeDisplay).toBe('none');
  });

  test('2. Bild fehlt (onerror) → 🎬-Icon sichtbar, Gradient da', async ({ page }) => {
    await openBibliothek(page);

    // Bild im Hero erzwingen, dass es fehlschlägt:
    // Wir ersetzen die src durch eine ungültige URL und triggern onerror manuell.
    const heroThumb = page.locator('.lib-hero-thumb');
    await heroThumb.evaluate((el) => {
      const img = el.querySelector('img');
      if (img) {
        img.src = 'about:blank'; // garantiert Fehler
        if (typeof img.onerror === 'function') {
          img.onerror(new Event('error'));
        }
      }
    });

    // Warten bis Fallback-Klasse gesetzt wurde (CSS-Reaktion auf onerror)
    await expect(heroThumb).toHaveClass(/lib-hero-thumb-fallback/, { timeout: 5_000 });
    await expect(heroThumb).not.toHaveClass(/has-image/);

    // ::before muss jetzt sichtbar sein
    const beforeDisplay = await heroThumb.evaluate((el) => {
      return window.getComputedStyle(el, '::before').display;
    });
    expect(beforeDisplay).not.toBe('none');

    // Hintergrund muss ein Gradient sein (nicht 'none', nicht einfach leer)
    const bg = await heroThumb.evaluate((el) => {
      return window.getComputedStyle(el).backgroundImage;
    });
    expect(bg).toMatch(/gradient/i);
  });

  test('3. Hero zeigt das neueste published-Video (Titel-Match)', async ({ page }) => {
    // Wahrheit: API-Endpunkt
    const apiRes = await page.request.get(BASE + '/api/videos?status=published');
    expect(apiRes.ok()).toBeTruthy();
    const videos = await apiRes.json();
    expect(Array.isArray(videos) && videos.length).toBeTruthy();

    const newest = videos
      .filter((v) => v.published_date)
      .sort((a, b) => new Date(b.published_date) - new Date(a.published_date))[0];
    expect(newest, 'mindestens ein published-Video mit publishedAt muss existieren').toBeTruthy();

    // UI
    await openBibliothek(page);
    const heroTitle = (await page.locator('#libHeroTitle').textContent())?.trim();
    expect(heroTitle).toBe(newest.title);
  });
});