// Vista de «Fichas duplicadas» (ver index.ts). Prefijo de ids: du-.
import { API, type Fila } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esc, fecha, pl, toast } from '../../ui/dom';
import { esqueleto } from '../../ui/esqueleto';
import { ico } from '../../shell/linea';

type Tipo = 'cliente' | 'contacto' | 'sede';
interface Grupo { ids: string[]; motivos: string[] }
interface Vista {
  probar: boolean; queda: Fila; sale: Fila; campos: Record<string, [unknown, unknown]>;
  movidas: Record<string, number>; descartadas: Record<string, number>; bloqueos: string[]; avisos: string[];
  zoho: { queda: string; sale: string } | null;
}

const ZOHO_CONTACTO = 'https://books.zoho.eu/app/20107733530#/contacts/';

const TIPOS: Record<Tipo, { tabla: string; titulo: string; uno: string; otra: string; ruta: (id: string) => string; select: string }> = {
  cliente: { tabla: 'clientes', titulo: 'Clientes', uno: 'cliente', otra: 'otro cliente', ruta: id => `#/clientes/${id}`,
    select: 'id,nombre,nif,telefono,email,activo,zoho_id,plan,stripe_customer_id,created_at' },
  contacto: { tabla: 'contactos', titulo: 'Contactos', uno: 'contacto', otra: 'otro contacto', ruta: id => `#/contactos/${id}`,
    select: 'id,nombre,telefono,telefono2,email,tipo,empresa,cargo,activo,cliente_id,local_id,created_at' },
  sede: { tabla: 'locales', titulo: 'Sedes', uno: 'sede', otra: 'otra sede', ruta: id => `#/sitios/${id}`,
    select: 'id,nombre,direccion,cliente_id,activo,plan,stripe_subscription_id,zoho_subscription_id,created_at' },
};
const esTipo = (t: unknown): t is Tipo => t === 'cliente' || t === 'contacto' || t === 'sede';

const MOTIVO: Record<string, string> = { nif: 'Mismo NIF', correo: 'Mismo correo', 'teléfono': 'Mismo teléfono', nombre: 'Mismo nombre', 'dirección': 'Misma dirección' };

// Lo que cuelga de una ficha, con nombre para una persona (las demás tablas salen tal cual).
const TABLAS: Record<string, [string, string]> = {
  trabajos: ['trabajo', 'trabajos'], tickets: ['ticket', 'tickets'], tareas: ['tarea', 'tareas'], presupuestos: ['presupuesto', 'presupuestos'],
  locales: ['sede', 'sedes'], contactos: ['contacto', 'contactos'], oportunidades: ['oportunidad', 'oportunidades'],
  actividades: ['actividad', 'actividades'], contratos: ['contrato', 'contratos'], mant_facturas: ['cuota de mantenimiento', 'cuotas de mantenimiento'],
  mant_abonos: ['abono', 'abonos'], mant_seguimiento: ['seguimiento de mantenimiento', 'seguimientos de mantenimiento'],
  mantenimientos_programados: ['mantenimiento programado', 'mantenimientos programados'], facturas: ['factura', 'facturas'],
  firmas: ['firma', 'firmas'], envios: ['envío', 'envíos'], paginas: ['página de la wiki', 'páginas de la wiki'], proyectos: ['proyecto', 'proyectos'],
  portal_accesos: ['acceso al portal', 'accesos al portal'], comanda_tareas: ['tarea de comanda', 'tareas de comanda'],
  wa_conversaciones: ['conversación de WhatsApp', 'conversaciones de WhatsApp'], verifactu_sedes: ['ficha de VeriFactu', 'fichas de VeriFactu'],
  clientes_crm: ['ficha de CRM', 'fichas de CRM'], gastos: ['gasto', 'gastos'], local_telefonos: ['teléfono de la sede', 'teléfonos de la sede'],
  local_hardware: ['equipo (hardware)', 'equipos (hardware)'], local_software: ['programa (software)', 'programas (software)'],
  local_camaras: ['cámara', 'cámaras'], instalaciones: ['instalación', 'instalaciones'], equipos_control: ['equipo controlado', 'equipos controlados'],
  rmm_sitios: ['sitio de Breeze', 'sitios de Breeze'], rmm_despliegues: ['acceso remoto', 'accesos remotos'],
  sitio_tarea_seguimiento: ['revisión del plan', 'revisiones del plan'],
};
const cuantas = (t: string, n: number) => { const [u, v] = TABLAS[t] ?? [t, t]; return pl(n, u, v); };

