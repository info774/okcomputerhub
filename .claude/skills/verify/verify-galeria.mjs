// Galería: una captura de CADA pantalla del menú (shell clásico, 1440 × 900) y,
// con GALERIA_NOCHE=1, también en tema noche; con GALERIA_MOVIL=1, en un móvil
// de 390 × 844. Sirve para repasar el aspecto de
// todo el programa de un vistazo y comprobar que ninguna pantalla revienta al
// pintarse con datos de prueba (PostgREST en memoria: nunca datos reales).
//
//   npm run build && node .claude/skills/verify/verify-galeria.mjs
//   (GALERIA=clientes,tickets para unas pocas; capturas en verify-capturas/galeria-*.png)
//
// Con GALERIA_FICHAS=1 recorre además las subpantallas (fichas, altas,
// pestañas) de `FICHAS`; con GALERIA_ESCRITORIO=1, el modo escritorio con cada
// pantalla abierta en su ventana.
//
// Comprueba: cada pantalla se pinta sin «ha fallado al cargar» ni errores JS,
// sin manejadores on*= inline y sin desbordar a lo ancho.
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4199;
const { ok, fallos, sumar } = contador();
const hoy = new Date();
const a = (h, m = 0, d = 0) => { const x = new Date(hoy); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
const dia = (d = 0) => a(12, 0, d).slice(0, 10);

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'matteo@ok.test', rol: 'tecnico', activo: true },
    { id: 'u-ana', nombre: 'Ana López', email: 'ana@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [{ clave: 'audit', ultima_ok: new Date(Date.now() - 4 * 60000).toISOString(), ultimo_error: null }],
  areas: [], config: [],
  clientes: [
    { id: 'c1', nombre: 'Polinesia Restaurante', nif: 'B38000001', telefono: '922000001', email: 'hola@polinesia.test', activo: true, estado: 'activo', zoho_id: 'z1', created_at: a(9, 0, -200) },
    { id: 'c2', nombre: 'Bananas Cafetería', nif: 'B38000002', telefono: '922000002', activo: true, estado: 'activo', zoho_id: 'z2', created_at: a(9, 0, -90) },
    { id: 'c3', nombre: 'Ferretería Las Chafiras', nif: 'B38000003', telefono: '922000003', activo: true, estado: 'potencial', created_at: a(9, 0, -10) },
  ],
  clientes_crm: [],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, tipo: 'Restaurante', direccion: 'Av. de Bruselas 3, Adeje', estado_pago: 'Al corriente', plan_mantenimiento: 'Silver', importe_mantenimiento: 84.53, lat: 28.09, lng: -16.74 },
    { id: 'l2', nombre: 'Bananas', cliente_id: 'c2', activo: true, tipo: 'Cafetería', direccion: 'C/ La Marina 12, Santa Cruz', estado_pago: 'Pendiente de pago', plan_mantenimiento: 'Bronze', importe_mantenimiento: 49, lat: 28.47, lng: -16.25 },
    { id: 'l3', nombre: 'Ferretería Las Chafiras', cliente_id: 'c3', activo: true, tipo: 'Comercio', direccion: 'Polígono Las Chafiras', estado_pago: 'No paga', plan_mantenimiento: 'Bronze', importe_mantenimiento: 41.73, lat: 28.05, lng: -16.61 },
  ],
  contactos: [
    { id: 'ct1', nombre: 'Lucía Pérez', telefono: '600000001', email: 'lucia@polinesia.test', cliente_id: 'c1', local_id: 'l1', tipo: 'Cliente', activo: true },
    { id: 'ct2', nombre: 'Jorge Díaz', telefono: '600000002', cliente_id: 'c2', local_id: 'l2', tipo: 'Cliente', activo: true },
  ],
  trabajos: [
    { id: 't1', numero: 331, titulo: 'Instalar TPV nuevo', descripcion: 'Cambio de TPV en barra', cliente_id: 'c2', local_id: 'l2', estado: 'Pendiente', tecnicos: ['Matteo'], fecha_programada: dia(0), prioridad: 'media', created_at: a(9, 0, -3) },
    { id: 't2', numero: 412, titulo: 'Impresora cocina', cliente_id: 'c1', local_id: 'l1', estado: 'En progreso', tecnicos: [], fecha_programada: dia(0), prioridad: 'alta', created_at: a(9, 0, -2) },
    { id: 't3', numero: 310, titulo: 'Revisión trimestral', cliente_id: 'c1', local_id: 'l1', estado: 'Completado', tecnicos: ['Ana'], fecha_programada: dia(-5), prioridad: 'baja', created_at: a(9, 0, -20) },
  ],
  agenda: [
    { id: 'a1', trabajo_id: 't1', inicio: a(9), fin: a(12), tecnicos: ['Matteo'], todo_el_dia: false },
    { id: 'a2', trabajo_id: 't2', inicio: a(13), fin: a(14), tecnicos: [], todo_el_dia: false },
    { id: 'a3', trabajo_id: null, titulo: 'Llamar Las Chafiras', inicio: a(10), fin: a(10, 30), tecnicos: ['Fran'], todo_el_dia: false },
  ],
  sesiones: [],
  tickets: [
    { id: 'k1', numero: 5012, titulo: 'Impresora cocina no saca', estado: 'Abierto', tecnico_id: null, prioridad: 'alta', cliente_id: 'c1', local_id: 'l1', created_at: a(8), sla_respuesta_at: a(18) },
    { id: 'k2', numero: 5013, titulo: 'Cajón portamonedas', estado: 'En curso', tecnico_id: 'Matteo', prioridad: 'media', cliente_id: 'c2', local_id: 'l2', created_at: a(8, 0, -1), sla_respuesta_at: a(18, 0, -1), primera_respuesta_at: a(9, 0, -1) },
    { id: 'k3', numero: 5009, titulo: 'Wifi lenta en sala', estado: 'Cerrado', tecnico_id: 'Ana', prioridad: 'baja', cliente_id: 'c1', local_id: 'l1', created_at: a(8, 0, -4), cerrado_at: a(12, 0, -2) },
  ],
  ticket_comentarios: [],
  tareas: [
    { id: 'ta1', titulo: 'Exportar tickets', estado: 'pendiente', tecnico_id: 'Matteo', fecha_vencimiento: dia(1) },
    { id: 'ta2', titulo: 'Pedir cartuchos', estado: 'en_progreso', tecnico_id: 'Ana', fecha_vencimiento: dia(0) },
  ],
  comanda_tareas: [
    { id: 'cm1', texto: 'Llevar router a Bananas', estado: 'pendiente', persona_id: 'u-mat', origen: 'voz', creada_por: 'u-fran', created_at: a(8) },
  ],
  oportunidades: [
    { id: 'o1', titulo: 'Cámaras para Polinesia', cliente_id: 'c1', estado: 'Detectado', valor_estimado: 1800, pipeline_id: 'pv', orden: 0, cerrada_at: null, tecnico_id: 'Matteo', origen: 'web', created_at: a(9, 0, -3), fecha_seguimiento: null },
    { id: 'o2', titulo: 'TPV segunda barra', cliente_id: 'c2', estado: 'Propuesta', valor_estimado: 950, pipeline_id: 'pv', orden: 0, cerrada_at: null, tecnico_id: null, origen: null, created_at: a(9, 0, -8), fecha_seguimiento: dia(2), siguiente_texto: 'Llamar para cerrar' },
    { id: 'o3', titulo: 'Wifi terraza', cliente_id: 'c3', estado: 'Negociando', valor_estimado: 600, pipeline_id: 'pv', orden: 0, cerrada_at: null, tecnico_id: 'Ana', origen: 'whatsapp', created_at: a(9, 0, -12), fecha_seguimiento: dia(-1) },
  ],
  pipelines: [{ id: 'pv', nombre: 'Ventas', por_defecto: true, orden: 0, activo: true,
    etapas: [['Detectado', 10, 'abierta'], ['Contactado', 25, 'abierta'], ['Propuesta', 50, 'abierta'], ['Negociando', 75, 'abierta'], ['Ganado', 100, 'ganada'], ['Perdido', 0, 'perdida']]
      .map(([n, p, t]) => ({ clave: n, nombre: n, probabilidad: p, tipo: t })) }],
  actividades: [],
  presupuestos: [
    { id: 'pr1', numero: 'P-141', cliente_id: 'c2', estado: 'Enviado', total: 3900, fecha: dia(-14), created_at: a(9, 0, -14) },
    { id: 'pr2', numero: 'P-142', cliente_id: 'c1', estado: 'Aceptado', total: 1200, fecha: dia(-30), created_at: a(9, 0, -30) },
  ],
  documento_lineas: [],
  cobros_recordatorios: [{ id: 'r1', estado: 'pendiente', saldo: 1240, cliente_id: 'c1', cliente_nombre: 'Polinesia Restaurante', numero: 'F26-0891', invoice_id: 'zi1', vence: dia(-21), nivel: 2, texto: 'Hola, os recordamos la factura F26-0891 pendiente.', created_at: a(7) }],
  rmm_equipos: [
    { id: 'e1', nombre: 'TPV-CAJA1', hostname: 'TPV-CAJA1', conectado: false, local_id: 'l3' },
    { id: 'e2', nombre: 'TPV-1', hostname: 'TPV-1', conectado: true, local_id: 'l2' },
    { id: 'e3', nombre: 'CAM-NVR', hostname: 'CAM-NVR', conectado: true, local_id: 'l1' },
  ],
  rmm_alertas: [{ id: 'al1', hostname: 'SRV-NAS', sitio: 'Ferretería', severidad: 'high', titulo: 'Disco al 91 %', estado: 'active', disparada: a(8) }],
  proyectos: [
    { id: 'p1', numero: 12, titulo: 'Migrar la wiki de Notion', estado: 'investigacion', prioridad: 'media', tipo: 'interno', orden: 0, created_at: a(7), updated_at: a(7) },
    { id: 'p2', numero: 11, titulo: 'Monitorización sobre Breeze', estado: 'en_marcha', prioridad: 'alta', tipo: 'interno', orden: 0, created_at: a(7), updated_at: a(7) },
  ],
  proyecto_objetivos: [], proyecto_hitos: [], proyecto_paginas: [], proyecto_tareas: [], proyecto_vinculos: [], claude_peticiones: [],
  auditoria: [], zoho_facturas: [], informes_programados: [], documentos: [], mcp_tokens: [],
  paginas: [
    { id: 'pg1', titulo: 'Cómo instalar un TPV', contenido: '## Pasos\n\n1. Desembalar\n2. Conectar', version: 1, archivada: false, orden: 0, padre_id: null, created_at: a(9, 0, -5), updated_at: a(9, 0, -1) },
  ],
  rmm_sitios: [], rmm_acciones: [], furgonetas: [], furgoneta_inventario: [], catalogo: [], lista_dia: [], tablero_notas: [],
};

