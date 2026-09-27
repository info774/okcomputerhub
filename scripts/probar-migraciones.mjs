#!/usr/bin/env node
// Prueba las migraciones del hub en un Postgres LOCAL y desechable (initdb en
// un directorio temporal), nunca contra el proyecto real. Imita lo mínimo de
// Supabase (roles anon/authenticated/service_role, auth.jwt(), vault, y pg_cron
// / pg_net si no están instalados) más una tabla de «Breeze» en public, y
// comprueba:
//   · todas las migraciones se aplican en orden y DOS veces (idempotentes);
//   · public no cambia (lo de Breeze no se toca);
//   · anon no ve el esquema hub;
//   · RLS: quien no está en hub.usuarios no lee nada; un usuario lee; nadie
//     escribe en un área con dueño 'app'; al cortar el área, sí, y queda en
//     hub.auditoria con su email;
//   · lo que escribe el sync (cabecera x-hub-sync) no se audita.
//
//   npm run probar-migraciones      (necesita los binarios de PostgreSQL)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = (() => {
  for (const base of ['/usr/lib/postgresql']) {
    if (!existsSync(base)) continue;
    const v = readdirSync(base).sort((a, b) => Number(b) - Number(a))[0];
    if (v && existsSync(join(base, v, 'bin', 'initdb'))) return join(base, v, 'bin');
  }
  return '';
})();
const exe = n => (bin ? join(bin, n) : n);

const dir = mkdtempSync(join(tmpdir(), 'hub-pg-'));
const datos = join(dir, 'datos');
const PUERTO = String(55000 + Math.floor(Math.random() * 900));
// initdb/postgres no arrancan como root: si somos root, como el usuario postgres.
const comoPostgres = process.getuid?.() === 0;
const run = (cmd, args, opts = {}) => {
  const [c, a] = comoPostgres ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  return execFileSync(c, a, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
};
if (comoPostgres) execFileSync('chown', ['postgres', dir]);

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallos++; };

function psql(sql, { usuario = 'postgres', esperaError = false } = {}) {
  const r = spawnSync(comoPostgres ? 'runuser' : exe('psql'),
    [...(comoPostgres ? ['-u', 'postgres', '--', exe('psql')] : []),
      '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', PUERTO, '-U', usuario, '-d', 'postgres'],
    { input: sql, encoding: 'utf8' });
  if (!esperaError && r.status !== 0) throw new Error(r.stderr);
  return esperaError ? { ok: r.status === 0, err: r.stderr } : r.stdout.trim();
}

// Una consulta con la identidad de un usuario (como la pone PostgREST).
const como = (rol, email, sql, headers = {}) => `
begin;
set local role ${rol};
select set_config('request.jwt.claims', '${JSON.stringify({ role: rol, email })}', true);
select set_config('request.headers', '${JSON.stringify(headers)}', true);
${sql}
commit;`;

