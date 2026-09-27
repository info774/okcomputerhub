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
    create table vault.decrypted_secrets (name text, decrypted_secret text, id uuid default gen_random_uuid());
    create function vault.create_secret(v text, n text) returns uuid language sql as
      $$ insert into vault.decrypted_secrets (name, decrypted_secret) values (n, v) returning id $$;
    create function vault.update_secret(i uuid, v text) returns void language sql as
      $$ update vault.decrypted_secrets set decrypted_secret = v where id = i $$;
  `);
  // «Breeze»: sus tablas en public (las que leen las vistas hub.rmm_*), que
  // nada del hub puede tocar.
  psql(readFileSync('scripts/breeze-falso.sql', 'utf8'));
  // Breeze instaló `vector` en public; el hub solo usa su tipo (fase 5).
  psql('create extension if not exists vector with schema public;');
  // Como en el proyecto real: public cerrado a los roles de la API (tampoco service_role).
  psql('revoke all on schema public from public; revoke all on schema public from anon, authenticated, service_role;');
  psql(`
    insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000000a', 'JJ PUMARAN SL');
    insert into public.sites (id, org_id, name) values
      ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'El Rebajón'),
      ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', 'Sin pareja');
    insert into public.devices (id, org_id, site_id, hostname, status, os_type, last_seen_at) values
      ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'CAJA1', 'online', 'windows', now() at time zone 'UTC'),
      ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'CAJA2', 'offline', 'windows', (now() at time zone 'UTC') - interval '2 days');
    insert into public.software_inventory (id, device_id, name, version) values
      (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', 'ÁgoraTPV Cliente', '8.4.1');
    insert into public.alerts (id, device_id, org_id, status, severity, title, triggered_at) values
      (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', 'active', 'high', 'Disco lleno', now() at time zone 'UTC');
    insert into public.device_metrics (device_id, timestamp, cpu_percent) values
      ('00000000-0000-0000-0000-0000000000d1', now() at time zone 'UTC', 12),
      ('00000000-0000-0000-0000-0000000000d1', (now() at time zone 'UTC') - interval '5 days', 99);
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
  ok(psql(`select count(*) from cron.job where jobname like 'hub-%'`) === '9', 'nueve tareas de pg_cron, sin duplicar');

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
    `\nselect 1/(select count(*) from hub.areas where dueno = 'hub' and area = 'clientes');`, { esperaError: true }).ok,
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

  // ── Monitorización (fase 2): vistas sobre Breeze ───────────────────────
  const huellaBreeze = () => psql(`select (select count(*) from public.devices) || '/' || (select count(*) from public.alerts) || '/' || (select count(*) from public.device_metrics)`);
  const breezeAntes = huellaBreeze();
  psql(`insert into hub.locales (id, nombre, programa_tpv) values
          ('00000000-0000-0000-0000-0000000000c1', 'EL REBAJON', 'Agora TPV'),
          ('00000000-0000-0000-0000-0000000000c2', 'Otra sede', null)`);
  ok(psql(`select hub.rmm_emparejar()`) === '2', 'RMM: el emparejado da de alta los dos Sites');
  ok(psql(`select local_id from hub.rmm_sitios where site_id = '00000000-0000-0000-0000-0000000000b1'`) === '00000000-0000-0000-0000-0000000000c1',
    'RMM: empareja por nombre sin tildes ni mayúsculas');
  ok(psql(`select hub.rmm_emparejar()`) === '0', 'RMM: una pasada que no cambia nada no escribe nada');
  psql(como('authenticated', 'tito@ok.test', `update hub.rmm_sitios set local_id = '00000000-0000-0000-0000-0000000000c2', manual = true
    where site_id = '00000000-0000-0000-0000-0000000000b2';`));
  psql(`update hub.locales set nombre = 'Sin pareja' where id = '00000000-0000-0000-0000-0000000000c1'`);
  psql(`select hub.rmm_emparejar()`);
  ok(psql(`select local_id from hub.rmm_sitios where site_id = '00000000-0000-0000-0000-0000000000b2'`) === '00000000-0000-0000-0000-0000000000c2',
    'RMM: lo emparejado a mano no se pisa');
  psql(`update hub.locales set nombre = 'EL REBAJON' where id = '00000000-0000-0000-0000-0000000000c1'`);
  psql(`select hub.rmm_emparejar()`);
  const rmm = (email, sql) => psql(como('authenticated', email, sql)).split('\n').pop();
  ok(rmm('tito@ok.test', `select count(*) || ':' || count(*) filter (where conectado) from hub.rmm_equipos;`) === '2:1', 'RMM: un usuario ve los equipos y quién está conectado');
  ok(rmm('extrano@ok.test', `select count(*) from hub.rmm_equipos;`) === '0', 'RMM: quien no está en el hub no ve equipos');
  ok(!psql(como('anon', null, 'select count(*) from hub.rmm_equipos;'), { esperaError: true }).ok, 'RMM: anon no ve nada');
  ok(rmm('tito@ok.test', `select tpv_version || '|' || alertas_abiertas from hub.rmm_equipos where hostname = 'CAJA1';`) === '8.4.1|1',
    'RMM: versión del TPV cruzada con programa_tpv y alertas abiertas');
  ok(rmm('tito@ok.test', `select estado || ':' || equipos || ':' || conectados from hub.rmm_estado_local where local_id = '00000000-0000-0000-0000-0000000000c1';`) === 'alerta:2:1',
    'RMM: semáforo de la sede');
  ok(rmm('tito@ok.test', `select count(*) from hub.rmm_metricas where device_id = '00000000-0000-0000-0000-0000000000d1';`) === '1', 'RMM: métricas solo de las últimas 48 h');
  ok(psql(como('service_role', null, `select count(*) from hub.rmm_alertas;`)).split('\n').pop() === '1', 'RMM: las funciones (service_role) leen las alertas');
  for (const [v, sql] of [['rmm_metricas', `update hub.rmm_metricas set cpu = 0;`], ['rmm_equipos', `delete from hub.rmm_equipos;`],
    ['rmm_alertas', `update hub.rmm_alertas set estado = 'resolved';`], ['rmm_acciones', `insert into hub.rmm_acciones (accion) values ('comando');`]]) {
    ok(!psql(como('authenticated', 'ana@ok.test', sql), { esperaError: true }).ok, `RMM: nadie escribe por ${v} (ni un admin)`);
    if (!sql.startsWith('insert')) ok(!psql(como('service_role', null, sql), { esperaError: true }).ok, `RMM: ni el service_role por ${v}`);
  }
  ok(huellaBreeze() === breezeAntes, 'RMM: los datos de Breeze siguen igual');

  // ── Puesto de mando (fase 3) ───────────────────────────────────────────
  psql(`insert into hub.zoho_facturas (invoice_id, numero, cliente_zoho_id, cliente_nombre, fecha, vence, estado, total, saldo) values
          ('f1', 'F26-1', 'z1', 'Bar Grande', current_date - 200, current_date - 170, 'overdue', 5000, 800),
          ('f2', 'F26-2', 'z1', 'Bar Grande', current_date - 150, current_date - 150, 'paid', 1200, 0),
          ('f3', 'F26-3', 'z2', 'Tienda', current_date, current_date + 30, 'sent', 100, 100);
        insert into hub.zoho_cobros (payment_id, cliente_zoho_id, fecha, importe) values ('c1', 'z1', current_date, 50);
        insert into hub.tickets (id, numero, titulo, estado, prioridad) values (gen_random_uuid(), 9, 'Impresora', 'Abierto', 'alta');`);
  const tipos = email => psql(como('authenticated', email, `select coalesce(string_agg(distinct tipo, ',' order by tipo), 'nada') from hub.panorama_direccion();`)).split('\n').pop();
  const deTito = tipos('tito@ok.test'), deAna = tipos('ana@ok.test');
  ok(deTito.includes('ticket_sin_asignar') && deTito.includes('alerta_rmm') && !deTito.includes('factura_vencida'),
    `mando: un técnico ve sus avisos pero no los de dinero (${deTito})`);
  ok(deAna.includes('factura_vencida') && deAna.includes('cliente_sin_comprar'), `mando: un admin ve también el dinero (${deAna})`);
  ok(tipos('extrano@ok.test') === 'nada', 'mando: quien no está en el hub no ve avisos');
  ok(psql(como('service_role', null, `select count(*) filter (where dinero) from hub.panorama_direccion('${titoId}');`)).split('\n').pop() === '0',
    'mando: el bot, en nombre de un técnico, tampoco le da dinero');
  ok(psql(como('authenticated', 'tito@ok.test', `select hub.direccion_resumen() is null;`)).split('\n').pop() === 't', 'mando: un técnico no recibe el resumen de dinero');
  ok(psql(como('authenticated', 'ana@ok.test', `select (hub.direccion_resumen()->>'vencido')::numeric || '/' || (hub.direccion_resumen()->>'cobrado_mes')::numeric;`)).split('\n').pop() === '800.00/50.00',
    'mando: resumen con vencido y cobrado del mes');
  ok(psql(como('authenticated', 'tito@ok.test', `select count(*) from hub.zoho_facturas;`)).split('\n').pop() === '0', 'mando: un técnico no lee las facturas de Zoho');
  ok(!psql(como('authenticated', 'ana@ok.test', `insert into hub.zoho_facturas (invoice_id) values ('x');`), { esperaError: true }).ok, 'mando: nadie escribe en el espejo de Zoho');

  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.informes_programados (tipo, usuario_id) values ('cobros_vencidos', '${titoId}');`), { esperaError: true }).ok,
    'informes: un técnico no se programa uno de dinero');
  const anaId = psql(`select id from hub.usuarios where email = 'ana@ok.test'`);
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.informes_programados (tipo, usuario_id) values ('avisos', '${anaId}');`), { esperaError: true }).ok,
    'informes: un técnico no programa informes a otro');
  ok(psql(como('authenticated', 'tito@ok.test', `insert into hub.informes_programados (tipo, usuario_id) values ('repaso_matinal', '${titoId}');`), { esperaError: true }).ok,
    'informes: un técnico se programa su repaso');
  ok(psql(`select creado_por = '${titoId}' from hub.informes_programados where tipo = 'repaso_matinal'`) === 't', 'informes: apunta quién lo creó');
  ok(psql(como('authenticated', 'ana@ok.test', `insert into hub.informes_programados (tipo, usuario_id) values ('cobros_vencidos', '${anaId}');`), { esperaError: true }).ok,
    'informes: un admin sí se programa uno de dinero');
  ok(psql(como('authenticated', 'tito@ok.test', `select count(*) from hub.informes_programados;`)).split('\n').pop() === '1', 'informes: cada uno ve los suyos');

  const cod = psql(como('authenticated', 'tito@ok.test', `select hub.telegram_codigo();`)).split('\n').find(l => /^[0-9a-f]{12}$/.test(l));
  ok(!!cod && psql(`select count(*) from hub.telegram_vinculos where codigo = '${cod}' and codigo_caduca > now()`) === '1', 'telegram: código de un uso con caducidad');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.telegram_vinculos set chat_id = 1;`) + '\nselect 1/(select count(*) from hub.telegram_vinculos where chat_id = 1);', { esperaError: true }).ok,
    'telegram: nadie se vincula un chat a mano');
  ok(!psql(como('service_role', null, `select hub.guardar_secreto('app_service_role_key', 'x');`), { esperaError: true }).ok, 'secretos: guardar_secreto solo admite el de Zoho');
  psql(como('service_role', null, `select hub.guardar_secreto('zoho_hub_refresh_token', 'r1'); select hub.guardar_secreto('zoho_hub_refresh_token', 'r2');`));
  ok(psql(`select string_agg(decrypted_secret, ',') from vault.decrypted_secrets where name = 'zoho_hub_refresh_token'`) === 'r2', 'secretos: guarda y actualiza sin duplicar');
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.guardar_secreto('zoho_hub_refresh_token', 'x');`), { esperaError: true }).ok, 'secretos: un usuario no puede guardar');
  ok(psql(`select hub.lanzar_funcion('zoho-lectura')`) === '1', 'lanzar_funcion llama a net.http_post');

  // ── Ventas (fase 4) ────────────────────────────────────────────────────
  const una = (email, sql) => psql(como('authenticated', email, sql)).split('\n').pop();
  const idDe = (email, sql) => psql(como('authenticated', email, sql)).split('\n').find(l => /^[0-9a-f-]{36}$/.test(l));
  ok(psql(`select dueno || importar_altas from hub.areas where area = 'oportunidades'`) === 'hubtrue', 'ventas: oportunidades es área del hub e importa altas');
  const op = idDe('tito@ok.test', `insert into hub.oportunidades (titulo, valor_estimado) values ('Cámaras hotel', 3000) returning id;`);
  ok(!!op, 'ventas: un usuario crea una oportunidad (embudo por defecto)');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.oportunidades set estado = 'Inventado' where id = '${op}';`), { esperaError: true }).ok,
    'ventas: una etapa que no existe en el embudo no vale');
  psql(como('authenticated', 'tito@ok.test', `update hub.oportunidades set estado = 'Ganado' where id = '${op}';`));
  ok(psql(`select cerrada_at is not null from hub.oportunidades where id = '${op}'`) === 't', 'ventas: ganar la cierra (cerrada_at)');
  psql(como('authenticated', 'tito@ok.test', `update hub.oportunidades set estado = 'Propuesta' where id = '${op}';`));
  ok(psql(`select cerrada_at is null from hub.oportunidades where id = '${op}'`) === 't', 'ventas: reabrirla la vuelve a abrir');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.oportunidades where id = '${op}';`));
  ok(psql(`select count(*) from hub.oportunidades where id = '${op}'`) === '1', 'ventas: un técnico no borra oportunidades');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.pipelines (nombre, etapas) values ('x', '[]');`), { esperaError: true }).ok, 'ventas: un técnico no crea embudos');

  psql(`insert into hub.clientes (id, nombre, zoho_id) values ('00000000-0000-0000-0000-0000000000e1', 'Bar Grande SL', 'z1'), ('00000000-0000-0000-0000-0000000000e2', 'Tienda', 'z2')`);
  ok(!!idDe('tito@ok.test', `insert into hub.actividades (tipo, texto, cliente_id) values ('llamada', 'Llamé, quiere presupuesto', '00000000-0000-0000-0000-0000000000e1') returning id;`),
    'ventas: apuntar una actividad (a su nombre)');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.actividades (texto, usuario_id) values ('suplantar', '${anaId}');`), { esperaError: true }).ok,
    'ventas: nadie apunta actividades a nombre de otro');
  psql(como('authenticated', 'ana@ok.test', `update hub.actividades set texto = 'cambiado' where usuario_id = '${titoId}';`));
  ok(psql(`select texto from hub.actividades where usuario_id = '${titoId}'`) === 'cambiado', 'ventas: un admin corrige actividades');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.clientes_crm (cliente_id, siguiente_fecha, siguiente_texto, responsable_id)
    values ('00000000-0000-0000-0000-0000000000e2', current_date - 2, 'Llamar para la renovación', '${titoId}');`));
  ok(una('tito@ok.test', `select clase from hub.clases_clientes() where cliente_id = '00000000-0000-0000-0000-0000000000e1';`) === 'A',
    'ventas: el cliente que más factura es clase A (Pareto)');
  psql(como('authenticated', 'tito@ok.test', `update hub.clientes_crm set clase_manual = 'A' where cliente_id = '00000000-0000-0000-0000-0000000000e2';`));
  ok(una('tito@ok.test', `select clase || clase_auto from hub.clases_clientes() where cliente_id = '00000000-0000-0000-0000-0000000000e2';`) === 'AC',
    'ventas: la clase puesta a mano manda sobre la calculada');
  ok(una('tito@ok.test', `select count(*) filter (where tipo in ('factura','cobro')) || '/' || count(*) filter (where tipo like 'actividad%') from hub.linea_tiempo('00000000-0000-0000-0000-0000000000e1');`) === '0/1',
    'ventas: la línea de tiempo de un técnico no lleva facturas');
  ok(una('ana@ok.test', `select count(*) filter (where tipo = 'factura') from hub.linea_tiempo('00000000-0000-0000-0000-0000000000e1');`) === '2',
    'ventas: la de un admin, sí');

  ok(psql(como('service_role', null, `select hub.preparar_recordatorios();`)).split('\n').pop() === '1', 'cobros: prepara el recordatorio de la factura vencida');
  ok(psql(`select nivel || ':' || (texto like '%F26-1%' and texto like '%800,00 €%') from hub.cobros_recordatorios`) === '3:true',
    'cobros: nivel según los días de retraso y el texto con número e importe');
  ok(psql(como('service_role', null, `select hub.preparar_recordatorios();`)).split('\n').pop() === '0', 'cobros: no lo duplica');
  ok(una('tito@ok.test', `select count(*) from hub.cobros_recordatorios;`) === '0', 'cobros: un técnico no los ve');
  const avisosDe = email => una(email, `select coalesce(string_agg(distinct tipo, ',' order by tipo), 'nada') from hub.panorama_direccion();`);
  psql(`insert into hub.oportunidades (titulo, origen, created_at) values ('Web: quiero TPV', 'web', now() - interval '2 days')`);
  const at = avisosDe('tito@ok.test'), aa = avisosDe('ana@ok.test');
  ok(at.includes('lead_sin_contestar') && at.includes('siguiente_vencido') && !at.includes('recordatorio_cobro'), `avisos: lead y «lo siguiente» para todos (${at})`);
  ok(aa.includes('recordatorio_cobro'), 'avisos: recordatorio de cobro listo, solo admins');
  psql(`update hub.zoho_facturas set saldo = 0, estado = 'paid' where invoice_id = 'f1'`);
  psql(como('service_role', null, `select hub.preparar_recordatorios();`));
  ok(psql(`select estado from hub.cobros_recordatorios`) === 'descartado', 'cobros: al cobrarse, el recordatorio pendiente se descarta');

  // ── Wiki y buscador (fase 5) ───────────────────────────────────────────
  const pag = idDe('tito@ok.test', `insert into hub.paginas (titulo, contenido) values ('Routers', 'Clave del router: admin') returning id;`);
  ok(!!pag, 'wiki: un usuario crea una página');
  psql(como('authenticated', 'tito@ok.test', `update hub.paginas set contenido = 'Clave del router: nueva' where id = '${pag}';`));
  ok(psql(`select p.version || ':' || v.contenido from hub.paginas p join hub.paginas_versiones v on v.pagina_id = p.id where p.id = '${pag}'`) === '2:Clave del router: admin',
    'wiki: cambiar el contenido guarda la versión anterior');
  ok(psql(`select actualizado_por = '${titoId}' from hub.paginas where id = '${pag}'`) === 't', 'wiki: apunta quién la cambió');
  const hija = idDe('tito@ok.test', `insert into hub.paginas (titulo, padre_id) values ('Router del bar', '${pag}') returning id;`);
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.paginas set padre_id = '${hija}' where id = '${pag}';`), { esperaError: true }).ok,
    'wiki: no se puede meter una página dentro de su propia hija');
  ok(una('tito@ok.test', `select count(*) from hub.paginas where tsv @@ websearch_to_tsquery('spanish', 'routers');`) === '1', 'wiki: búsqueda de texto en español');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.paginas where id = '${hija}';`));
  const vec = x => `'[${Array(384).fill(x).join(',')}]'`;
  psql(`insert into hub.documentos (id, fuente, ref, titulo) values ('00000000-0000-0000-0000-00000000d0c1', 'wiki', '${pag}', 'Routers');`);
  ok(psql(como('service_role', null, `select hub.guardar_fragmentos('00000000-0000-0000-0000-00000000d0c1', jsonb_build_array(
      jsonb_build_object('orden', 0, 'texto', 'La clave del router del Hotel es 1234', 'embedding', ${vec(0.1)}),
      jsonb_build_object('orden', 1, 'texto', 'Las cámaras graban 30 días', 'embedding', ${vec(-0.1)})));`)).split('\n').pop() === '2',
    'buscador: la función guarda los trozos (el service_role no toca public)');
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.guardar_fragmentos('00000000-0000-0000-0000-00000000d0c1', '[]');`), { esperaError: true }).ok,
    'buscador: un usuario no escribe en el índice');
  ok(una('tito@ok.test', `select texto from hub.buscar_fragmentos(${vec(0.1)}, 'clave router', 1);`) === 'La clave del router del Hotel es 1234',
    'buscador: encuentra el trozo más parecido (significado + palabras)');
  ok(psql(como('service_role', null, `select count(*) from hub.buscar_fragmentos(${vec(0.1)}, 'clave', 5);`)).split('\n').pop() === '2',
    'buscador: el service_role busca sin USAGE en public');
  ok(una('extrano@ok.test', `select count(*) from hub.buscar_fragmentos(${vec(0.1)}, 'clave', 5);`) === '0', 'buscador: quien no está en el hub no busca');
  ok(!psql(como('authenticated', 'ana@ok.test', `insert into hub.documentos (fuente, ref, titulo) values ('wiki', 'x', 'x');`), { esperaError: true }).ok,
    'buscador: el índice solo lo escribe la función');

  // ── Desk (fase 6) ──────────────────────────────────────────────────────
  // Lunes 5/10/2026 a las 13:00 (Canarias): 1 h de mañana + 2 h de tarde → 18:00.
  ok(psql(`select to_char(hub.sumar_laborables('2026-10-05 13:00 Atlantic/Canary', 180) at time zone 'Atlantic/Canary', 'DD HH24:MI')`) === '05 18:00',
    'SLA: suma minutos laborables saltando el mediodía');
  ok(psql(`select to_char(hub.sumar_laborables('2026-10-09 18:00 Atlantic/Canary', 120) at time zone 'Atlantic/Canary', 'DD HH24:MI')`) === '13 10:00',
    'SLA: salta el fin de semana y el festivo del 12 de octubre');
  const tk = idDe('tito@ok.test', `insert into hub.tickets (titulo, prioridad, canal, created_at) values ('Sin internet', 'Urgente', 'email', '2026-10-05 09:00 Atlantic/Canary') returning id;`);
  ok(!!tk, 'desk: un usuario crea tickets (área cortada)');
  ok(psql(`select numero >= 5000 and to_char(sla_respuesta_at at time zone 'Atlantic/Canary', 'HH24:MI') = '11:00'
           and to_char(sla_resolucion_at at time zone 'Atlantic/Canary', 'HH24:MI') = '13:00' from hub.tickets where id = '${tk}'`) === 't',
    'desk: numeración propia y SLA de urgente (2 h / 4 h)');
  psql(como('authenticated', 'tito@ok.test', `update hub.tickets set prioridad = 'Baja' where id = '${tk}';`));
  ok(psql(`select to_char(sla_respuesta_at at time zone 'Atlantic/Canary', 'DD HH24:MI') from hub.tickets where id = '${tk}'`) === '07 19:00',
    'desk: cambiar la prioridad recalcula el SLA (baja: 3 días laborables)');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.ticket_comentarios (ticket_id, texto, tipo) values ('${tk}', 'Nos conectamos', 'respuesta');`));
  ok(psql(`select primera_respuesta_at is not null from hub.tickets where id = '${tk}'`) === 't', 'desk: la primera respuesta queda apuntada');
  ok(psql(`select autor_id = '${titoId}' from hub.ticket_comentarios where ticket_id = '${tk}'`) === 't', 'desk: el comentario sale a nombre de quien lo escribe');
  psql(como('authenticated', 'tito@ok.test', `update hub.tickets set estado = 'Cerrado' where id = '${tk}';`));
  ok(psql(`select cerrado_at is not null from hub.tickets where id = '${tk}'`) === 't', 'desk: al cerrar se apunta la hora');
  psql(como('service_role', null, `insert into hub.ticket_comentarios (ticket_id, autor_nombre, texto, created_at) values ('${tk}', 'WhatsApp · Marta', 'Sigue sin ir', now() + interval '1 minute');`, { 'x-hub-sync': '1' }));
  ok(psql(`select t.estado || ':' || c.tipo from hub.tickets t join hub.ticket_comentarios c on c.ticket_id = t.id and c.autor_nombre like 'WhatsApp%' where t.id = '${tk}'`) === 'Abierto:cliente',
    'desk: el WhatsApp del cliente (de la app) reabre el ticket cerrado en el hub');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.tickets where id = '${tk}';`));
  ok(psql(`select count(*) from hub.tickets where id = '${tk}'`) === '1', 'desk: un técnico no borra tickets');
  const tokVal = psql(`select valoracion_token from hub.tickets where id = '${tk}'`);
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.valorar_ticket('${tokVal}', 5, 'x');`), { esperaError: true }).ok, 'desk: la valoración solo la guarda la función');
  psql(como('service_role', null, `select hub.valorar_ticket('${tokVal}', 4, 'Rápidos');`));
  ok(psql(`select valoracion || valoracion_comentario from hub.tickets where id = '${tk}'`) === '4Rápidos', 'desk: valoración con el token del enlace');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.sla_politicas set respuesta_min = 1 where prioridad = 'urgente';`) +
    `\nselect 1/(select count(*) from hub.sla_politicas where respuesta_min = 1);`, { esperaError: true }).ok, 'desk: un técnico no cambia el SLA');
  psql(`insert into hub.tickets (titulo, prioridad, created_at) values ('Viejo', 'Urgente', now() - interval '10 days')`);
  psql(`insert into hub.correos_entrantes (gmail_id, de, asunto, recibido_at) values ('g1', 'x@y.z', 'Hola', now())`);
  ok(avisosDe('tito@ok.test').includes('correo_sin_revisar') && avisosDe('tito@ok.test').includes('sla_vencido'), 'avisos: SLA vencido y bandeja de correo');

  // ── Portal de clientes (fase 7) ────────────────────────────────────────
  const cliP = psql(`insert into hub.clientes (nombre) values ('Cliente portal') returning id`).split('\n')[0];
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.portal_accesos (email, cliente_id) values ('x@y.es', '${cliP}');`), { esperaError: true }).ok,
    'portal: un técnico no da accesos');
  const acc = idDe('ana@ok.test', `insert into hub.portal_accesos (email, cliente_id, nombre) values ('  Marta@Cliente.ES ', '${cliP}', 'Marta') returning id;`);
  ok(psql(`select email || ':' || (creado_por = '${anaId}') from hub.portal_accesos where id = '${acc}'`) === 'marta@cliente.es:true', 'portal: un admin invita (correo normalizado, a su nombre)');
  psql(`insert into hub.portal_sesiones (acceso_id, huella, caduca_at) values ('${acc}', 'h1', now() + interval '1 day');
        insert into hub.portal_enlaces (acceso_id, huella, caduca_at) values ('${acc}', 'e1', now() + interval '1 hour');`);
  ok(una('ana@ok.test', `select count(*) from hub.portal_enlaces;`) === '0', 'portal: los enlaces no los ve nadie del equipo (solo la función)');
  ok(una('tito@ok.test', `select count(*) from hub.portal_traza;`) === '0', 'portal: la traza solo la ven los admins');
  psql(como('authenticated', 'ana@ok.test', `update hub.portal_accesos set activo = false where id = '${acc}';`));
  ok(psql(`select (select count(*) from hub.portal_sesiones where acceso_id = '${acc}' and cerrada_at is null) || ':' ||
               (select count(*) from hub.portal_enlaces where acceso_id = '${acc}' and usado_at is null) || ':' ||
               (select revocado_por = '${anaId}' from hub.portal_accesos where id = '${acc}') || ':' ||
               (select count(*) from hub.portal_traza where acceso_id = '${acc}' and accion = 'revocado')`) === '0:0:true:1',
    'portal: revocar cierra sesiones y enlaces y queda en la traza');
  const pre = psql(`insert into hub.presupuestos (cliente_id, titulo, estado, total, numero_presupuesto) values ('${cliP}', 'Cámaras', 'Enviado', 900, 'P-9') returning id`).split('\n')[0];
  psql(`insert into hub.portal_aceptaciones (presupuesto_id, acceso_id, nombre) values ('${pre}', '${acc}', 'Marta Díaz')`);
  ok(avisosDe('tito@ok.test').includes('presupuesto_aceptado_portal'), 'avisos: presupuesto aceptado en el portal (gancho avisos_extra)');
  ok(una('extrano@ok.test', `select count(*) from hub.avisos_extra(null, true);`) === '0', 'avisos_extra: quien no está en el hub no ve nada');

  // ── Comandas (fase 8) ──────────────────────────────────────────────────
  const com = idDe('ana@ok.test', `insert into hub.comandas (transcripcion, origen) values ('Tito, cambia el router del bar', 'app') returning id;`);
  ok(psql(`select creada_por = '${anaId}' from hub.comandas where id = '${com}'`) === 't', 'comandas: la comanda sale a nombre de quien la dicta');
  const ct = idDe('ana@ok.test', `insert into hub.comanda_tareas (comanda_id, texto, persona_id, prioridad, origen, created_at) values ('${com}', 'Cambiar el router del bar', '${titoId}', true, 'voz', now() - interval '5 hours') returning id;`);
  ok(avisosDe('tito@ok.test').includes('comanda_parada'), 'avisos: comanda prioritaria sin empezar');
  psql(como('authenticated', 'tito@ok.test', `update hub.comanda_tareas set estado = 'en_curso' where id = '${ct}';`));
  ok(psql(`select empezada_at is not null from hub.comanda_tareas where id = '${ct}'`) === 't', 'comandas: empezar apunta la hora');
  psql(como('authenticated', 'tito@ok.test', `update hub.comanda_tareas set estado = 'hecha' where id = '${ct}';`));
  ok(psql(`select hecha_at is not null from hub.comanda_tareas where id = '${ct}'`) === 't' && !avisosDe('tito@ok.test').includes('comanda_parada'), 'comandas: hecha apunta la hora y quita el aviso');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.comanda_tareas where id = '${ct}';`));
  ok(psql(`select count(*) from hub.comanda_tareas where id = '${ct}'`) === '1', 'comandas: un técnico no borra la tarea que le mandaron');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.comanda_tareas where id = '${ct}';`));
  ok(psql(`select count(*) from hub.comanda_tareas where id = '${ct}'`) === '0', 'comandas: quien la creó sí la borra');

  // ── Almacén (fase 9) ───────────────────────────────────────────────────
  ok(!psql(como('authenticated', 'ana@ok.test', `insert into hub.catalogo (nombre) values ('x');`), { esperaError: true }).ok, 'almacén: el catálogo es espejo (ni un admin escribe)');
  psql(`insert into hub.catalogo (id, nombre, categoria) values ('00000000-0000-0000-0000-0000000000c1', 'Cable RJ45 Cat6', 'Material');
        insert into hub.furgonetas (id, nombre) values ('00000000-0000-0000-0000-0000000000f1', 'Almacén'), ('00000000-0000-0000-0000-0000000000f2', 'Furgo Tito');
        insert into hub.furgoneta_inventario (id, furgoneta_id, nombre, cantidad, stock_minimo, catalogo_id) values
          ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'Cable RJ45', 4, 5, '00000000-0000-0000-0000-0000000000c1'),
          ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f2', 'Cable RJ45', 2, 1, '00000000-0000-0000-0000-0000000000c1');
        insert into hub.furgoneta_movimientos (furgoneta_id, producto_id, tipo, cantidad, created_at) values
          ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'salida', 45, now() - interval '10 days'),
          ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'salida', 900, now() - interval '200 days');`);
  const prov = idDe('tito@ok.test', `insert into hub.proveedores (nombre, plazo_dias) values ('Distribuidora Canaria', 5) returning id;`);
  psql(como('authenticated', 'tito@ok.test', `insert into hub.material_proveedor (catalogo_id, proveedor_id, precio_compra, preferido) values ('00000000-0000-0000-0000-0000000000c1', '${prov}', 0.8, true);`));
  // stock 6, mínimo 6, consumo 45 en 90 días = 0,5/día; plazo 5 + 30 de cobertura → 17,5 + 6 − 6 = 17,5 → 18
  ok(una('tito@ok.test', `select stock || '|' || minimo || '|' || consumo_90 || '|' || sugerido || '|' || proveedor || '|' || urgente from hub.mrp()`) === '6|6|45|18|Distribuidora Canaria|false',
    'MRP: junta ubicaciones, consumo de 90 días, proveedor preferido y cuánto pedir');
  const pc = idDe('tito@ok.test', `insert into hub.pedidos_compra (proveedor_id) values ('${prov}') returning id;`);
  psql(como('authenticated', 'tito@ok.test', `insert into hub.pedido_compra_lineas (pedido_compra_id, catalogo_id, nombre, cantidad, precio) values ('${pc}', '00000000-0000-0000-0000-0000000000c1', 'Cable RJ45', 18, 0.8);`));
  ok(psql(`select total from hub.pedidos_compra where id = '${pc}'`) === '14.4', 'compras: el total del pedido es la suma de sus líneas');
  ok(una('tito@ok.test', `select en_camino || '|' || sugerido from hub.mrp()`) === '18|0', 'MRP: lo pedido cuenta como en camino');
  psql(como('authenticated', 'tito@ok.test', `update hub.pedidos_compra set estado = 'Enviado' where id = '${pc}';`));
  ok(psql(`select (esperado_para = current_date + 5) and enviado_at is not null from hub.pedidos_compra where id = '${pc}'`) === 't', 'compras: al enviarlo se espera para dentro del plazo del proveedor');
  psql(`update hub.pedidos_compra set esperado_para = current_date - 1 where id = '${pc}'`);
  ok(avisosDe('tito@ok.test').includes('pedido_retrasado'), 'avisos: pedido de compra retrasado');
  psql(como('authenticated', 'tito@ok.test', `update hub.pedidos_compra set estado = 'Recibido' where id = '${pc}';`));
  ok(avisosDe('tito@ok.test').includes('pedido_sin_entrada'), 'avisos: recibido sin dar entrada en el inventario de la app');
  psql(`update hub.furgoneta_inventario set cantidad = 0`);
  psql(`delete from hub.pedido_compra_lineas`);
  ok(avisosDe('tito@ok.test').includes('hay_que_comprar'), 'avisos: hay que comprar lo que se queda sin stock');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.proveedores where id = '${prov}';`));
  ok(psql(`select count(*) from hub.proveedores where id = '${prov}'`) === '1', 'compras: un técnico no borra proveedores');
  const envio = idDe('tito@ok.test', `insert into hub.envios (agencia, seguimiento, destinatario, estado) values ('Correos', 'PQ123', 'Hotel Playa', 'enviado') returning id;`);
  psql(`update hub.envios set enviado_at = now() - interval '6 days' where id = '${envio}'`);
  ok(avisosDe('tito@ok.test').includes('envio_atascado'), 'avisos: envío sin entregar después de 5 días');
  psql(como('authenticated', 'tito@ok.test', `update hub.envios set estado = 'entregado' where id = '${envio}';`));
  ok(psql(`select entregado_at is not null from hub.envios where id = '${envio}'`) === 't' && !avisosDe('tito@ok.test').includes('envio_atascado'), 'envíos: entregado apunta la hora y quita el aviso');
  ok(!psql(como('authenticated', 'tito@ok.test', `select * from hub.avisos_almacen(null, false);`), { esperaError: true }).ok, 'avisos: los ganchos por fase no se llaman sueltos');

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
