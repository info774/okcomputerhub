#!/usr/bin/env node
// Ninguna migración del hub puede tocar lo de Breeze (CLAUDE.md, reglas 1 y 4):
// ni el esquema `public`, ni sus roles, ni la exposición de la API sobre él.
// Lo corre `npm run lint` y el workflow de lint; también «Aplicar migración»
// antes de ejecutar nada.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const PROHIBIDO = [
  // Leer Breeze sí (regla 3: vistas hub.rmm_*): `from public.x` / `join public.x`.
  // Cualquier otra mención (crear, alterar, conceder, escribir) no.
  // Y usar la extensión `vector`, que vive en public (decisión de Fran, fase 5): su tipo y su operador.
  [/\bpublic\s*\./i, 'nombra el esquema public fuera de un FROM/JOIN de lectura (es de Breeze)',
    l => l.replace(/\b(from|join)\s+public\.\w+/gi, '').replace(/\bpublic\.vector\b/gi, '').replace(/operator\s*\(\s*public\.<=>\s*\)/gi, '')],
  [/\bdelete\s+from\s+public\s*\./i, 'borra en una tabla de Breeze'],
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
// También los cortes preparados (supabase/cortes/): se aplican a mano, pero las mismas reglas.
const CORTES = 'supabase/cortes';
const ficheros = [...readdirSync(DIR).filter(f => f.endsWith('.sql')).sort().map(f => [DIR, f]),
  ...(existsSync(CORTES) ? readdirSync(CORTES).filter(f => f.endsWith('.sql')).map(f => [CORTES, f]) : [])];
for (const [dir, f] of ficheros) {
  if (dir === DIR && !NOMBRE.test(f)) { console.error(`✗ ${f}: el nombre tiene que ser AAAAMMDD[letra]_descripcion.sql`); fallos++; }
  const sql = sinComentarios(readFileSync(join(dir, f), 'utf8'));
  sql.split('\n').forEach((l, i) => {
    for (const [re, motivo, prep] of PROHIBIDO) {
      if (re.test(prep ? prep(l) : l)) { console.error(`✗ ${f}:${i + 1} ${motivo}\n    ${l.trim()}`); fallos++; }
    }
  });
}
if (fallos) { console.error(`\n${fallos} problema(s). Todo lo del hub va en el esquema hub.`); process.exit(1); }
console.log('✓ Migraciones y cortes: ninguno toca public (solo lo leen) ni los roles de Breeze.');