const AVISOS = [
  { clave: 'f1', tipo: 'factura_vencida', gravedad: 'mal', titulo: 'Factura vencida: F26-0891', detalle: 'Polinesia · 21 días', importe: 1240, enlace: '#/cobros', fecha: a(9, 0, -21), persona: null, dinero: true },
  { clave: 't1', tipo: 'ticket_sin_asignar', gravedad: 'mal', titulo: 'Ticket sin asignar: #5012 Impresora cocina', detalle: 'Polinesia · prioridad alta', importe: null, enlace: '#/tickets/5012', fecha: a(8), persona: null, dinero: false },
  { clave: 'p1', tipo: 'presupuesto_sin_respuesta', gravedad: 'aviso', titulo: 'Presupuesto sin respuesta: P-141', detalle: 'Bananas · enviado hace 14 días', importe: 3900, enlace: '#/presupuestos', fecha: a(9, 0, -14), persona: 'Matteo', dinero: false },
];
// Lo que no esté aquí contesta null (cada pantalla sabe vivir sin su RPC).
const RPC = new Proxy({
  panorama_direccion: () => AVISOS,
  clases_clientes: () => [], linea_tiempo: () => [], mrp: () => [], jornada: () => [], buscar_fragmentos: () => [],
}, { get: (t, k) => t[k] ?? (() => null) });

