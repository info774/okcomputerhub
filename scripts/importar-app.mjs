#!/usr/bin/env node
// Carga inicial del hub desde el backup nocturno de la app actual.
//
//   node scripts/importar-app.mjs backup_2026-09-27.dump [--desde=2026-09-27T00:00:00Z] [--seco]
//
// El .dump es el de okcomputerclaude → Actions «Backup diario completo»
// (pg_dump -Fc --schema=public; artefacto del run o carpeta de Drive).
// Conexión al hub por las variables PG* estándar (PGHOST, PGPORT, PGUSER,
// PGDATABASE, PGPASSWORD): ver docs/FASE0.md. NO toca la base de producción.
//
// Cómo:
//   1. pg_restore --data-only saca los COPY de las tablas de TABLAS_APP.
//   2. Se cargan en el esquema temporal `app_import`, todo como texto.
//   3. Se vuelcan a hub.<tabla> con las columnas comunes y su tipo del hub
//      (upsert por id + borrado de lo que ya no está), SOLO en las tablas cuya
//      área tenga dueño 'app': un área cortada es del hub y no se pisa.
//   4. Se borra `app_import` y se deja el corte de sync-app en --desde (por
//      defecto, la fecha del nombre del fichero a las 00:00 UTC): la primera
//      pasada incremental repasa desde ahí. Repetir cambios ya copiados es
//      inofensivo: sync-app pide el estado actual de cada fila.
// Todo en UNA transacción (ON_ERROR_STOP) y sin auditar (hub.sin_auditoria).
// --seco escribe el SQL en /tmp y no lo ejecuta.

import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const TABLAS = ['usuarios', 'clientes', 'locales', 'contactos', 'trabajos', 'agenda', 'sesiones',
  'documento_lineas', 'tareas', 'tickets', 'presupuestos', 'gastos'];

const args = process.argv.slice(2);
const dump = args.find(a => !a.startsWith('--'));
const seco = args.includes('--seco');
if (!dump) { console.error('Uso: node scripts/importar-app.mjs <backup.dump> [--desde=ISO] [--seco]'); process.exit(1); }
const fechaFichero = basename(dump).match(/(\d{4}-\d{2}-\d{2})/)?.[1];
const desde = args.find(a => a.startsWith('--desde='))?.slice(8) || (fechaFichero ? `${fechaFichero}T00:00:00Z` : null);
if (!desde || Number.isNaN(Date.parse(desde))) { console.error('No sé desde cuándo: pasa --desde=AAAA-MM-DDTHH:MM:SSZ'); process.exit(1); }

const q = s => `"${s.replace(/"/g, '""')}"`;
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

function psqlAt(sql) {
  return execFileSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
}

// 1. Datos del dump
console.log(`Leyendo ${dump}…`);
const restore = spawnSync('pg_restore', ['--data-only', '--schema=public', ...TABLAS.flatMap(t => ['-t', t]), '-f', '-', dump],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
if (restore.status !== 0) { console.error(restore.stderr); process.exit(1); }

const bloques = {};
{
  const lineas = restore.stdout.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^COPY public\.(\w+) \((.*)\) FROM stdin;$/);
    if (!m || !TABLAS.includes(m[1])) continue;
    const cols = m[2].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const datos = [];
    for (i++; i < lineas.length && lineas[i] !== '\\.'; i++) datos.push(lineas[i]);
    bloques[m[1]] = { cols, datos };
  }
}

// 2. Columnas y tipos del hub, y áreas con dueño 'app'
const tiposHub = {};
for (const l of psqlAt(`select c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'hub' and a.attnum > 0 and not a.attisdropped and c.relkind = 'r'`).trim().split('\n')) {
  const [t, col, tipo] = l.split('|');
  (tiposHub[t] ??= {})[col] = tipo;
}
const deLaApp = new Set(psqlAt(`select unnest(tablas) from hub.areas where dueno = 'app'`).trim().split('\n').filter(Boolean));

// 3. SQL
let sql = `\\set ON_ERROR_STOP on
begin;
set local hub.sin_auditoria = 'on';
drop schema if exists app_import cascade;
create schema app_import;
`;
const resumen = [];
for (const t of TABLAS) {
  const b = bloques[t];
  if (!b) { resumen.push(`${t}: no está en el dump`); continue; }
  if (!deLaApp.has(t)) { resumen.push(`${t}: área cortada (dueño hub), no se toca`); continue; }
  if (!tiposHub[t]) { resumen.push(`${t}: no existe hub.${t} (¿migración sin aplicar?)`); continue; }
  const comunes = b.cols.filter(c => tiposHub[t][c]);
  const sobran = b.cols.filter(c => !tiposHub[t][c]);
  sql += `create table app_import.${q(t)} (${b.cols.map(c => `${q(c)} text`).join(', ')});\n`;
  sql += `copy app_import.${q(t)} (${b.cols.map(q).join(', ')}) from stdin;\n${b.datos.join('\n')}${b.datos.length ? '\n' : ''}\\.\n`;
  sql += `insert into hub.${q(t)} (${comunes.map(q).join(', ')})
  select ${comunes.map(c => `${q(c)}::${tiposHub[t][c]}`).join(', ')} from app_import.${q(t)}
  on conflict (id) do update set ${comunes.filter(c => c !== 'id').map(c => `${q(c)} = excluded.${q(c)}`).join(', ')};\n`;
  sql += `delete from hub.${q(t)} h where not exists (select 1 from app_import.${q(t)} a where a.id::uuid = h.id);\n`;
  resumen.push(`${t}: ${b.datos.length} filas${sobran.length ? ` (columnas de la app que el hub no tiene: ${sobran.join(', ')})` : ''}`);
}
sql += `drop schema app_import cascade;
update hub.sync_estado set corte_id = null, corte_ts = ${lit(desde)}, ultimo_error = null where clave = 'audit';
commit;
`;

console.log(resumen.map(r => '  · ' + r).join('\n'));
const fichero = join(mkdtempSync(join(tmpdir(), 'hub-import-')), 'importar.sql');
writeFileSync(fichero, sql);
if (seco) { console.log(`--seco: SQL en ${fichero}`); process.exit(0); }

const r = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', fichero], { stdio: 'inherit' });
if (r.status !== 0) { console.error('❌ La carga falló; no se ha aplicado nada (una sola transacción).'); process.exit(r.status ?? 1); }
console.log(`✅ Carga inicial hecha. sync-app seguirá desde ${desde}.`);