try {
  run(exe('initdb'), ['-D', datos, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  // stdio ignorado y log a fichero: si no, el postgres hijo hereda la tubería
  // y execFileSync se queda esperando a que se cierre.
  run(exe('pg_ctl'), ['-D', datos, '-l', join(dir, 'pg.log'), '-o', `-p ${PUERTO} -k ${dir} -c listen_addresses=''`, '-w', 'start'],
    { stdio: 'ignore' });

  const tieneExt = n => psql(`select count(*) from pg_available_extensions where name = '${n}'`) === '1';
  const cronReal = tieneExt('pg_cron') && false; // pg_cron exige shared_preload_libraries: siempre simulado
  const netReal = tieneExt('pg_net') && false;

  // ── Lo mínimo de Supabase ──────────────────────────────────────────────
  psql(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
    create schema extensions;
    create extension if not exists pgcrypto with schema extensions;
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    -- «Breeze»: una tabla en public que nada del hub puede tocar.
    create table public.devices (id int primary key, nombre text);
    insert into public.devices values (1, 'PC recepción');
  `);
  if (!cronReal) psql(`
    create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as
      $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
         on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
    create function cron.unschedule(id bigint) returns boolean language sql as
      $$ delete from cron.job where jobid = id returning true $$;
  `);
  if (!netReal) psql(`
    create schema net;
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
  `);

  const huellaPublic = () => psql(`select string_agg(c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, ''), ',' order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)
    + '|' + psql(`select nspacl::text from pg_namespace where nspname = 'public'`);
  const antes = huellaPublic();

  // ── Migraciones, dos veces ─────────────────────────────────────────────
  const ficheros = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  for (const vuelta of [1, 2]) {
    for (const f of ficheros) {
      let sql = readFileSync(join('supabase/migrations', f), 'utf8');
      if (!cronReal) sql = sql.replace(/create extension if not exists pg_cron;/gi, '-- (pg_cron simulado)');
      if (!netReal) sql = sql.replace(/create extension if not exists pg_net[^;]*;/gi, '-- (pg_net simulado)');
      const r = psql(`begin;\n${sql}\ncommit;`, { esperaError: true });
      ok(r.ok, `vuelta ${vuelta}: ${f}${r.ok ? '' : '\n' + r.err}`);
      if (!r.ok) throw new Error('migración rota');
    }
  }
  ok(huellaPublic() === antes, 'public (Breeze) queda igual');
  ok(psql(`select count(*) from cron.job where jobname like 'hub-%'`) === '2', 'dos tareas de pg_cron, sin duplicar');

  // ── Permisos y RLS ─────────────────────────────────────────────────────
  ok(!psql(como('anon', null, 'select count(*) from hub.clientes;'), { esperaError: true }).ok, 'anon no entra en hub');

  psql(`insert into hub.usuarios (nombre, email, rol) values ('Ana Admin', 'ana@ok.test', 'admin'), ('Tito', 'tito@ok.test', 'tecnico');
        insert into hub.clientes (nombre) values ('Bar Pepe');`);
  const leer = email => psql(como('authenticated', email, 'select count(*) from hub.clientes;')).split('\n').pop();
  ok(leer('extrano@ok.test') === '0', 'quien no está en hub.usuarios no lee nada');
  ok(leer('tito@ok.test') === '1', 'un usuario del hub lee el espejo');

  const escribir = email => psql(como('authenticated', email, `insert into hub.clientes (nombre) values ('Nuevo');`), { esperaError: true });
  ok(!escribir('ana@ok.test').ok, 'nadie escribe en un área con dueño app (ni un admin)');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.areas set dueno = 'hub' where area = 'clientes';`) +
    `\nselect 1/(select count(*) from hub.areas where dueno = 'hub');`, { esperaError: true }).ok,
    'un técnico no corta áreas');
  psql(como('authenticated', 'ana@ok.test', `update hub.areas set dueno = 'hub', cortada_at = now() where area = 'clientes';`));
  ok(escribir('tito@ok.test').ok, 'con el área cortada, un usuario escribe');
  ok(psql(`select usuario_email || ':' || accion from hub.auditoria where tabla = 'clientes' order by id desc limit 1`) === 'tito@ok.test:INSERT',
    'la escritura queda en hub.auditoria con su email');
  ok(psql(`select count(*) from hub.auditoria where tabla = 'areas' and usuario_email = 'ana@ok.test'`) === '1',
    'cortar un área también queda auditado');

  const n0 = psql('select count(*) from hub.auditoria');
  psql(como('service_role', null, `insert into hub.trabajos (descripcion) values ('del sync');`, { 'x-hub-sync': '1' }));
  ok(psql('select count(*) from hub.auditoria') === n0, 'lo que escribe sync-app no se audita');
  psql(`begin; set local hub.sin_auditoria = 'on'; insert into hub.tareas (titulo) values ('importada'); commit;`);
  ok(psql('select count(*) from hub.auditoria') === n0, 'lo que carga el importador no se audita');

  ok(psql(`select hub.lanzar_sync('incremental') is null`) === 't', 'sin secrets en el Vault, lanzar_sync no hace nada');
  psql(`insert into vault.decrypted_secrets values ('hub_sync_url', 'https://x/functions/v1/sync-app'), ('hub_sync_token', 't')`);
  ok(psql(`select hub.lanzar_sync('incremental')`) === '1', 'con secrets, lanzar_sync llama a net.http_post');

  // ── Importador: un dump falso de la app → hub ──────────────────────────
  // (con una columna que el hub no tiene, un array y un área ya cortada)
  psql(`create database app;`);
  const psqlApp = sql => spawnSync(comoPostgres ? 'runuser' : exe('psql'),
    [...(comoPostgres ? ['-u', 'postgres', '--', exe('psql')] : []), '-X', '-q', '-v', 'ON_ERROR_STOP=1',
      '-h', dir, '-p', PUERTO, '-U', 'postgres', '-d', 'app'], { input: sql, encoding: 'utf8' });
  let r = psqlApp(`
    create table public.clientes (id uuid primary key, created_at timestamptz, nombre text not null, columna_nueva text);
    insert into public.clientes values ('00000000-0000-0000-0000-000000000001', now(), 'Cliente del dump', 'x');
    create table public.trabajos (id uuid primary key, descripcion text, tecnicos text[], numero int, fecha_programada date);
    insert into public.trabajos values ('00000000-0000-0000-0000-0000000000a1', 'Cambiar TPV', '{Tito,"Ana María"}', 151, '2026-09-27'),
                                       ('00000000-0000-0000-0000-0000000000a2', E'Con\ttab y ''comillas''', null, 152, null);
    create table public.tareas (id uuid primary key, titulo text not null);
    insert into public.tareas values ('00000000-0000-0000-0000-0000000000b1', 'no debe entrar');`);
  ok(r.status === 0, 'dump falso de la app' + (r.status ? ': ' + r.stderr : ''));
  const dump = join(dir, 'backup_2026-09-27.dump');
  run(exe('pg_dump'), ['-h', dir, '-p', PUERTO, '-U', 'postgres', '-Fc', '--schema=public', '-f', dump, 'app']);
  psql(`update hub.areas set dueno = 'app' where area = 'clientes'; update hub.areas set dueno = 'hub' where area = 'tareas';`);
  const tareasAntes = psql('select count(*) from hub.tareas');
  const env = { ...process.env, PGHOST: dir, PGPORT: PUERTO, PGUSER: 'postgres', PGDATABASE: 'postgres', PATH: `${bin}:${process.env.PATH}` };
  const imp = comoPostgres
    ? spawnSync('runuser', ['-u', 'postgres', '--', 'env', `PATH=${env.PATH}`, `PGHOST=${dir}`, `PGPORT=${PUERTO}`,
        'PGUSER=postgres', 'PGDATABASE=postgres', process.execPath, 'scripts/importar-app.mjs', dump], { encoding: 'utf8' })
    : spawnSync(process.execPath, ['scripts/importar-app.mjs', dump], { encoding: 'utf8', env });
  ok(imp.status === 0, 'importar-app.mjs termina bien' + (imp.status ? ':\n' + imp.stdout + imp.stderr : ''));
  ok(psql(`select nombre from hub.clientes where id = '00000000-0000-0000-0000-000000000001'`) === 'Cliente del dump',
    'importa clientes (ignorando la columna que el hub no tiene)');
  ok(psql(`select tecnicos[2] || '|' || numero from hub.trabajos where numero = 151`) === 'Ana María|151', 'importa arrays y enteros');
  ok(psql(`select descripcion from hub.trabajos where numero = 152`) === "Con\ttab y 'comillas'", 'importa tabuladores y comillas');
  ok(psql(`select count(*) from hub.trabajos where descripcion = 'del sync'`) === '0', 'borra del espejo lo que ya no está en la app');
  ok(psql('select count(*) from hub.tareas') === tareasAntes, 'no toca un área cortada (tareas)');
  ok(psql(`select corte_ts = '2026-09-27T00:00:00Z' and corte_id is null from hub.sync_estado where clave = 'audit'`) === 't',
    'deja el corte del sync en la fecha del dump');
  ok(!psql(`select 1 from pg_namespace where nspname = 'app_import'`), 'no deja el esquema app_import');

  psql(`insert into vault.decrypted_secrets values ('app_service_role_key', 'clave-app'), ('otro_secreto', 'x')`);
  ok(psql(como('service_role', null, `select hub.secreto('app_service_role_key');`)).split('\n').pop() === 'clave-app',
    'hub.secreto: service_role lee un secreto de la lista');
  ok(psql(como('service_role', null, `select coalesce(hub.secreto('otro_secreto'), 'nada');`)).split('\n').pop() === 'nada',
    'hub.secreto: un nombre fuera de la lista no se devuelve');
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.secreto('app_service_role_key');`), { esperaError: true }).ok,
    'hub.secreto: un usuario no puede llamarla');

  // ── Proyectos (fase 1) ─────────────────────────────────────────────────
  const pid = psql(como('authenticated', 'tito@ok.test',
    `insert into hub.proyectos (titulo, tipo) values ('Web nueva', 'interno') returning id;`)).split('\n').find(l => /^[0-9a-f-]{36}$/.test(l));
  ok(!!pid, 'un usuario crea un proyecto');
  ok(!psql(como('authenticated', 'extrano@ok.test', `insert into hub.proyectos (titulo) values ('x');`), { esperaError: true }).ok,
    'quien no está en el hub no crea proyectos');
  psql(como('authenticated', 'tito@ok.test', `
    insert into hub.proyecto_objetivos (proyecto_id, texto) values ('${pid}', 'Vender más');
    insert into hub.proyecto_tareas (proyecto_id, titulo, estado) values ('${pid}', 'Maqueta', 'hecho');
    insert into hub.proyecto_vinculos (proyecto_id, tabla, registro_id) values ('${pid}', 'trabajos', gen_random_uuid());
    update hub.proyectos set estado = 'cerrado' where id = '${pid}';`));
  ok(psql(`select hecha_at is not null from hub.proyecto_tareas where proyecto_id = '${pid}'`) === 't', 'una tarea hecha apunta hecha_at');
  ok(psql(`select cerrado_at is not null and numero > 0 from hub.proyectos where id = '${pid}'`) === 't', 'cerrar apunta cerrado_at y el proyecto tiene número');
  ok(psql(`select count(*) from hub.auditoria where tabla like 'proyecto%' and usuario_email = 'tito@ok.test'`) >= '4', 'lo del proyecto queda auditado');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.proyectos where id = '${pid}';`));
  ok(psql(`select count(*) from hub.proyectos where id = '${pid}'`) === '1', 'un técnico no borra un proyecto');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.proyectos where id = '${pid}';`));
  ok(psql(`select (select count(*) from hub.proyectos where id = '${pid}') + (select count(*) from hub.proyecto_tareas where proyecto_id = '${pid}')`) === '0',
    'un admin lo borra y se lleva sus piezas');

  // ── Tokens del conector MCP ────────────────────────────────────────────
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.mcp_crear_token('x', 'lectura');`), { esperaError: true }).ok,
    'MCP: un técnico no crea tokens');
  const tok = psql(como('authenticated', 'ana@ok.test', `select hub.mcp_crear_token('Claude Code', 'escritura', null, 30);`))
    .split('\n').find(l => l.startsWith('okh_'));
  ok(/^okh_[0-9a-f]{48}$/.test(tok ?? ''), 'MCP: un admin crea un token y lo ve una vez');
  ok(psql(`select count(*) from hub.mcp_tokens where huella = encode(extensions.digest('${tok}', 'sha256'), 'hex')`) === '1'
    && psql(`select count(*) from hub.mcp_tokens where huella = '${tok}' or prefijo = '${tok}'`) === '0', 'MCP: se guarda la huella, no el token');
  ok(psql(como('service_role', null, `select email || ':' || alcance from hub.mcp_validar('${tok}');`)).split('\n').pop() === 'ana@ok.test:escritura',
    'MCP: validar devuelve dueño y alcance');
  ok(!psql(como('authenticated', 'ana@ok.test', `select * from hub.mcp_validar('${tok}');`), { esperaError: true }).ok,
    'MCP: un usuario no puede llamar a mcp_validar');
  ok(psql(como('service_role', null, `select count(*) from hub.mcp_validar('okh_falso');`)).split('\n').pop() === '0', 'MCP: un token falso no vale');
  psql(como('service_role', null, `insert into hub.proyectos (titulo) values ('desde mcp');`, { 'x-hub-usuario': 'ana@ok.test', 'x-hub-origen': 'mcp' }));
  ok(psql(`select usuario_email || ':' || origen from hub.auditoria where tabla = 'proyectos' order by id desc limit 1`) === 'ana@ok.test:mcp',
    'MCP: lo escrito por la función queda a nombre del dueño del token, origen mcp');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.proyectos (titulo) values ('suplantar');`, { 'x-hub-usuario': 'ana@ok.test' }));
  ok(psql(`select usuario_email from hub.auditoria where tabla = 'proyectos' order by id desc limit 1`) === 'tito@ok.test',
    'MCP: un navegador no puede suplantar a nadie con la cabecera');
  const tid = psql(`select id from hub.mcp_tokens limit 1`);
  psql(como('authenticated', 'ana@ok.test', `select hub.mcp_revocar_token('${tid}');`));
  ok(psql(como('service_role', null, `select count(*) from hub.mcp_validar('${tok}');`)).split('\n').pop() === '0', 'MCP: un token revocado deja de valer');

  // ── Peticiones a Claude ────────────────────────────────────────────────
  const pp = psql(como('authenticated', 'tito@ok.test', `insert into hub.proyectos (titulo) values ('Para Claude') returning id;`))
    .split('\n').find(l => /^[0-9a-f-]{36}$/.test(l));
  const titoId = psql(`select id from hub.usuarios where email = 'tito@ok.test'`);
  const pet = psql(como('authenticated', 'tito@ok.test',
    `insert into hub.claude_peticiones (proyecto_id, tipo, pedido_por) values ('${pp}', 'investigar', '${titoId}') returning id;`))
    .split('\n').find(l => /^[0-9a-f-]{36}$/.test(l));
  ok(!!pet, 'Claude: un usuario pide una investigación');
  ok(!psql(como('authenticated', 'tito@ok.test',
    `insert into hub.claude_peticiones (proyecto_id, tipo, pedido_por, estado) values ('${pp}', 'investigar', '${titoId}', 'hecha');`), { esperaError: true }).ok,
    'Claude: no se crea una petición ya «hecha»');
  ok(!psql(como('authenticated', 'tito@ok.test',
    `insert into hub.claude_peticiones (proyecto_id, tipo, pedido_por) values ('${pp}', 'investigar', gen_random_uuid());`), { esperaError: true }).ok,
    'Claude: no se pide en nombre de otro');
  psql(como('authenticated', 'tito@ok.test', `update hub.claude_peticiones set estado = 'hecha', resultado = 'trampa' where id = '${pet}';`), { esperaError: true });
  ok(psql(`select estado from hub.claude_peticiones where id = '${pet}'`) === 'pendiente', 'Claude: desde el navegador no se marca como hecha');
  psql(como('authenticated', 'tito@ok.test', `update hub.claude_peticiones set estado = 'cancelada' where id = '${pet}';`));
  ok(psql(`select estado from hub.claude_peticiones where id = '${pet}'`) === 'cancelada', 'Claude: quien la pidió la cancela');

  const sinRls = psql(`select string_agg(relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'hub' and c.relkind = 'r' and not c.relrowsecurity`);
  ok(!sinRls, `todas las tablas de hub con RLS${sinRls ? ' (faltan: ' + sinRls + ')' : ''}`);
} catch (e) {
  console.error('✗', e.message);
  fallos++;
} finally {
  try { run(exe('pg_ctl'), ['-D', datos, '-m', 'immediate', 'stop']); } catch { /* ya parado */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(fallos ? `\n${fallos} fallo(s)` : '\nMigraciones bien');
process.exit(fallos ? 1 : 0);
