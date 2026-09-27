// Arnés de Proyectos (fase 1): build real en Chromium con un PostgREST en
// memoria (comun.mjs), nunca contra datos reales.
//   npm run build && node .claude/skills/verify/verify-proyectos.mjs
// Cubre: baldosa con contador; apuntar una idea; kanban por fase y arrastrar
// entre columnas (PATCH estado); ficha: guardar Idea, pasar de fase,
// objetivos, página con fuentes y markdown SEGURO (nada de HTML), hitos con
// Gantt, tareas y arrastrarlas, vínculo a un trabajo del espejo, Coste; vista
// «Tareas por persona»; que un técnico no ve «Borrar proyecto»; móvil sin
// scroll horizontal.
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4179);
const U_ADMIN = { id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true };
const U_TEC = { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true };
const INICIAL = {
  usuarios: [U_ADMIN, U_TEC],
  areas: [], sync_estado: [],
  proyectos: [{ id: 'p1', numero: 7, titulo: 'Copias en la nube', tipo: 'interno', estado: 'definicion', prioridad: 'alta',
    responsable_id: 'u-tito', orden: 1, created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', descripcion: 'Idea base' }],
  proyecto_objetivos: [], proyecto_hitos: [], proyecto_paginas: [], proyecto_vinculos: [],
  claude_peticiones: [{ id: 'c1', proyecto_id: 'p1', created_at: '2026-09-25T09:00:00Z', tipo: 'investigar', fase: 'definicion',
    instrucciones: null, estado: 'hecha', pedido_por: 'u-tito', terminada_at: '2026-09-25T10:00:00Z',
    resultado: '### Hecho\n- 2 páginas con **fuentes**\n<img src=x onerror=alert(1)>', error: null }],
  proyecto_tareas: [{ id: 't0', proyecto_id: 'p1', titulo: 'Llamar a 5 clientes', estado: 'pendiente', responsable_id: 'u-tito',
    fecha_limite: '2020-01-01', orden: 1 }],
  trabajos: [{ id: 'tr1', numero: 151, titulo: 'Instalar NAS', descripcion: 'NAS en Bar Pepe', estado: 'Completado' }],
  sesiones: [{ id: 's1', entidad_tipo: 'trabajo', entidad_id: 'tr1', inicio: '2026-09-21T08:00:00Z', fin: '2026-09-21T10:30:00Z', duracion_min: 150 }],
  documento_lineas: [{ id: 'l1', trabajo_id: 'tr1', subtotal: 240 }],
  clientes: [], tickets: [], tareas: [], presupuestos: [], gastos: [], agenda: [], locales: [],
};

const browser = await navegador();
try {
  // ── Admin: flujo completo ──────────────────────────────────────────────
  const base = baseMemoria(INICIAL);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1360, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());

  await page.goto(srv.base);
  await page.waitForFunction(() => document.querySelector('#bal-proyectos .baldosa-valor')?.textContent === '1');
  ok(await page.getAttribute('#bal-proyectos', 'data-tono') === 'aviso', 'baldosa Proyectos: 1 abierto y aviso por tarea vencida');

  await page.goto(`${srv.base}/#/proyectos`);
  await page.waitForSelector('.pr-kanban');
  ok(await page.locator('.pr-columna').count() === 5, 'kanban con 5 fases (cerrados ocultos)');
  await page.fill('#pri-titulo', 'Portal de clientes <script>alert(1)</script>');
  await page.press('#pri-titulo', 'Enter');
  await page.waitForSelector('.pr-columna[data-fase="idea"] .pr-tarjeta');
  const nueva = base.db.proyectos.find(p => p.titulo.startsWith('Portal'));
  ok(nueva?.estado === 'idea' && nueva.responsable_id === 'u-ana', 'apuntar idea: POST con estado idea y responsable yo');
  ok(!(await page.innerHTML('.pr-kanban')).includes('<script>'), 'el título se escapa en la tarjeta');

  await page.dragAndDrop(`.pr-tarjeta[data-id="${nueva.id}"]`, '.pr-columna[data-fase="investigacion"]');
  await page.waitForSelector(`.pr-columna[data-fase="investigacion"] .pr-tarjeta[data-id="${nueva.id}"]`);
  ok(base.db.proyectos.find(p => p.id === nueva.id).estado === 'investigacion', 'arrastrar a otra fase guarda el estado');
  await page.screenshot({ path: `${CAPTURAS}/proyectos-kanban.png`, fullPage: true });

  // Ficha
  await page.click('.pr-tarjeta[data-id="p1"]');
  await page.waitForSelector('#pf-titulo');
  ok((await page.textContent('#pantalla-titulo')).includes('#7 Copias en la nube'), 'la ficha abre por número');
  await page.fill('#pf-descripcion', '## Por qué\n- **Menos** caídas\n<img src=x onerror=alert(1)>');
  await page.fill('#pf-presupuesto', '1000');
  await page.click('[data-action="pfGuardar"]');
  await page.waitForFunction(() => document.querySelector('.md h4')?.textContent === 'Por qué');
  ok(base.db.proyectos.find(p => p.id === 'p1').presupuesto === 1000, 'Guardar la idea escribe el presupuesto');
  ok(!(await page.innerHTML('.md')).includes('<img'), 'el markdown no deja pasar HTML');
  await page.click('[data-action="pfAvanzar"]');
  await page.waitForFunction(() => document.getElementById('pf-fase')?.textContent === 'Investigación');
  ok(base.db.proyectos.find(p => p.id === 'p1').estado === 'investigacion', '«Pasar a …» avanza la fase');

  // Objetivos
  await page.click('.pf-pestana[data-p1="objetivos"]');
  await page.fill('#pfo-texto', '20 clientes con copia');
  await page.fill('#pfo-metrica', 'contratos firmados');
  await page.click('form[data-on-submit="pfNuevoObjetivo"] button');
  await page.waitForSelector('.pr-objetivos input[type=checkbox]');
  await page.check('.pr-objetivos input[type=checkbox]');
  await page.waitForFunction(() => document.querySelector('.pr-objetivos .tachado'));
  ok(base.db.proyecto_objetivos[0]?.hecho === true, 'objetivo añadido y marcado hecho');

  // Investigación
  await page.click('.pf-pestana[data-p1="investigacion"]');
  await page.click('[data-action="pfAbrirPagina"][data-p0="nueva"]');
  await page.fill('#pp-titulo', 'Proveedores de backup');
  await page.fill('#pp-contenido', '- Backblaze: barato\n- Wasabi: sin salida');
  await page.fill('#pp-fuentes', 'Precios Backblaze | https://www.backblaze.com/cloud-storage/pricing\njavascript:alert(1)');
  await page.click('[data-action="pfGuardarPagina"]');
  await page.waitForSelector('.pr-pagina');
  const pg = base.db.proyecto_paginas[0];
  ok(pg?.fuentes?.length === 1 && pg.autor === 'persona', 'página guardada con su fuente (la URL no http se descarta)');
  ok(await page.locator('.pr-pagina .fuentes a').getAttribute('href') === 'https://www.backblaze.com/cloud-storage/pricing', 'la fuente sale enlazada');

  // Roadmap
  await page.click('.pf-pestana[data-p1="roadmap"]');
  await page.fill('#ph-nombre', 'Piloto');
  await page.fill('#ph-inicio', '2026-10-01');
  await page.fill('#ph-objetivo', '2026-10-31');
  await page.click('form[data-on-submit="pfNuevoHito"] button');
  await page.waitForSelector('.gantt-barra');
  ok(base.db.proyecto_hitos.length === 1, 'hito añadido y pintado en el Gantt');

  // Tareas
  await page.click('.pf-pestana[data-p1="tareas"]');
  await page.fill('#pt-titulo', 'Montar demo');
  await page.selectOption('#pt-hito', { label: 'Piloto' });
  await page.click('form[data-on-submit="pfNuevaTarea"] button');
  await page.waitForFunction(() => [...document.querySelectorAll('.pr-tarjeta h4')].some(h => h.textContent === 'Montar demo'));
  const t = base.db.proyecto_tareas.find(x => x.titulo === 'Montar demo');
  ok(t?.hito_id === base.db.proyecto_hitos[0].id && t.responsable_id === 'u-ana', 'tarea con hito y responsable');
  await page.dragAndDrop(`.pr-tarjeta[data-id="${t.id}"]`, '.pr-columna[data-on-drop="pfTareaSoltar:hecho"]');
  await page.waitForFunction(id => document.querySelector(`.pr-columna[data-on-drop="pfTareaSoltar:hecho"] .pr-tarjeta[data-id="${id}"]`), t.id);
  ok(base.db.proyecto_tareas.find(x => x.id === t.id).estado === 'hecho', 'arrastrar la tarea a Hecho');
  await page.click('.pr-tarjeta[data-id="t0"] [data-action="pfTareaEstado"]');
  await page.waitForTimeout(300);
  ok(base.db.proyecto_tareas.find(x => x.id === 't0').estado === 'en_curso', 'botón ▶ mueve la tarea a En curso');

  // Vinculado + Coste
  await page.click('.pf-pestana[data-p1="vinculado"]');
  await page.fill('#pv-q', '151');
  await page.click('form[data-on-submit="pfBuscarVinculo"] button');
  await page.click('[data-action="pfEnlazar"]');
  await page.waitForFunction(() => document.querySelector('.pr-vinculos')?.textContent.includes('Instalar NAS'));
  ok(base.db.proyecto_vinculos[0]?.registro_id === 'tr1', 'enlazar el trabajo #151 del espejo');
  ok(!base.reg.escrituras.some(e => ['trabajos', 'tareas', 'tickets', 'clientes'].includes(e.tabla)), 'no se escribe NADA en tablas espejo');
  await page.click('.pf-pestana[data-p1="coste"]');
  await page.waitForSelector('.baldosa');
  const coste = await page.textContent('#pf-cuerpo');
  ok(coste.includes('2.5 h') && coste.includes('240') && coste.includes('usado 24%'), 'Coste: horas fichadas, material y % del previsto');
  await page.screenshot({ path: `${CAPTURAS}/proyectos-coste.png`, fullPage: true });

  // Claude: pedir, ver resultado, cancelar
  await page.click('.pf-pestana[data-p1="investigacion"]');
  await page.click('[data-action="pfPedirClaude"][data-p0="investigar"]');
  await page.waitForSelector('#pc-instrucciones');
  ok((await page.textContent('.pf-pestana.activo')) === 'Claude', '«Investigar con Claude» lleva a la pestaña Claude con el formulario');
  ok(!(await page.innerHTML('#pf-cuerpo')).includes('<img') && await page.isVisible('text=2 páginas con'), 'el resultado de Claude se pinta en markdown seguro');
  await page.fill('#pc-instrucciones', 'Compara 3 proveedores');
  await page.click('[data-action="pfEnviarClaude"]');
  await page.waitForSelector('text=Pendiente');
  const pet = base.db.claude_peticiones.find(x => x.id !== 'c1');
  ok(pet?.tipo === 'investigar' && pet.fase === 'investigacion' && pet.pedido_por === 'u-ana' && pet.instrucciones === 'Compara 3 proveedores',
    'la petición se guarda con tipo, fase, quién la pide e instrucciones');
  await page.click(`[data-action="pfCancelarPeticion"][data-p0="${pet.id}"]`);
  await page.waitForSelector('text=Cancelada');
  ok(base.db.claude_peticiones.find(x => x.id === pet.id).estado === 'cancelada', 'una pendiente se puede cancelar');
  await page.screenshot({ path: `${CAPTURAS}/proyectos-claude.png`, fullPage: true });

  // Tareas por persona
  await page.goto(`${srv.base}/#/proyectos`);
  await page.click('[data-action="proyectosVista"][data-p0="personas"]');
  await page.waitForSelector('.pr-personas');
  ok((await page.textContent('.pr-personas')).includes('Tito'), 'tablero de tareas por persona');
  ok(await page.isVisible('text=Borrar proyecto') === false, '(en la lista no hay botón de borrar)');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Técnico: no puede borrar un proyecto; móvil ────────────────────────
  const base2 = baseMemoria(INICIAL);
  const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await preparar(ctx2, { email: 'tito@ok.test', base: base2 });
  const p2 = await ctx2.newPage();
  await p2.goto(`${srv.base}/#/proyectos/7`);
  await p2.waitForSelector('#pf-titulo');
  ok(await p2.locator('[data-action="pfBorrarProyecto"]').count() === 0, 'un técnico no ve «Borrar proyecto»');
  const ancho = await p2.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok(ancho[0] <= ancho[1], `móvil sin scroll horizontal en la ficha (${ancho[0]} ≤ ${ancho[1]})`);
  await p2.screenshot({ path: `${CAPTURAS}/proyectos-movil.png`, fullPage: true });
  await ctx2.close();
} catch (e) {
  console.error('✗ excepción:', e);
  sumar();
} finally {
  await browser.close();
  srv.parar();
}
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