const CAMPO: Record<string, string> = {
  nif: 'NIF', email: 'Correo', telefono: 'Teléfono', telefono2: 'Teléfono 2', direccion: 'Dirección', notas: 'Notas', activo: 'De alta',
  zoho_id: 'Zoho', cliente_id: 'Cliente', local_id: 'Sede', plan: 'Plan', etiquetas: 'Etiquetas', importe_mantenimiento: 'Cuota',
};
const nombreCampo = (k: string) => CAMPO[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_id$/, '').replace(/_/g, ' ');

function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '<i class="nota">vacío</i>';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.length ? esc(v.join(', ')) : '<i class="nota">vacío</i>';
  if (typeof v === 'object') return `<code>${esc(JSON.stringify(v).slice(0, 120))}</code>`;
  const s = String(v);
  return esc(s.length > 300 ? s.slice(0, 300) + '…' : s).replace(/\n/g, '<br>');
}

// Las filas por id, en tandas (una URL con 300 uuid no cabe).
async function traer(tabla: string, select: string, ids: string[]): Promise<Map<string, Fila>> {
  const m = new Map<string, Fila>();
  const unicos = [...new Set(ids.filter(Boolean))];
  const tandas: string[][] = [];
  for (let i = 0; i < unicos.length; i += 80) tandas.push(unicos.slice(i, i + 80));
  const res = await Promise.all(tandas.map(t => API.get<Fila[]>(tabla, { select, id: `in.(${t.join(',')})` })));
  for (const r of res) for (const f of r.data ?? []) m.set(f.id, f);
  return m;
}

// La más completa se queda por defecto: la que tiene Zoho o cobra, la de alta, más datos, la más antigua.
function puntos(f: Fila): number {
  let p = Object.values(f).filter(v => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).length;
  if (f.zoho_id) p += 5;
  if (f.stripe_customer_id || f.stripe_subscription_id) p += 10;
  if (f.activo !== false) p += 3;
  return p;
}
const masCompleta = (fs: Fila[]) => [...fs].sort((a, b) => puntos(b) - puntos(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];

const primera = (s: unknown) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0] ?? '';

function linea(tipo: Tipo, f: Fila, clientes: Map<string, Fila>): string {
  const cli = f.cliente_id ? clientes.get(f.cliente_id)?.nombre : null;
  const partes = tipo === 'cliente' ? [f.nif, f.telefono, f.email]
    : tipo === 'contacto' ? [cli, f.empresa, f.telefono, f.telefono2, f.email]
    : [cli, f.direccion];
  return partes.filter(Boolean).map(x => esc(x)).join(' · ');
}

function chips(tipo: Tipo, f: Fila): string {
  return [f.activo === false ? '<span class="chip mal">De baja</span>' : '',
    f.zoho_id ? '<span class="chip">Zoho</span>' : '',
    f.stripe_customer_id || f.stripe_subscription_id ? '<span class="chip">Stripe</span>' : '',
    tipo === 'sede' && f.plan && f.plan !== 'Sin mantenimiento' ? `<span class="chip">${esc(f.plan)}</span>` : '',
    tipo === 'contacto' && f.tipo === 'empleado' ? '<span class="chip">Empleado</span>' : ''].join(' ');
}

