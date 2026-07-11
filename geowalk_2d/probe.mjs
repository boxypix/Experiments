import puppeteer from 'puppeteer-core';
const hardExit = setTimeout(() => { console.log('FORCED'); process.exit(3); }, 35000);
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const errs = [], consoleErrs = [];
const page = await browser.newPage();
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
await page.goto('http://localhost:8800/index.html', { waitUntil: 'load', timeout: 20000 });
// hook map error events asap
await page.evaluate(() => { window.__mapErrs = []; const iv = setInterval(() => { if (window.map) { clearInterval(iv); map.on('error', e => window.__mapErrs.push(String(e && e.error && e.error.message || e.error || e))); } }, 50); });
await page.waitForFunction('typeof ready !== "undefined" && ready === true', { timeout: 15000 });
await new Promise(r => setTimeout(r, 9000));
const out = await page.evaluate(() => {
    const r = {};
    r.zoom = +map.getZoom().toFixed(1);
    r.omtLoaded = map.isSourceLoaded('openmaptiles');
    r.rendered = map.queryRenderedFeatures().length;
    try { r.srcTransportation = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' }).length; } catch (e) { r.srcTransportation = 'err:' + e.message; }
    try { r.srcBuilding = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' }).length; } catch (e) { r.srcBuilding = 'err'; }
    r.mapErrs = (window.__mapErrs || []).slice(0, 6);
    return r;
});
console.log('OUT', JSON.stringify(out, null, 2));
console.log('pageerrors', [...new Set(errs)].slice(0, 6));
console.log('consoleErrors', [...new Set(consoleErrs)].slice(0, 6));
clearTimeout(hardExit);
await browser.close();
process.exit(0);
