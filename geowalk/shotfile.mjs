import puppeteer from 'puppeteer-core';
const hardExit = setTimeout(() => { console.log('FORCED'); process.exit(3); }, 40000);
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
await page.setViewport({ width: 480, height: 320 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('file:///Users/base/Documents/GitHub/experiments/geowalk/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction('typeof ready !== "undefined" && ready === true', { timeout: 15000 });
const info = await page.evaluate(() => ({
    protocol: location.protocol,
    hasEmbeddedStyle: !!window.GEOWALK_STYLE,
    hasEmbeddedSettings: !!window.GEOWALK_SETTINGS,
    walkSpeed: CONFIG.walkSpeed,
    start: CONFIG.start,
    styleType: typeof map.getStyle().name + ' layers=' + map.getStyle().layers.length,
    hasOpenmaptiles: !!map.getSource('openmaptiles')
}));
console.log('INFO', JSON.stringify(info, null, 2));
console.log('pageerrors', [...new Set(errs)].slice(0, 6));
clearTimeout(hardExit);
await browser.close();
process.exit(0);