const pestanas = (tipo: Tipo, n: Record<string, number> | null) => `<nav class="segmentado du-pestanas" aria-label="Qué fichas">${(Object.keys(TIPOS) as Tipo[]).map(t =>
  `<a class="${t === tipo ? 'activo' : ''}" href="#/duplicados/${t}" ${t === tipo ? 'aria-current="page"' : ''}>${TIPOS[t].titulo}${n ? ` <span class="du-n">${n[t] ?? 0}</span>` : ''}</a>`).join('')}</nav>`;

// ── Lista ───────────────────────────────────────────────────────────────────
let _grupos: { tipo: Tipo; grupo: Grupo }[] = [];
let _vista: Vista | null = null;

async function pintarLista(el: HTMLElement, tipo: Tipo) {
  el.innerHTML = `${pestanas(tipo, null)}<div id="du-zoho"></div><div class="acciones pr-barra"><input id="du-buscar" type="search" placeholder="Buscar por nombre…" aria-label="Buscar" data-on-input="duBuscar"></div>
    <div id="du-lista">${esqueleto('lineas', 6)}</div>`;
  const cfg = TIPOS[tipo];
  const [gr, resumen, pendientes] = await Promise.all([
    API.rpc<Grupo[]>('duplicados', { p_tipo: tipo }),
    API.rpc<Record<string, number>>('duplicados_resumen'),
    API.get<Fila[]>('fusiones', { select: 'id,created_at,queda_id,queda_nombre,sale_nombre,zoho_queda,zoho_sale', zoho_sale: 'not.is.null', zoho_hecho_at: 'is.null', order: 'created_at.desc' }),
  ]);
  const lista = document.getElementById('du-lista');
  if (!lista) return;
  if (!resumen.error && resumen.data) el.querySelector('.du-pestanas')!.outerHTML = pestanas(tipo, resumen.data);
  const zoho = document.getElementById('du-zoho');
  if (zoho && pendientes.data?.length) zoho.innerHTML = `<section class="tarjeta"><h3>${ico('atencion')} Falta fusionar en Zoho Books</h3>
    <p class="nota">Estos clientes ya están juntos en el hub, pero cada uno tenía su contacto en Zoho. Zoho no deja fusionarlos desde fuera: se hace allí (abajo, «Cómo»).</p>
    <ul class="du-zoho">${pendientes.data.map(f => `<li>${pasoZoho(f.queda_nombre, f.zoho_queda, f.sale_nombre, f.zoho_sale)}
      <button class="btn secundario" data-action="duZohoHecho" data-p0="${esc(f.id)}">${ico('ok')} Hecho en Zoho</button></li>`).join('')}</ul>${comoZoho()}</section>`;
  if (gr.error) { lista.innerHTML = `<p class="aviso g-mal">No se pudieron buscar los duplicados: ${esc(gr.error.message)}</p>`; return; }
  const grupos = gr.data ?? [];
  if (!grupos.length) { lista.innerHTML = `<p class="vacio">No hay ${cfg.titulo.toLowerCase()} que parezcan duplicados.</p>`; return; }

  const fichas = await traer(cfg.tabla, cfg.select, grupos.flatMap(g => g.ids));
  const idsCli = tipo === 'cliente' ? [] : [...fichas.values()].map(f => f.cliente_id).filter(Boolean);
  const clientes = idsCli.length ? await traer('clientes', 'id,nombre', idsCli) : new Map<string, Fila>();
  if (!document.getElementById('du-lista')) return;

  // Primero los que comparten el nombre (un teléfono compartido por dos personas distintas es lo menos probable).
  const conFichas = grupos.map(g => ({ g, fs: g.ids.map(id => fichas.get(id)).filter((f): f is Fila => !!f) })).filter(x => x.fs.length > 1);
  const mismoNombre = (fs: Fila[]) => new Set(fs.map(f => primera(f.nombre))).size === 1;
  conFichas.sort((a, b) => Number(mismoNombre(b.fs)) - Number(mismoNombre(a.fs)));
  _grupos = conFichas.map(x => ({ tipo, grupo: x.g }));

  lista.innerHTML = `<p class="nota">${pl(conFichas.length, 'grupo', 'grupos')}. Marca la ficha que se queda y pulsa «Fusionar» en la que sobra: antes de hacer nada se ve qué va a pasar.</p>` +
    conFichas.map(({ g, fs }, i) => {
      const queda = masCompleta(fs).id;
      return `<article class="tarjeta du-grupo" id="du-g-${i}" data-texto="${esc(fs.map(f => String(f.nombre ?? '').toLowerCase()).join(' '))}">
        <div class="acciones">${g.motivos.map(m => `<span class="chip">${esc(MOTIVO[m] ?? m)}</span>`).join(' ')}
          <button class="btn secundario du-noson" data-action="duNoSon" data-p0="${i}">${ico('cerrar')} No son la misma</button></div>
        <table class="tabla du-fichas"><thead><tr><th>Se queda</th><th>${esc(cfg.titulo.slice(0, -1))}</th><th></th></tr></thead><tbody>${fs.map(f => `<tr>
          <td><input type="radio" name="du-q-${i}" value="${esc(f.id)}" aria-label="Se queda esta" ${f.id === queda ? 'checked' : ''}></td>
          <td><a href="${esc(cfg.ruta(f.id))}"><strong>${esc(f.nombre || 'Sin nombre')}</strong></a> ${chips(tipo, f)}<br><small class="nota">${linea(tipo, f, clientes) || '—'} · alta ${esc(fecha(f.created_at, true))}</small></td>
          <td><button class="btn secundario" data-action="duComparar" data-p0="${i}" data-p1="${esc(f.id)}">${ico('fusionar')} Fusionar en la marcada</button></td></tr>`).join('')}</tbody></table>
      </article>`;
    }).join('');
}