// Subpantallas: fichas de los datos de arriba, altas y pestañas.
const FICHAS = [
  'clientes/c1', 'clientes/nuevo', 'clientes/c1/editar', 'sitios/l1', 'sitios/nuevo', 'contactos/ct1', 'contactos/nuevo',
  'oportunidades/o2', 'oportunidades/nueva', 'presupuestos/pr1', 'presupuestos/nuevo', 'presupuestos/plantillas',
  'trabajos/331', 'trabajos/nuevo', 'trabajos/331/editar', 'trabajos/331/parte', 'trabajos/plantillas',
  'tickets/5012', 'tickets/nuevo', 'tickets/whatsapp', 'tickets/bandeja', 'tickets/ajustes',
  'mantenimientos/locales', 'mantenimientos/documentos', 'mantenimientos/cobros', 'mantenimientos/plantillas',
  'mantenimientos/seguimiento', 'mantenimientos/checklist', 'mantenimientos/alta', 'mantenimientos/contrato/nuevo',
  'inventario/movimientos', 'inventario/nuevo', 'inventario/catalogo', 'inventario/albaran', 'inventario/importar', 'inventario/vehiculo',
  'almacen/pedidos', 'almacen/proveedores', 'almacen/compras', 'almacen/envios', 'almacen/facturas', 'almacen/facturas/nueva',
  'proyectos/12', 'wiki/pg1', 'wiki/nueva', 'wiki/conocimiento', 'personas/gastos', 'personas/ausencias', 'personas/cierre',
  'personas/gastos/gasto', 'calendario/cita', 'lista-dia/planificar', 'monitorizacion/equipos', 'monitorizacion/sedes',
  'monitorizacion/equipo/e2', 'monitorizacion/sede/l2', 'facturacion/ajustes', 'facturacion/trabajos', 'firmas/nueva',
];

