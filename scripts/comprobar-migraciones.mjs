#!/usr/bin/env node
// Ninguna migración del hub puede tocar lo de Breeze (CLAUDE.md, reglas 1 y 4):
// ni el esquema `public`, ni sus roles, ni la exposición de la API sobre él.
// Lo corre `npm run lint` y el workflow de lint; también «Aplicar migración»
// antes de ejecutar nada.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const PROHIBIDO = [
  [/\bpublic\s*\./i, 'nombra el esquema public (es de Breeze)'],
  [/\bschema\s+public\b/i, 'toca el esquema public'],
  [/\b(alter|drop|create)\s+role\b/i, 'crea o cambia roles (los de Breeze no se tocan)'],
  [/\bbreeze(_app|_search)?\b/i, 'menciona un rol de Breeze'],
  [/\bset\s+search_path\s*=\s*[^;\n]*\bpublic\b/i, 'pone public en el search_path'],
  [/\bpgrst\.db_schemas\b/i, 'cambia los esquemas expuestos por SQL (se hace en el panel, solo añadiendo hub)'],
];
const NOMBRE = /^\d{8}[a-z]?_[a-z0-9_]+\.sql$/;

// Los comentarios pueden hablar de public; el código no.
const sinComentarios = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

let fallos = 0;
for (const f of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
  if (!NOMBRE.test(f)) { console.error(`✗ ${f}: el nombre tiene que ser AAAAMMDD[letra]_descripcion.sql`); fallos++; }
  const sql = sinComentarios(readFileSync(join(DIR, f), 'utf8'));
  sql.split('\n').forEach((l, i) => {
    for (const [re, motivo] of PROHIBIDO) {
      if (re.test(l)) { console.error(`✗ ${f}:${i + 1} ${motivo}\n    ${l.trim()}`); fallos++; }
    }
  });
}
if (fallos) { console.error(`\n${fallos} problema(s). Todo lo del hub va en el esquema hub.`); process.exit(1); }
console.log('✓ Migraciones: ninguna toca public ni los roles de Breeze.');