const pasoZoho = (qn: string, qz: string, sn: string, sz: string) =>
  `<a href="${ZOHO_CONTACTO}${esc(sz)}" target="_blank" rel="noopener">${esc(sn)} ${ico('externo')}</a> → dentro de <a href="${ZOHO_CONTACTO}${esc(qz)}" target="_blank" rel="noopener">${esc(qn)} ${ico('externo')}</a>`;
const comoZoho = () => `<details class="du-como"><summary>Cómo se hace en Zoho Books</summary><ol>
  <li>En Zoho Books, menú de la izquierda: <strong>Ventas → Clientes</strong>.</li>
  <li>Marca la casilla de los dos clientes (busca por el nombre).</li>
  <li>Arriba sale una barra de acciones: en <strong>«Más»</strong> (los tres puntos) elige <strong>«Fusionar»</strong> (en inglés, «Merge»).</li>
  <li>Como cliente principal elige <strong>el que se queda</strong> (el de la derecha de la flecha): sus facturas y presupuestos pasan a él y el otro queda inactivo.</li>
  <li>Vuelve aquí y pulsa «Hecho en Zoho».</li></ol>
  <p class="nota">Mientras tanto no pasa nada: el hub sabe que el contacto viejo de Zoho es este cliente y no lo vuelve a crear al traer de Zoho.</p></details>`;

