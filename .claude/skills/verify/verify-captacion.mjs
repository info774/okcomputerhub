// Arnés de la página de captación de leads (paridad bloque 8, tanda 3):
// public/captacion.html sin sesión del hub, con Google Identity Services
// SIMULADO (un botón que devuelve un ID token falso) y la función captar-lead
// SIMULADA: puerta de Google, formulario, validaciones en el navegador, envío
// a la función del hub (sin claves), «Otro servicio», recordar la agencia,
// 401 → vuelta a la puerta, y sin emojis. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-captacion.mjs
import { servidor, navegador, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4208);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ email: 'comercial@agencia.test', name: 'Carla Comercial', exp: Math.floor(Date.now() / 1000) + 3600 })}.firma`;
// GIS falso: renderButton pinta un botón que llama al callback con el token.
const GIS = `window.google = { accounts: { id: {
  initialize(o) { window.__cb = o.callback; },
  renderButton(el) { const b = document.createElement('button'); b.id = 'gis-falso'; b.type = 'button'; b.textContent = 'Acceder con Google'; b.onclick = () => window.__cb({ credential: ${JSON.stringify(TOKEN)} }); el.appendChild(b); },
  disableAutoSelect() {},
} } };`;

const browser = await navegador();
const errores = [];
try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const envios = [];
  let respuesta = { status: 200, body: { ok: true } };
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS }));
  await ctx.route(`${SB}/functions/v1/captar-lead`, r => {
    envios.push({ cuerpo: r.request().postDataJSON(), cabeceras: r.request().headers() });
    return r.fulfill({ status: respuesta.status, contentType: 'application/json', body: JSON.stringify(respuesta.body) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/captacion.html?ref=AgenciaSur`);
  await page.waitForSelector('#gis-falso');
  ok(await page.isVisible('#gate') && !(await page.isVisible('#form-wrap')), 'puerta: sin Google no se ve el formulario');
  await page.click('#gis-falso');
  await page.waitForSelector('#form-wrap', { state: 'visible' });
  ok((await page.textContent('#who')).includes('comercial@agencia.test') && await page.inputValue('#agencia') === 'AgenciaSur', 'tras Google: quién capta y la agencia del enlace');

  await page.fill('#local', 'Bar El Drago');
  await page.click('#enviar');
  ok((await page.textContent('#err')).includes('dirección') && envios.length === 0, 'validación: sin dirección no se envía');
  await page.fill('#direccion', 'C/ Real 3, Adeje');
  await page.fill('#telefono', '622 000 000');
  await page.click('#chips label:has(#chip-otro)');
  await page.click('#enviar');
  ok((await page.textContent('#err')).includes('otro servicio'), 'validación: «Otro» pide cuál');
  await page.fill('#otro', 'Cartelería digital');
  await page.click('#chips label:has(input[value="TPV"])');
  await page.click('#enviar');
  await page.waitForSelector('#exito', { state: 'visible' });
  const e = envios[0];
  ok(e && e.cuerpo.credential === TOKEN && e.cuerpo.local === 'Bar El Drago' && e.cuerpo.productos.join() === 'TPV,Otro' && e.cuerpo.otro === 'Cartelería digital'
    && e.cuerpo.agencia === 'AgenciaSur' && e.cuerpo.web === '', 'envío: a captar-lead del hub con el token de Google y los datos');
  ok(!e.cabeceras.apikey && !e.cabeceras.authorization, 'envío: sin claves (la función va sin JWT)');
  ok(await page.evaluate(() => localStorage.getItem('captacion_agencia')) === 'AgenciaSur', 'la agencia se recuerda');
  await page.screenshot({ path: `${CAPTURAS}/captacion.png` });

  await page.click('#otro-cliente');
  await page.fill('#local', 'Otro local'); await page.fill('#direccion', 'C/ Mar 1'); await page.fill('#telefono', '922000000');
  await page.click('#chips label:has(input[value="Alarmas"])');
  respuesta = { status: 401, body: { error: 'Tu acceso ha caducado o no es válido.' } };
  await page.click('#enviar');
  await page.waitForSelector('#gate', { state: 'visible' });
  ok((await page.textContent('#gate-err')).includes('caducado'), '401: vuelve a la puerta de Google y lo dice');

  const html = await page.content();
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html) && !/ on(load|error|click)="/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'sin emojis ni manejadores en línea');
  await ctx.close();
  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
