// Ficha de mantenimiento de una sede (modal «Ficha» de mant-ficha.js de la app):
// #/mantenimientos/ficha/<id>. Certificado digital, copia de seguridad, control
// horario de SUS empleados, teléfonos con rol y el código de verificación que
// pide el WhatsApp antes de mandar documentos (solo a dueño o administración).
// Escribe en `locales` y `local_telefonos` (área `clientes`). Prefijo de ids: fm-.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { telWhatsApp } from '../ventas/datos';
import { ROLES_TEL } from '../sitios/vista';
import { textoCodigo, ROLES_SENSIBLES, type Telefono } from './datos';
import { olvidarMantenimientos } from './vista';

const BACKUP: [string, string][] = [['', '—'], ['nube', 'Nube'], ['local', 'Local'], ['nas', 'NAS'], ['mixta', 'Mixta'], ['ninguna', 'Ninguna']];

let _local: { id: string; nombre: string } | null = null;
let _tels: (Partial<Telefono> & { numero: string })[] = [];
let _antes: string[] = [];

export async function pintarFicha(el: HTMLElement, id: string) {
  const [{ data: s }, ts, escribe] = await Promise.all([
    API.single<any>('locales', { select: 'id,nombre,cliente_id,plan,cert_caducidad,backup_tipo,backup_destino,backup_comprobado,control_horario,control_horario_sistema,control_horario_nuestro,codigo_verificacion', id: `eq.${id}` }),
    API.get<Telefono[]>('local_telefonos', { select: 'id,local_id,nombre,numero,rol', local_id: `eq.${id}`, order: 'created_at' }),
    esDelHub('locales', 'local_telefonos'),
  ]);
  if (!s) { el.innerHTML = '<p class="aviso mal">No existe esa sede.</p><p><a href="#/mantenimientos/locales">← Locales</a></p>'; return; }
  _local = { id: s.id, nombre: s.nombre };
  _tels = (ts.data ?? []).map(t => ({ ...t }));
  _antes = _tels.map(t => t.id!).filter(Boolean);
  const cli = s.cliente_id ? (await API.single<{ email: string | null }>('clientes', { select: 'email', id: `eq.${s.cliente_id}` })).data : null;
  const opt = (v: string, t: string, sel: boolean) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(t)}</option>`;
  const ch = s.control_horario == null ? '' : s.control_horario ? 'si' : 'no';
  const sens = _tels.find(t => ROLES_SENSIBLES.includes(t.rol ?? ''));
  const wa = telWhatsApp(sens?.numero);
  const txt = s.codigo_verificacion ? encodeURIComponent(textoCodigo(s.nombre, s.codigo_verificacion)) : '';
  el.innerHTML = `<p><a href="#/mantenimientos/locales">← Locales</a> · <a href="#/sitios/${esc(s.id)}">Ficha del sitio</a></p>
    <h2>Ficha de mantenimiento · ${esc(s.nombre)}</h2>
    ${escribe ? '' : avisoSoloLectura('La ficha de mantenimiento')}
    <form class="tarjeta" id="fm-form" data-on-submit="fmGuardar" data-prevent="1">
      <div class="in-campos">
        <label>Certificado digital: caduca el <input id="fm-cert" type="date" value="${esc(s.cert_caducidad ?? '')}"></label>
        <label>Copia de seguridad <select id="fm-backup-tipo">${BACKUP.map(([v, t]) => opt(v, t, v === (s.backup_tipo ?? ''))).join('')}</select></label>
        <label>Dónde <input id="fm-backup-destino" value="${esc(s.backup_destino ?? '')}" placeholder="Google Drive, NAS de la oficina…"></label>
        <label>Copia comprobada el <input id="fm-backup-comprobado" type="date" value="${esc(s.backup_comprobado ?? '')}"></label>
      </div>
      <div class="in-campos">
        <label>Control horario de sus empleados <select id="fm-ch">${opt('', '¿?', ch === '')}${opt('si', 'Sí', ch === 'si')}${opt('no', 'No', ch === 'no')}</select></label>
        <label>Con qué sistema <input id="fm-ch-sistema" value="${esc(s.control_horario_sistema ?? '')}"></label>
        <label class="check"><input type="checkbox" id="fm-ch-nuestro" ${s.control_horario_nuestro ? 'checked' : ''}> Se lo llevamos nosotros</label>
      </div>
      <fieldset class="fm-tels"><legend>Teléfonos y su rol</legend>
        <p class="nota">Solo a <strong>Dueño</strong> y <strong>Administración</strong> les manda el WhatsApp documentos, y antes les pide el código.</p>
        <div id="fm-tels">${filasTels()}</div>
        <button type="button" class="btn secundario" data-action="fmTelAnadir">+ Teléfono</button></fieldset>
      <section class="fm-codigo"><h3>Código de verificación</h3>
        <p><code id="fm-codigo">${esc(s.codigo_verificacion ?? '—')}</code>
        ${txt && wa ? `<a class="btn secundario" href="https://wa.me/${wa}?text=${txt}" target="_blank" rel="noopener">💬 Mandarlo por WhatsApp</a>` : ''}
        ${txt && cli?.email ? `<a class="btn secundario" href="mailto:${esc(cli.email)}?subject=${encodeURIComponent(`Código de verificación · ${s.nombre}`)}&body=${txt}">✉️ Por correo</a>` : ''}</p>
        <p class="nota">Sale impreso en el contrato. Lo pone la base al crear la sede y no se cambia aquí.</p></section>
      <div class="acciones"><button class="btn" type="submit" ${escribe ? '' : 'disabled'}>Guardar la ficha</button>
        <a class="btn secundario" href="#/mantenimientos/locales">Cancelar</a></div>
    </form>`;
}

function filasTels(): string {
  return _tels.map((t, i) => `<div class="in-campos fm-tel" data-tel="${i}">
    <label>Nombre <input value="${esc(t.nombre ?? '')}" data-on-change="fmTelCampo:${i},nombre,$value"></label>
    <label>Número <input type="tel" value="${esc(t.numero)}" data-on-change="fmTelCampo:${i},numero,$value"></label>
    <label>Rol <select data-on-change="fmTelCampo:${i},rol,$value">${ROLES_TEL.map(([k, n]) => `<option value="${k}" ${k === (t.rol ?? 'otro') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button type="button" class="btn secundario" data-action="fmTelQuitar" data-p0="${i}" aria-label="Quitar el teléfono">🗑</button></div>`).join('')
    || '<p class="nota">Sin teléfonos.</p>';
}

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';

