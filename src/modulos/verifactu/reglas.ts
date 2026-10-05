// Reglas del tablero VeriFactu, copiadas de modules/verifactu.js de la app (si
// cambian allí, cambiarlas aquí): fases, carriles, casillas del proceso, el
// carril por la letra del NIF (la MISMA regla que el INSERT de arranque de su
// migración) y el criterio de salida de cada fase, que AVISA y no bloquea.

export interface SedeVf {
  id: string; local_id: string; cliente_id: string | null; fase: string; carril: string; tipo_contribuyente: string | null; camino: string | null;
  software_origen: string | null; software_destino: string | null; fecha_objetivo: string | null; tecnico: string | null;
  hw_tipo_tpv: string | null; hw_sistema: string | null; hw_almacenamiento: string | null; hw_ram: string | null; hw_estado: string | null;
  impresora_modelo: string | null; impresora_interfaz: string | null; impresora_qr_ok: boolean | null; checklist: Record<string, boolean> | null;
  presupuesto_aceptado: boolean; fecha_go_live: string | null; trabajo_id: string | null; notas: string | null; created_at: string; updated_at: string;
}

export const FASES: { key: string; nombre: string }[] = [
  { key: 'censo', nombre: '1. Censo' }, { key: 'auditoria', nombre: '2. Auditoría' }, { key: 'taller', nombre: '3. Taller / IGIC' },
  { key: 'despliegue', nombre: '4. Despliegue' }, { key: 'formacion', nombre: '5. Formación' }, { key: 'cierre', nombre: '6. Cierre' },
];

export const PLAZO_SOCIEDAD = '2027-01-01';
export const PLAZO_AUTONOMO = '2027-07-01';

export const CARRILES: Record<string, { nombre: string; desc: string; tono: string }> = {
  urgente: { nombre: 'Urgente', desc: 'Sociedades · plazo 1/1/2027', tono: 'mal' },
  estandar: { nombre: 'Estándar', desc: 'Autónomos · plazo 1/7/2027', tono: '' },
  compleja: { nombre: 'Compleja', desc: 'Legacy / hardware a renovar', tono: 'aviso' },
};

export const CHECKLIST: { key: string; label: string }[] = [
  { key: 'backup_previo', label: 'Backup previo realizado' },
  { key: 'sanitizacion_igic', label: 'Tipos de IGIC revisados (0 / 3 / 7 / 9,5 / 15 %)' },
  { key: 'sandbox_qr', label: 'Prueba en sandbox: hash encadenado y QR legible' },
  { key: 'despliegue_ok', label: 'Primer ticket real emitido y QR leído in situ' },
  { key: 'formacion', label: 'Formación impartida («un ticket no se borra»)' },
  { key: 'declaracion_responsable', label: 'Declaración responsable del fabricante entregada y firmada' },
  { key: 'monitoreo_7_dias', label: '7 días sin errores de encadenamiento (cierres Z)' },
];

const TPV_CONOCIDOS = /^\s*(glop|bdp|sysme|etpos)/i;

/** Letra inicial del NIF: persona jurídica → Sociedad; DNI/NIE → Autónomo. */
export function tipoPorNif(nif: string | null | undefined): 'Sociedad' | 'Autonomo' | null {
  const c = String(nif ?? '').trim().charAt(0).toUpperCase();
  if (/^[ABCDEFGHJNPQRSUVW]$/.test(c)) return 'Sociedad';
  if (/^[0-9XYZKLM]$/.test(c)) return 'Autonomo';
  return null;
}
export function carrilPara(tipo: string | null, tpv: string | null | undefined): string {
  if (tpv && !TPV_CONOCIDOS.test(tpv)) return 'compleja';
  return tipo === 'Sociedad' ? 'urgente' : 'estandar';
}
export function plazoDe(v: Pick<SedeVf, 'fecha_objetivo' | 'tipo_contribuyente' | 'carril'>): string {
  if (v.fecha_objetivo) return v.fecha_objetivo;
  return v.tipo_contribuyente === 'Sociedad' || v.carril === 'urgente' ? PLAZO_SOCIEDAD : PLAZO_AUTONOMO;
}
export function diasHasta(fecha: string, hoy = new Date().toLocaleDateString('sv-SE')): number {
  return Math.ceil((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}
const etiqueta = (k: string) => CHECKLIST.find(c => c.key === k)?.label ?? k;

/** Qué le falta a una sede para salir de su fase (criterio de salida). */
export function dodPendiente(v: SedeVf): string[] {
  const ck = v.checklist ?? {};
  const faltan = (ks: string[]) => ks.filter(k => !ck[k]).map(etiqueta);
  switch (v.fase) {
    case 'censo': return [!v.tipo_contribuyente && 'tipo de contribuyente', !v.software_origen && 'software actual', !v.fecha_objetivo && 'fecha objetivo'].filter(Boolean) as string[];
    case 'auditoria': return [!v.hw_estado && 'estado del hardware', v.impresora_qr_ok == null && 'impresora probada con QR', !v.presupuesto_aceptado && 'presupuesto aceptado'].filter(Boolean) as string[];
    case 'taller': return faltan(['backup_previo', 'sanitizacion_igic', 'sandbox_qr']);
    case 'despliegue': return faltan(['despliegue_ok']);
    case 'formacion': return faltan(['formacion', 'declaracion_responsable']);
    case 'cierre': return faltan(['monitoreo_7_dias']);
  }
  return [];
}
export const hechas = (v: SedeVf) => CHECKLIST.filter(c => v.checklist?.[c.key]).length;
export const indiceFase = (k: string) => FASES.findIndex(f => f.key === k);