// ── Comparar y fusionar ──────────────────────────────────────────────────────
async function pintarComparar(el: HTMLElement, tipo: Tipo, queda: string, sale: string) {
  const cfg = TIPOS[tipo];
  el.innerHTML = `<p><a href="#/duplicados/${tipo}">← ${cfg.titulo} duplicados</a></p><div id="du-cmp">${esqueleto('ficha')}</div>`;
  const { data, error } = await API.rpc<Vista>('fusionar', { p_tipo: tipo, p_queda: queda, p_sale: sale, p_probar: true });
  const caja = document.getElementById('du-cmp');
  if (!caja) return;
  _vista = data ?? null;
  if (error || !data) { caja.innerHTML = `<p class="aviso g-mal">No se puede comparar: ${esc(error?.message ?? 'sin respuesta')}</p>`; return; }
  const ids = [data.queda.cliente_id, data.sale.cliente_id].filter(Boolean) as string[];
  const clientes = ids.length && tipo !== 'cliente' ? await traer('clientes', 'id,nombre', ids) : new Map<string, Fila>();
  const mov = Object.entries(data.movidas), desc = Object.entries(data.descartadas), campos = Object.entries(data.campos);
  const bloqueado = data.bloqueos.length > 0;
  const tarjeta = (f: Fila, rotulo: string, clase: string) => `<section class="tarjeta du-lado ${clase}"><h3>${rotulo}</h3>
    <p><a href="${esc(cfg.ruta(f.id))}"><strong>${esc(f.nombre || 'Sin nombre')}</strong></a> ${chips(tipo, f)}</p>
    <p class="nota">${linea(tipo, f, clientes) || '—'}</p><p class="nota">Alta ${esc(fecha(f.created_at, true))}</p></section>`;
  caja.innerHTML = `<h2>${ico('fusionar')} Fusionar dos ${cfg.titulo.toLowerCase()}</h2>
    <div class="du-lados">${tarjeta(data.queda, 'Se queda', 'du-queda')}
      <a class="btn secundario du-cambiar" href="#/duplicados/${tipo}/${esc(sale)}/${esc(queda)}" title="Quedarse con la otra">${ico('repetir')} Al revés</a>
      ${tarjeta(data.sale, 'Desaparece', 'du-sale')}</div>
    ${data.bloqueos.length ? `<div class="aviso g-mal"><strong>Ahora no se puede fusionar:</strong><ul>${data.bloqueos.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      <p class="nota">Lo que se lleva en la app se podrá fusionar aquí cuando esa parte pase al hub. Mientras, se puede ver todo lo que pasaría.</p></div>` : ''}
    ${data.avisos.length ? `<div class="aviso"><ul>${data.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
    <section class="tarjeta"><h3>Pasa a «${esc(data.queda.nombre)}»</h3>
      ${mov.length ? `<ul>${mov.map(([t, n]) => `<li>${esc(cuantas(t, n))}</li>`).join('')}</ul>` : `<p class="nota">No cuelga nada de «${esc(data.sale.nombre)}».</p>`}
      ${desc.length ? `<p class="nota">Se descarta (la que se queda ya tiene la suya): ${desc.map(([t, n]) => esc(cuantas(t, n))).join(', ')}.</p>` : ''}</section>
    <section class="tarjeta"><h3>Así queda la ficha</h3>
      ${campos.length ? `<table class="tabla du-campos"><thead><tr><th>Campo</th><th>Ahora</th><th>Después</th></tr></thead><tbody>${campos.map(([k, [a, d]]) =>
        `<tr><td>${esc(nombreCampo(k))}</td><td>${valor(a)}</td><td>${valor(d)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="nota">No cambia nada: la que se queda ya tiene todos esos datos.</p>'}</section>
    <div class="acciones"><button class="btn peligro" data-action="duFusionar" data-p0="${tipo}" data-p1="${esc(queda)}" data-p2="${esc(sale)}" ${bloqueado ? 'disabled' : ''}>${ico('fusionar')} Fusionar y borrar «${esc(data.sale.nombre)}»</button>
      <a class="btn secundario" href="#/duplicados/${tipo}">Cancelar</a></div>`;
}

function pintarZohoPendiente(el: HTMLElement, tipo: Tipo, queda: Fila, sale: Fila, zoho: { queda: string; sale: string }) {
  el.innerHTML = `<p><a href="#/duplicados/${tipo}">← Clientes duplicados</a></p>
    <section class="tarjeta"><h2>${ico('hecho')} Fusionados en el hub</h2>
    <p>«${esc(sale.nombre)}» ya no existe: todo lo suyo está en <a href="${esc(TIPOS[tipo].ruta(queda.id))}">«${esc(queda.nombre)}»</a>.</p>
    <p class="aviso"><strong>Falta Zoho Books:</strong> cada uno tenía su contacto allí. ${pasoZoho(queda.nombre, zoho.queda, sale.nombre, zoho.sale)}</p>
    ${comoZoho()}<p class="nota">Queda apuntado en «Fichas duplicadas» hasta que se marque como hecho.</p>
    <div class="acciones"><a class="btn" href="${esc(TIPOS[tipo].ruta(queda.id))}">Ir a «${esc(queda.nombre)}»</a></div></section>`;
}

// ── Elegir con qué fusionar una ficha ───────────────────────────────────────
let _elegir: { tipo: Tipo; id: string } | null = null;

async function pintarElegir(el: HTMLElement, tipo: Tipo, id: string) {
  const cfg = TIPOS[tipo];
  const { data: f } = await API.single<Fila>(cfg.tabla, { select: cfg.select, id: `eq.${id}` });
  if (!f) { el.innerHTML = `<p class="aviso g-mal">No encuentro esa ficha.</p>`; return; }
  _elegir = { tipo, id };
  el.innerHTML = `<p><a href="${esc(cfg.ruta(id))}">← ${esc(f.nombre)}</a></p>
    <h2>${ico('fusionar')} Fusionar «${esc(f.nombre)}» con ${cfg.otra}</h2>
    <p class="nota">Busca la ficha repetida: «${esc(f.nombre)}» se queda y la que elijas desaparece (en la comparación se puede dar la vuelta).</p>
    <div class="acciones pr-barra"><input id="du-otra" type="search" placeholder="Nombre, NIF, teléfono…" aria-label="Buscar" data-on-input="duBuscarOtra" value="${esc(primera(f.nombre))}"></div>
    <div id="du-otras"></div>`;
  await buscarOtra();
}

async function buscarOtra() {
  const caja = document.getElementById('du-otras');
  const q = (document.getElementById('du-otra') as HTMLInputElement | null)?.value.trim() ?? '';
  if (!caja || !_elegir) return;
  const { tipo, id } = _elegir, cfg = TIPOS[tipo];
  if (q.length < 2) { caja.innerHTML = '<p class="nota">Escribe al menos dos letras.</p>'; return; }
  const pat = `*${q.replace(/[*,()]/g, ' ')}*`;
  const campos = tipo === 'cliente' ? ['nombre', 'nif', 'telefono', 'email'] : tipo === 'contacto' ? ['nombre', 'telefono', 'email'] : ['nombre', 'direccion'];
  const { data, error } = await API.get<Fila[]>(cfg.tabla, { select: cfg.select, or: `(${campos.map(c => `${c}.ilike.${pat}`).join(',')})`, id: `neq.${id}`, order: 'nombre', limit: '25' });
  if (document.getElementById('du-otra') && (document.getElementById('du-otra') as HTMLInputElement).value.trim() !== q) return;
  if (error) { caja.innerHTML = `<p class="aviso g-mal">${esc(error.message)}</p>`; return; }
  const clientes = tipo !== 'cliente' ? await traer('clientes', 'id,nombre', (data ?? []).map(f => f.cliente_id)) : new Map<string, Fila>();
  caja.innerHTML = data?.length ? `<table class="tabla"><tbody>${data.map(f => `<tr><td><a href="${esc(cfg.ruta(f.id))}"><strong>${esc(f.nombre || 'Sin nombre')}</strong></a> ${chips(tipo, f)}<br><small class="nota">${linea(tipo, f, clientes) || '—'}</small></td>
    <td><a class="btn secundario" href="#/duplicados/${tipo}/${esc(id)}/${esc(f.id)}">${ico('fusionar')} Comparar</a></td></tr>`).join('')}</tbody></table>`
    : '<p class="vacio">Nada con ese texto.</p>';
}

// ── Entrada ─────────────────────────────────────────────────────────────────
export async function pintarDuplicados(el: HTMLElement, params: string[]) {
  const tipo: Tipo = esTipo(params[0]) ? params[0] : 'cliente';
  if (params[1] && params[2]) return pintarComparar(el, tipo, params[1], params[2]);
  if (params[1]) return pintarElegir(el, tipo, params[1]);
  return pintarLista(el, tipo);
}

let _t = 0;
registrarAcciones({
  duBuscar() {
    const q = (document.getElementById('du-buscar') as HTMLInputElement | null)?.value.trim().toLowerCase() ?? '';
    document.querySelectorAll<HTMLElement>('.du-grupo').forEach(g => { g.hidden = !!q && !(g.dataset.texto ?? '').includes(q); });
  },
  duBuscarOtra() { clearTimeout(_t); _t = window.setTimeout(() => void buscarOtra(), 300); },
  duComparar(i: string, sale: string) {
    const g = _grupos[Number(i)];
    if (!g) return;
    const queda = (document.querySelector(`input[name="du-q-${i}"]:checked`) as HTMLInputElement | null)?.value;
    if (!queda || queda === sale) { toast('Esa es la que se queda: pulsa «Fusionar» en la que sobra (o marca otra como la que se queda).', 'error'); return; }
    ir('duplicados', g.tipo, queda, sale);
  },
  async duNoSon(i: string) {
    const g = _grupos[Number(i)];
    if (!g || !confirm('¿No son la misma ficha? El grupo deja de salir aquí.')) return;
    const ids = [...g.grupo.ids].sort();
    const pares: { tipo: Tipo; a: string; b: string }[] = [];
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) pares.push({ tipo: g.tipo, a: ids[x], b: ids[y] });
    const { data: ya } = await API.get<{ a: string; b: string }[]>('no_duplicados', { select: 'a,b', tipo: `eq.${g.tipo}`, a: `in.(${ids.join(',')})` });
    const marcados = new Set((ya ?? []).map(p => `${p.a}|${p.b}`));
    const nuevos = pares.filter(p => !marcados.has(`${p.a}|${p.b}`));
    const { error } = nuevos.length ? await API.post('no_duplicados', nuevos) : { error: null };
    if (error) { toast(`No se pudo apuntar: ${error.message}`, 'error'); return; }
    document.getElementById(`du-g-${i}`)?.remove();
    toast('Apuntado: no son la misma.');
  },
  async duFusionar(tipo: string, queda: string, sale: string) {
    if (!esTipo(tipo)) return;
    const cfg = TIPOS[tipo];
    const nombreSale = document.querySelector('.du-sale strong')?.textContent ?? `la otra ${cfg.uno}`;
    if (!confirm(`Todo lo de «${nombreSale}» pasa a la que se queda y «${nombreSale}» se BORRA. No se puede deshacer (queda copia en el registro). ¿Fusionar?`)) return;
    const { data, error } = await API.rpc<{ zoho: { queda: string; sale: string } | null; movidas: Record<string, number> }>('fusionar', { p_tipo: tipo, p_queda: queda, p_sale: sale, p_probar: false });
    if (error || !data) { toast(`No se pudo fusionar: ${error?.message ?? 'sin respuesta'}`, 'error'); return; }
    const n = Object.values(data.movidas ?? {}).reduce((s, x) => s + x, 0);
    toast(`Fusionados: ${pl(n, 'cosa pasó', 'cosas pasaron')} a la que se queda.`);
    const el = document.getElementById('du-cmp')?.parentElement;
    if (data.zoho && el && _vista?.queda.id === queda) pintarZohoPendiente(el, tipo, _vista.queda, _vista.sale, data.zoho);
    else location.hash = cfg.ruta(queda);
  },
  async duZohoHecho(id: string) {
    const { error } = await API.patch('fusiones', { id: `eq.${id}` }, { zoho_hecho_at: new Date().toISOString() });
    if (error) { toast(`No se pudo apuntar: ${error.message}`, 'error'); return; }
    document.querySelector(`[data-action="duZohoHecho"][data-p0="${CSS.escape(id)}"]`)?.closest('li')?.remove();
    if (!document.querySelector('.du-zoho li')) document.getElementById('du-zoho')?.replaceChildren();
    toast('Apuntado.');
  },
});