registrarAcciones({
  fmTelCampo(i: string, k: 'nombre' | 'numero' | 'rol', v: string) { const t = _tels[Number(i)]; if (t) t[k] = v; },
  fmTelQuitar(i: string) { _tels.splice(Number(i), 1); const c = document.getElementById('fm-tels'); if (c) c.innerHTML = filasTels(); },
  fmTelAnadir() { _tels.push({ nombre: '', numero: '', rol: 'dueno' }); const c = document.getElementById('fm-tels'); if (c) c.innerHTML = filasTels(); },
  async fmGuardar() {
    if (!_local) return;
    // guardarFichaMant de la app: cada teléfono, con 9 cifras como poco.
    const malos = _tels.filter(t => t.numero.replace(/\D/g, '').length < 9);
    if (malos.length) { toast('Hay un teléfono con menos de 9 cifras', 'error'); return; }
    const ch = val('fm-ch');
    const r = await API.patch('locales', { id: `eq.${_local.id}` }, {
      cert_caducidad: val('fm-cert') || null, backup_tipo: val('fm-backup-tipo') || null, backup_destino: val('fm-backup-destino') || null,
      backup_comprobado: val('fm-backup-comprobado') || null, control_horario: ch === 'si' ? true : ch === 'no' ? false : null,
      control_horario_sistema: val('fm-ch-sistema') || null, control_horario_nuestro: (document.getElementById('fm-ch-nuestro') as HTMLInputElement).checked,
    });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    const quedan = new Set(_tels.map(t => t.id).filter(Boolean));
    const fuera = _antes.filter(id => !quedan.has(id));
    const errores: string[] = [];
    if (fuera.length) { const d = await API.delete('local_telefonos', { id: `in.(${fuera.join(',')})` }); if (d.error) errores.push(d.error.message); }
    for (const t of _tels) {
      const cuerpo = { nombre: t.nombre || null, numero: t.numero.trim(), rol: t.rol || 'otro' };
      const x = t.id ? await API.patch('local_telefonos', { id: `eq.${t.id}` }, cuerpo) : await API.post('local_telefonos', { ...cuerpo, local_id: _local.id });
      if (x.error) errores.push(x.error.message);
    }
    olvidarMantenimientos();
    if (errores.length) { toast(`La ficha se guardó, pero algún teléfono no: ${errores[0]}`, 'error'); return; }
    toast('Ficha guardada');
    ir('mantenimientos', 'locales');
  },
});