const srv = await servidor(PUERTO);
const browser = await navegador();
const noche = process.env.GALERIA_NOCHE === '1';
const movil = process.env.GALERIA_MOVIL === '1';
const sufijo = `${movil ? '-movil' : ''}${noche ? '-noche' : ''}`;
const solo = process.env.GALERIA?.split(',').filter(Boolean);
const fichas = process.env.GALERIA_FICHAS === '1';
const escritorio = process.env.GALERIA_ESCRITORIO === '1';

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'es-ES', timezoneId: 'Atlantic/Canary', viewport: movil ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(movil ? { isMobile: true, hasTouch: true } : {}) });
  const base = baseMemoria(FIX, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base, ...(escritorio ? { escritorio: 'defecto' } : {}) });
  if (noche) await ctx.addInitScript(() => localStorage.setItem('hub_tema', 'oscuro'));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  await page.goto(srv.base);
  await page.waitForSelector('.menu-item', { state: 'attached' });
  const rutas = (fichas ? FICHAS : await page.$$eval('.menu .menu-item[href^="#/"]', as => as.map(a => a.getAttribute('href').slice(2))))
    .filter(r => !solo || solo.includes(r));
  const pre = `${escritorio ? 'os-' : ''}`;
  for (const r of rutas) {
    const antes = errores.length;
    await page.goto(`${srv.base}/#/${r}`);
    await page.waitForFunction(() => !document.querySelector('#pantalla .cargando, .os-win .cargando, .os-win.os-anima'), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(escritorio ? 500 : 250);
    const fallo = await page.evaluate(() => document.body.textContent.includes('ha fallado al cargar'));
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    // Restos de programación a la vista: una plantilla sin interpretar o un dato que no llegó.
    const resto = await page.evaluate(() => (document.body.innerText.match(/\$\{|\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]/) ?? [''])[0]);
    ok(!fallo && errores.length === antes && ancho <= 1 && !resto, `#/${r} se pinta${fallo ? ' (ha fallado al cargar)' : ''}${ancho > 1 ? ` (desborda ${ancho} px)` : ''}${resto ? ` (sale «${resto}»)` : ''}${errores.length > antes ? `: ${errores.slice(antes).join(' | ')}` : ''}`);
    await page.screenshot({ path: `${CAPTURAS}/galeria-${pre}${r.replaceAll('/', '_')}${sufijo}.png` });
  }
  ok(!(await page.evaluate(() => [...document.querySelectorAll('*')].some(e => [...e.attributes].some(at => /^on/.test(at.name))))), 'sin manejadores on*= inline');
  ok(base.reg.rest.every(x => x.perfil === 'hub' || x.metodo === 'OPTIONS'), 'todas las peticiones REST llevan Accept-Profile: hub');
  await ctx.close();
} catch (e) {
  console.error(e);
  sumar();
} finally {
  await browser.close();
  srv.parar();
}
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
