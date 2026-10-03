// Parte de trabajo imprimible (generatePDF de trabajos.js de la app):
// #/trabajos/<n>/parte. El mismo contenido que el PDF de la app —empresa,
// fecha y duración, cliente y sede, tipo/estado/técnicos, descripción,
// materiales, productos con total e IGIC, observaciones, firma del cliente y
// fotos— pero como página: «Imprimir o guardar en PDF» (como las facturas y
// las firmas del hub), sin librería de PDF. Solo lee: vale con el área de la
// app. Los datos de la empresa salen de hub.config `facturacion_emisor`.
// Prefijo de ids: pa-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { esc } from '../../ui/dom';
import { eur } from '../ventas/datos';

const IGIC = 7; // el de getEmpresaConfig().igic de la app por defecto

const fecha = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

export async function pintarParte(el: HTMLElement, numero: string) {
  const { data: t } = await API.single<any>('trabajos', { select: '*', numero: `eq.${Number(numero) || 0}` });
  if (!t) { el.innerHTML = '<p class="aviso mal">No existe ese trabajo.</p><p><a href="#/trabajos">← Trabajos</a></p>'; return; }
  const [cli, loc, lin, fotos, emi] = await Promise.all([
    t.cliente_id ? API.single<any>('clientes', { select: 'nombre,nif,telefono,email,direccion', id: `eq.${t.cliente_id}` }) : Promise.resolve({ data: null }),
    t.local_id ? API.single<any>('locales', { select: 'nombre,direccion', id: `eq.${t.local_id}` }) : Promise.resolve({ data: null }),
    API.get<any[]>('documento_lineas', { select: 'nombre,cantidad,precio,descuento', trabajo_id: `eq.${t.id}`, order: 'orden' }),
    API.get<any[]>('trabajo_fotos', { select: 'id,descripcion,drive_url,archivo_path', trabajo_id: `eq.${t.id}`, order: 'created_at' }),
    API.single<{ valor: any }>('config', { select: 'valor', clave: 'eq.facturacion_emisor' }),
  ]);
  const e = emi.data?.valor ?? {};
  const empresa = e.nombre_comercial || e.nombre || 'Ok Computer Tenerife';
  const contacto = [e.telefono, e.email, [e.direccion, e.municipio].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const c = cli.data, l = loc.data;
  const lineas = (lin.data ?? []).map(x => ({ ...x, cantidad: Number(x.cantidad), precio: Number(x.precio), descuento: Number(x.descuento ?? 0) }));
  const sub = (x: { cantidad: number; precio: number; descuento: number }) => x.precio * x.cantidad * (1 - x.descuento / 100);
  const total = lineas.reduce((a, x) => a + sub(x), 0);
  let duracion = '';
  if (t.hora_llegada && t.hora_salida) {
    const m = Math.round((new Date(t.hora_salida).getTime() - new Date(t.hora_llegada).getTime()) / 60000);
    if (m > 0) duracion = `${m >= 60 ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min`;
  }
  const bloque = (titulo: string, texto: string | null) => (texto ? `<section class="pa-bloque"><h4>${titulo}</h4><p class="pa-texto">${esc(texto)}</p></section>` : '');
  const fs = fotos.data ?? [];
  el.innerHTML = `<p class="no-imprimir"><a href="#/trabajos/${t.numero}">← Trabajo #${t.numero}</a></p>
    <div class="acciones no-imprimir"><button class="btn" data-action="paImprimir">Imprimir o guardar en PDF</button></div>
    <article class="tarjeta tr-parte">
      <header class="pa-cab"><div><strong class="pa-empresa">${esc(empresa)}</strong>${contacto ? `<br><small>${esc(contacto)}</small>` : ''}</div>
        <div class="pa-num"><h2>Parte de trabajo</h2>#${t.numero}<br>Fecha: ${esc(fecha(t.fecha_programada || t.created_at))}${duracion ? `<br>Duración: ${esc(duracion)}` : ''}</div></header>
      <section class="pa-cliente"><h4>Cliente</h4><strong>${esc(c?.nombre ?? '—')}</strong>
        ${[c?.nif, c?.telefono, c?.email].some(Boolean) ? `<br>${esc([c?.nif, c?.telefono, c?.email].filter(Boolean).join(' · '))}` : ''}
        ${l ? `<br>Local: ${esc([l.nombre, l.direccion].filter(Boolean).join(' — '))}` : ''}</section>
      <p><strong>Tipo:</strong> ${esc(t.tipo ?? '—')} · <strong>Estado:</strong> ${esc(t.estado ?? '—')} · <strong>Técnicos:</strong> ${esc((t.tecnicos ?? []).join(', ') || '—')}</p>
      ${t.titulo ? `<h3>${esc(t.titulo)}</h3>` : ''}
      ${bloque('Descripción del trabajo', t.descripcion)}
      ${bloque('Materiales utilizados', t.materiales)}
      ${lineas.length ? `<section class="pa-bloque"><h4>Productos / servicios</h4><table class="tabla pa-lineas"><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>
        ${lineas.map(x => `<tr><td>${esc(x.nombre ?? '—')}</td><td>${x.cantidad}</td><td>${eur(x.precio, 2)}</td><td>${eur(sub(x), 2)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Total</th><th>${eur(total, 2)}</th></tr><tr><td colspan="4" class="nota">+ ${IGIC} % IGIC: ${eur(total * IGIC / 100, 2)} · Total con IGIC: ${eur(total * (1 + IGIC / 100), 2)}</td></tr></tfoot></table></section>` : ''}
      ${bloque('Observaciones', t.observaciones)}
      ${t.firma_cliente && /^data:image\/(png|jpeg);base64,/.test(t.firma_cliente) ? `<section class="pa-bloque"><h4>Firma del cliente</h4><img class="pa-firma" src="${esc(t.firma_cliente)}" alt="Firma del cliente"></section>` : ''}
      ${fs.length ? `<section class="pa-bloque"><h4>Fotos del trabajo</h4><div class="pa-fotos" id="pa-fotos">${fs.map(f => `<figure data-foto="${esc(f.id)}">${f.drive_url && /^https:\/\//.test(f.drive_url) ? `<a href="${esc(f.drive_url)}" target="_blank" rel="noopener">Ver en Drive</a>` : ''}<figcaption>${esc(f.descripcion ?? '')}</figcaption></figure>`).join('')}</div></section>` : ''}
      <footer class="pa-pie">${esc(empresa)}${e.email ? ` · ${esc(e.email)}` : ''}${e.telefono ? ` · ${esc(e.telefono)}` : ''}</footer>
    </article>`;
  // Las fotos subidas al hub (almacén privado) entran con un enlace de minutos.
  const privadas = fs.filter(f => f.archivo_path);
  if (privadas.length) {
    const { llamarFuncion } = await import('../../core/funciones');
    await Promise.all(privadas.map(async f => {
      const r = await llamarFuncion<{ url: string }>('trabajo-foto', { accion: 'url', id: f.id });
      const fig = el.querySelector<HTMLElement>(`figure[data-foto="${CSS.escape(f.id)}"]`);
      if (fig && r.data?.url && /^https:\/\//.test(r.data.url)) fig.insertAdjacentHTML('afterbegin', `<img src="${esc(r.data.url)}" alt="${esc(f.descripcion || 'Foto del trabajo')}">`);
    }));
  }
}

registrarAcciones({ paImprimir() { window.print(); } });
