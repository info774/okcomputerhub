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
${/;\s*$/.test(sql) ? sql : sql + ';'}
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
  ok(psql(`select count(*) from cron.job where jobname like 'hub-%'`) === '10', 'diez tareas de pg_cron (con el repaso de la cartera de Zoho), sin duplicar');

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
  ok(psql(`select (fecha_seguimiento = current_date + 7)::text || siguiente_texto from hub.oportunidades where id = '${op}'`) === 'truePreguntar por la propuesta',
    'embudo: entrar en Propuesta pone el próximo paso de su regla');
  ok(psql(`select string_agg(texto, '|' order by fecha) from hub.actividades where oportunidad_id = '${op}' and tipo = 'etapa' and usuario_id = '${titoId}'`) === 'Detectado → Ganado|Ganado → Propuesta',
    'embudo: cada cambio de etapa queda en la línea de tiempo, a nombre de quien lo hizo');
  psql(como('authenticated', 'tito@ok.test', `update hub.oportunidades set estado = 'Negociando', fecha_seguimiento = '2030-01-01' where id = '${op}';`));
  ok(psql(`select fecha_seguimiento from hub.oportunidades where id = '${op}'`) === '2030-01-01', 'embudo: una fecha puesta en el mismo cambio manda sobre la regla');
  ok(psql(`select (e->>'proponer') || coalesce(e->>'comanda_texto', '-') from hub.pipelines p, jsonb_array_elements(p.etapas) e where p.por_defecto and e->>'clave' = 'Ganado'`) === 'trabajo-',
    'embudo: al ganar se propone el trabajo');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.oportunidades where id = '${op}';`));
  ok(psql(`select count(*) from hub.oportunidades where id = '${op}'`) === '1', 'ventas: un técnico no borra oportunidades');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.pipelines (nombre, etapas) values ('x', '[]');`), { esperaError: true }).ok, 'ventas: un técnico no crea embudos');

  psql(`insert into hub.clientes (id, nombre, zoho_id) values ('00000000-0000-0000-0000-0000000000e1', 'Bar Grande SL', 'z1'), ('00000000-0000-0000-0000-0000000000e2', 'Tienda', 'z2')`);
  ok(!!idDe('tito@ok.test', `insert into hub.actividades (tipo, texto, cliente_id) values ('llamada', 'Llamé, quiere presupuesto', '00000000-0000-0000-0000-0000000000e1') returning id;`),
    'ventas: apuntar una actividad (a su nombre)');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.actividades (texto, usuario_id) values ('suplantar', '${anaId}');`), { esperaError: true }).ok,
    'ventas: nadie apunta actividades a nombre de otro');
  psql(como('authenticated', 'ana@ok.test', `update hub.actividades set texto = 'cambiado' where usuario_id = '${titoId}' and tipo = 'llamada';`));
  ok(psql(`select texto from hub.actividades where usuario_id = '${titoId}' and tipo = 'llamada'`) === 'cambiado', 'ventas: un admin corrige actividades');
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

  // ── Personas (fase 10) ─────────────────────────────────────────────────
  // Lunes 5/10/2026: dos fichajes solapados (9-11 y 10-12 → 3 h) y otro 16-18 → 5 h; entrada 9, salida 18.
  psql(`insert into hub.sesiones (tecnico_id, tecnico_nombre, traslado, inicio, fin) values
          ('${titoId}', 'Tito', null, '2026-10-05 09:00 Atlantic/Canary', '2026-10-05 11:00 Atlantic/Canary'),
          ('${titoId}', 'Tito', '2026-10-05 10:00 Atlantic/Canary', '2026-10-05 10:15 Atlantic/Canary', '2026-10-05 12:00 Atlantic/Canary'),
          (null, 'tito', null, '2026-10-05 16:00 Atlantic/Canary', '2026-10-05 18:00 Atlantic/Canary');`);
  const jor = una('tito@ok.test', `select to_char(entrada at time zone 'Atlantic/Canary', 'HH24:MI') || '-' || to_char(salida at time zone 'Atlantic/Canary', 'HH24:MI') || '|' || trabajado_min || '|' || pausas_min || '|' || sesiones from hub.jornada('2026-10-01', '2026-10-31')`);
  ok(jor === '09:00-18:00|300|240|3', `jornada: entrada, salida y tiempo sin contar dos veces lo solapado (${jor})`);
  ok(una('tito@ok.test', `select count(*) from hub.jornada('2026-10-01', '2026-10-31', '${anaId}')`) === '0', 'jornada: cada uno ve solo la suya');
  ok(una('ana@ok.test', `select count(*) from hub.jornada('2026-10-01', '2026-10-31')`) === '1', 'jornada: un admin ve la de todos');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.jornada_ajustes (usuario_id, fecha, entrada, salida, motivo) values ('${titoId}', '2026-10-05', now(), now() + interval '1 hour', 'me olvidé');`), { esperaError: true }).ok,
    'jornada: un técnico no corrige su jornada');
  psql(como('authenticated', 'ana@ok.test', `insert into hub.jornada_ajustes (usuario_id, fecha, entrada, salida, pausa_min, motivo) values ('${titoId}', '2026-10-05', '2026-10-05 08:30 Atlantic/Canary', '2026-10-05 18:00 Atlantic/Canary', 60, 'Olvidó fichar la primera visita');`));
  ok(una('tito@ok.test', `select trabajado_min || '|' || ajustado || '|' || motivo_ajuste from hub.jornada('2026-10-05', '2026-10-05')`) === '510|true|Olvidó fichar la primera visita',
    'jornada: la corrección manda, con su motivo');
  ok(psql(`select creado_por = '${anaId}' from hub.jornada_ajustes`) === 't', 'jornada: la corrección queda a nombre de quien la hizo');
  const aus = idDe('tito@ok.test', `insert into hub.ausencias (usuario_id, tipo, desde, hasta) values ('${titoId}', 'vacaciones', '2026-10-09', '2026-10-13') returning id;`);
  ok(psql(`select dias || estado from hub.ausencias where id = '${aus}'`) === '2solicitada', 'ausencias: se piden y cuentan solo los laborables (sin fin de semana ni festivo)');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.ausencias set estado = 'aprobada' where id = '${aus}';`), { esperaError: true }).ok
    && psql(`select estado from hub.ausencias where id = '${aus}'`) === 'solicitada', 'ausencias: uno no se aprueba las suyas');
  ok(avisosDe('ana@ok.test').includes('ausencia_por_decidir') && !avisosDe('tito@ok.test').includes('ausencia_por_decidir'), 'avisos: ausencia por aprobar (a los admins)');
  psql(como('authenticated', 'ana@ok.test', `update hub.ausencias set estado = 'aprobada' where id = '${aus}';`));
  ok(psql(`select decidida_por = '${anaId}' from hub.ausencias where id = '${aus}'`) === 't', 'ausencias: aprobada por un admin (queda quién)');
  ok(una('tito@ok.test', `select ausencia from hub.jornada('2026-10-09', '2026-10-09')`) === 'vacaciones', 'jornada: los días de ausencia salen en el registro');
  const tg = idDe('tito@ok.test', `insert into hub.tickets_gasto (total, estado) values (12.5, 'revisar') returning id;`);
  ok(una('ana@ok.test', `select count(*) from hub.tickets_gasto`) === '1' && una('extrano@ok.test', `select count(*) from hub.tickets_gasto`) === '0', 'gastos: los ve quien los sube y los admins');
  psql(como('authenticated', 'ana@ok.test', `update hub.tickets_gasto set estado = 'ok' where id = '${tg}';`));
  psql(como('authenticated', 'tito@ok.test', `update hub.tickets_gasto set total = 99 where id = '${tg}';`), { esperaError: true });
  ok(psql(`select total || '|' || (revisado_por = '${anaId}') from hub.tickets_gasto where id = '${tg}'`) === '12.5|true', 'gastos: revisado no se toca (salvo un admin)');
  const fi = idDe('tito@ok.test', `insert into hub.firmas (titulo, contenido, firmante_nombre) values ('Acta de entrega', 'Se entrega un portátil', 'Marta') returning id;`);
  const tok1 = psql(`select token from hub.firmas where id = '${fi}'`);
  psql(como('authenticated', 'tito@ok.test', `update hub.firmas set contenido = 'Se entregan dos portátiles' where id = '${fi}';`));
  const [tok2, hash] = psql(`select token || ' ' || contenido_hash from hub.firmas where id = '${fi}'`).split(' ');
  ok(tok2 !== tok1 && hash.length === 64, 'firma: cambiar el texto cambia la huella y anula el enlace viejo');
  ok(!psql(como('authenticated', 'tito@ok.test', `update hub.firmas set estado = 'firmado', firmado_at = now() where id = '${fi}';`), { esperaError: true }).ok, 'firma: nadie del equipo la da por firmada');
  ok(!psql(como('service_role', null, `select hub.firma_firmar('${tok2}', 'otra', 'Marta Díaz', null, 'data:image/png;base64,AAAA', '1.2.3.4', 'x');`), { esperaError: true }).ok, 'firma: si la huella no cuadra, no se firma');
  psql(como('service_role', null, `select hub.firma_firmar('${tok2}', '${hash}', 'Marta Díaz', '12345678Z', 'data:image/png;base64,AAAA', '1.2.3.4', 'Chrome');`));
  ok(psql(`select estado || '|' || firmado_nombre || '|' || firmado_ip from hub.firmas where id = '${fi}'`) === 'firmado|Marta Díaz|1.2.3.4', 'firma: firmada con nombre, IP y hora');
  ok(!psql(como('authenticated', 'ana@ok.test', `update hub.firmas set contenido = 'x' where id = '${fi}';`), { esperaError: true }).ok, 'firma: lo firmado no se cambia (ni un admin)');
  ok(!psql(`insert into hub.portal_accesos (email, tipo) values ('cli@x.es', 'cliente')`, { esperaError: true }).ok
    && psql(`insert into hub.portal_accesos (email, tipo, nombre) values ('gestoria@asesor.es', 'gestoria', 'Asesoría') returning tipo`).split('\n')[0] === 'gestoria',
    'gestoría: acceso del portal sin cliente (un cliente sigue necesitándolo)');

  // ── Facturación propia (fase 11, SIN ACTIVAR) ──────────────────────────
  const fac = (serie) => idDe('ana@ok.test', `insert into hub.facturas (serie, cliente_id) values ('${serie}', '${cliP}') returning id;`);
  const f1 = fac('F');
  psql(como('authenticated', 'ana@ok.test', `insert into hub.factura_lineas (factura_id, concepto, cantidad, precio, impuesto_pct) values ('${f1}', 'Mantenimiento', 2, 50, 7), ('${f1}', 'Cable', 1, 10, 3);`));
  ok(psql(`select base_total || '|' || impuesto_total || '|' || total from hub.facturas where id = '${f1}'`) === '110.00|7.30|117.30', 'facturas: totales con IGIC por línea (7 % y 3 %)');
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.emitir_factura('${f1}');`), { esperaError: true }).ok, 'facturas: sin activar, la serie real no emite (Zoho sigue)');
  ok(!psql(como('authenticated', 'tito@ok.test', `select count(*) from hub.facturas;`) + `\nselect 1/(select count(*) from hub.facturas);`, { esperaError: true }).ok || una('tito@ok.test', 'select count(*) from hub.facturas') === '0', 'facturas: un técnico no las ve');
  const p1 = fac('P'), p2 = fac('P');
  for (const p of [p1, p2]) psql(como('authenticated', 'ana@ok.test', `insert into hub.factura_lineas (factura_id, concepto, cantidad, precio) values ('${p}', 'Prueba', 1, 100);`));
  psql(como('authenticated', 'ana@ok.test', `select hub.emitir_factura('${p2}'); select hub.emitir_factura('${p1}');`));
  ok(psql(`select string_agg(codigo, ',' order by numero) from hub.facturas where serie = 'P'`) === `P-${new Date().getFullYear()}-0001,P-${new Date().getFullYear()}-0002`, 'facturas: la serie de PRUEBA numera correlativo, en el orden de emisión');
  ok(psql(`select (select huella_anterior from hub.facturas where id = '${p1}') = (select huella from hub.facturas where id = '${p2}')`) === 't', 'facturas: cada emitida encadena la huella de la anterior');
  ok(psql(`select cliente_nombre from hub.facturas where id = '${p1}'`) === 'Cliente portal', 'facturas: los datos del cliente se congelan al emitir');
  ok(!psql(como('authenticated', 'ana@ok.test', `update hub.facturas set total = 1 where id = '${p1}';`), { esperaError: true }).ok, 'facturas: lo emitido no se toca (ni un admin)');
  ok(!psql(como('authenticated', 'ana@ok.test', `update hub.factura_lineas set precio = 1 where factura_id = '${p1}';`), { esperaError: true }).ok, 'facturas: ni sus líneas');
  ok(!psql(como('authenticated', 'ana@ok.test', `delete from hub.facturas where id = '${p1}';`), { esperaError: true }).ok, 'facturas: ni se borra');
  ok(!psql(como('authenticated', 'ana@ok.test', `update hub.facturas set estado = 'emitida' where id = '${f1}';`), { esperaError: true }).ok, 'facturas: solo se emite con emitir_factura()');
  psql(como('authenticated', 'ana@ok.test', `insert into hub.factura_cobros (factura_id, importe) values ('${p1}', 50);`));
  ok(psql(`select cobrado from hub.facturas where id = '${p1}'`) === '50.00', 'facturas: se cobra (parcial)');
  const rid = psql(como('authenticated', 'ana@ok.test', `select hub.crear_rectificativa('${p1}', 'Precio mal puesto');`)).split('\n').pop();
  ok(psql(`select tipo || '|' || total || '|' || serie from hub.facturas where id = '${rid}'`) === 'rectificativa|-107.00|P', 'facturas: rectificativa en borrador con las líneas en negativo');
  psql(como('authenticated', 'ana@ok.test', `select hub.emitir_factura('${rid}');`));
  ok(psql(`select estado from hub.facturas where id = '${p1}'`) === 'rectificada', 'facturas: al emitir la rectificativa, la original queda rectificada');
  psql(`update hub.config set valor = 'true' where clave = 'facturacion_activa'`);
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.emitir_factura('${f1}');`), { esperaError: true }).ok, 'facturas: activada, sin los datos fiscales del emisor no emite');
  psql(`update hub.config set valor = jsonb_set(valor, '{nif}', '"B38000000"') where clave = 'facturacion_emisor'`);
  psql(como('authenticated', 'ana@ok.test', `select hub.emitir_factura('${f1}');`));
  ok(psql(`select codigo || '|' || (huella_anterior is null) from hub.facturas where id = '${f1}'`) === `F-${new Date().getFullYear()}-0001|true`, 'facturas: activada, la serie real empieza su propia cadena');
  psql(`update hub.config set valor = 'false' where clave = 'facturacion_activa'`);

  // ── Fase Final: antes del corte todo es de solo lectura ─────────────────
  const tr = psql(`insert into hub.trabajos (id, numero, descripcion, estado, tecnicos) values ('00000000-0000-0000-0000-0000000000e1', 700, 'Cambiar router', 'Pendiente', '{Tito}') returning id`).split('\n')[0];
  const noCortado = psql(como('authenticated', 'tito@ok.test', `select hub.fichar('inicio', 'trabajo', '${tr}');`), { esperaError: true });
  ok(!noCortado.ok && /app/.test(noCortado.err), 'final: sin el corte, fichar desde el hub avisa de que se hace en la app');
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_guardar_lineas('${tr}', '[]');`), { esperaError: true }).ok, 'final: sin el corte, el material tampoco');
  psql(`insert into hub.trabajos (id, numero, titulo, estado, fecha_programada) values ('00000000-0000-0000-0000-0000000000e2', 699, 'Copia de la app', 'Pendiente', current_date)`);
  ok(psql(`select count(*) from hub.agenda where trabajo_id = '00000000-0000-0000-0000-0000000000e2'`) === '0', 'paridad: sin el corte, una fecha en el trabajo no crea bloque (la agenda la trae el espejo)');
  // Chat
  const gen = psql(`select id from hub.chat_canales where nombre = 'General'`);
  psql(como('authenticated', 'tito@ok.test', `insert into hub.chat_mensajes (canal_id, texto) values ('${gen}', 'Hola equipo');`));
  ok(una('ana@ok.test', `select sin_leer || '|' || ultimo_texto from hub.chat_resumen() where id = '${gen}'`) === '1|Hola equipo', 'chat: mensaje en General, sin leer para los demás');
  const dm = psql(como('authenticated', 'tito@ok.test', `select hub.chat_directo('${anaId}');`)).split('\n').pop();
  ok(psql(como('authenticated', 'ana@ok.test', `select hub.chat_directo('${titoId}');`)).split('\n').pop() === dm, 'chat: el directo entre dos es siempre el mismo canal');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.chat_mensajes (canal_id, texto) values ('${dm}', 'Secreto');`));
  ok(una('extrano@ok.test', `select count(*) from hub.chat_mensajes`) === '0' && una('ana@ok.test', `select count(*) from hub.chat_mensajes where canal_id = '${dm}'`) === '1',
    'chat: un directo solo lo leen sus dos personas');
  ok(!psql(como('authenticated', 'ana@ok.test', `update hub.chat_mensajes set texto = 'x' where canal_id = '${dm}';`) + `\nselect 1/(select count(*) from hub.chat_mensajes where texto = 'x');`, { esperaError: true }).ok,
    'chat: nadie edita lo que escribió otro');
  // Chat por ficha (20261020): un canal por ficha; quien entra se apunta.
  const T9 = '00000000-0000-0000-0000-0000000000c9';
  const cf1 = psql(como('authenticated', 'tito@ok.test', `select hub.chat_ficha('trabajo', '${T9}', '🔧 Trabajo · #9 Router', '#/trabajos/9');`)).split('\n').pop();
  ok(una('ana@ok.test', `select count(*) from hub.chat_resumen() where id = '${cf1}'`) === '0', 'chat por ficha: quien no ha entrado no lo ve en su lista');
  const cf2 = psql(como('authenticated', 'ana@ok.test', `select hub.chat_ficha('trabajo', '${T9}', 'otro nombre', '#/trabajos/9');`)).split('\n').pop();
  ok(cf1 === cf2 && psql(`select cardinality(miembros) from hub.chat_canales where id = '${cf1}'`) === '2', 'chat por ficha: un solo canal por ficha y quien entra se apunta');
  ok(una('ana@ok.test', `select r.tipo || '|' || c.ficha_ruta from hub.chat_resumen() r join hub.chat_canales c using (id) where r.id = '${cf1}'`) === 'ficha|#/trabajos/9', 'chat por ficha: sale en la lista y lleva la ruta para volver a la ficha');
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.chat_ficha('trabajo', '${T9}', 'x', 'javascript:alert(1)');`), { esperaError: true }).ok
    && !psql(como('authenticated', 'tito@ok.test', `select hub.chat_ficha('cliente', '${T9}', 'x', '#/clientes/1');`), { esperaError: true }).ok, 'chat por ficha: ruta y tipo validados');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.chat_mensajes (canal_id, texto) values ('${cf1}', 'Llevo el router');`));
  ok(una('extrano@ok.test', `select count(*) from hub.chat_mensajes where canal_id = '${cf1}'`) === '0', 'chat por ficha: fuera del hub no se lee');
  // Tablero (20261020): sin el corte no se escribe.
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.tablero_notas (user_id, titulo) values ('${titoId}', 'Antes');`), { esperaError: true }).ok, 'tablero: sin el corte no se escribe');

  ok(psql(`select 'plantillas_trabajo' = any (tablas) from hub.areas where area = 'trabajos'`) === 't'
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.plantillas_trabajo (nombre) values ('Antes del corte');`), { esperaError: true }).ok,
    'plantillas (20261019): van con el área trabajos y sin el corte no se escriben');
  ok(psql(`select 'local_telefonos' = any (tablas) from hub.areas where area = 'clientes'`) === 't'
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.local_telefonos (numero) values ('600000000');`), { esperaError: true }).ok,
    'teléfonos de la sede (20261021): van con el área clientes y sin el corte no se escriben');
  ok(psql(`select count(*) from hub.areas, unnest(tablas) t where area = 'clientes' and t in ('local_software', 'local_hardware', 'local_camaras', 'rmm_despliegues', 'plan_tareas', 'sitio_tarea_seguimiento')`) === '6'
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.local_hardware (nombre) values ('TPV');`), { esperaError: true }).ok,
    'equipamiento de la sede (20261022): en el área clientes y sin el corte no se escribe');
  const pres = psql(`insert into hub.presupuestos (titulo, estado, cliente_id) values ('Cámaras bar', 'Aceptado', '00000000-0000-0000-0000-0000000000c1') returning id;`).split('\n').pop();
  ok(!psql(como('authenticated', 'ana@ok.test', `select hub.presupuesto_guardar_lineas('${pres}', '[{"nombre":"Cámara","cantidad":2,"precio":100}]');`), { esperaError: true }).ok
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.presupuesto_plantillas (nombre) values ('x');`), { esperaError: true }).ok,
    'presupuestos (20261023): sin el corte, ni líneas ni plantillas');
  ok(psql(`select dueno || '|' || array_length(tablas, 1) from hub.areas where area = 'mantenimiento'`) === 'app|10'
    && !psql(`set role service_role; select hub.siguiente_numero_mant(2026);`, { esperaError: true }).ok
    && !psql(como('authenticated', 'ana@ok.test', `update hub.mant_config set zoho_notas = 'x' where id returning id;`)).split('\n').pop().startsWith('t')
    && !psql(como('authenticated', 'tito@ok.test', `insert into hub.contratos (token, plan_nombre, cuerpo_html) values ('t0', 'Basic', '<p>x</p>');`), { esperaError: true }).ok
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.planes_mantenimiento (nombre) values ('Basic');`), { esperaError: true }).ok
    && !psql(como('authenticated', 'tito@ok.test', `insert into hub.mant_seguimiento (estado) values ('contactado');`), { esperaError: true }).ok,
    'mantenimiento (20261024-26): área de la app con contratos y cobros; sin el corte no se escribe ni se gasta un número de serie');
  psql(`update hub.areas set dueno = 'hub' where area = 'presupuestos';`);
  const tot = psql(como('authenticated', 'tito@ok.test', `select hub.presupuesto_guardar_lineas('${pres}', '[{"nombre":"Cámara","cantidad":2,"precio":100,"descuento":10},{"nombre":"Instalación","precio":50},{"nombre":"  "}]');`)).split('\n').pop();
  ok(Number(tot) === 230 && psql(`select total from hub.presupuestos where id = '${pres}'`) === '230.00' && psql(`select count(*) from hub.documento_lineas where presupuesto_id = '${pres}'`) === '2',
    `presupuestos: con su área, las líneas se guardan (sin las vacías) y el total sale de ellas (${tot})`);
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_desde_presupuesto('${pres}', '{"descripcion":"Instalar"}');`), { esperaError: true }).ok,
    'presupuesto a trabajo: sin el área de trabajos, no');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.presupuestos where id = '${pres}';`));
  ok(psql(`select count(*) from hub.presupuestos where id = '${pres}'`) === '1', 'presupuestos: un técnico no los borra');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.presupuestos where id = '${pres}';`));
  ok(psql(`select count(*) from hub.documento_lineas where presupuesto_id = '${pres}'`) === '0', 'presupuestos: borrar uno (admin) se lleva sus líneas');
  psql(`update hub.areas set dueno = 'app' where area = 'presupuestos';`);

  // ── Reloj: vinculación por código, huella del token y fichar a nombre de la persona ──
  const [rtok, rcod] = psql(como('service_role', null, `select token || '|' || codigo from hub.reloj_iniciar();`)).split('\n').pop().split('|');
  ok(rtok.startsWith('okr_') && /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(rcod), 'reloj: el reloj recibe token y código corto');
  ok(!psql(como('authenticated', 'tito@ok.test', `select * from hub.reloj_iniciar();`), { esperaError: true }).ok
    && !psql(como('authenticated', 'tito@ok.test', `select * from hub.reloj_validar('${rtok}');`), { esperaError: true }).ok,
    'reloj: iniciar y validar son solo de la función (service_role)');
  ok(psql(`select count(*) from hub.reloj_dispositivos where huella = '${rtok}'`) === '0', 'reloj: se guarda la huella, no el token');
  ok(psql(como('service_role', null, `select estado || ':' || coalesce(email, '-') from hub.reloj_validar('${rtok}');`)).split('\n').pop() === 'pendiente:-',
    'reloj: sin aprobar, el token está pendiente y no es de nadie');
  ok(psql(como('authenticated', 'tito@ok.test', `select count(*) from hub.reloj_dispositivos;`)).split('\n').pop() === '0', 'reloj: un pendiente no lo ve nadie');
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.reloj_aprobar('ZZZ-ZZZ');`), { esperaError: true }).ok, 'reloj: un código que no existe no vincula');
  psql(como('authenticated', 'tito@ok.test', `select hub.reloj_aprobar('${rcod.toLowerCase().replace('-', ' ')}', 'Watch de Tito');`));
  ok(psql(como('service_role', null, `select estado || ':' || email || ':' || dispositivo from hub.reloj_validar('${rtok}');`)).split('\n').pop() === 'ok:tito@ok.test:Watch de Tito',
    'reloj: al teclear el código (sin guion ni mayúsculas) el token es de esa persona');
  ok(psql(`select count(*) from hub.reloj_dispositivos where codigo is not null`) === '0', 'reloj: el código no se reutiliza');
  ok(psql(como('authenticated', 'ana@ok.test', `select count(*) from hub.reloj_dispositivos;`)).split('\n').pop() === '1'
    && psql(como('authenticated', 'pepa@ok.test', `select count(*) from hub.reloj_dispositivos;`)).split('\n').pop() === '0',
    'reloj: lo ve su dueño y un admin, nadie más');
  const titoReloj = psql(`select id from hub.usuarios where email = 'tito@ok.test'`);
  ok(!psql(como('service_role', null, `select hub.reloj_fichar('${titoReloj}', 'traslado');`), { esperaError: true }).ok,
    'reloj: con el fichaje en la app, fichar desde el reloj no escribe');
  ok(psql(como('authenticated', 'tito@ok.test', `insert into hub.comandas (transcripcion, origen) values ('del reloj', 'reloj') returning origen;`)).split('\n').pop() === 'reloj',
    'reloj: una comanda puede venir del reloj');

  // ── Corte final (preparado, NO aplicado en producción): se prueba aquí ──
  psql(`begin;
${readFileSync('supabase/cortes/corte_final.sql', 'utf8')}
commit;`);
  ok(psql(`select count(*) from hub.areas where dueno = 'app'`) === '0', 'corte final: todas las áreas pasan al hub');
  psql(`insert into hub.furgoneta_inventario (id, nombre, cantidad) values ('00000000-0000-0000-0000-0000000000b9', 'Router', 2)`);
  const fch = psql(como('authenticated', 'tito@ok.test', `select hub.fichar('traslado');`)).split('\n').pop();
  ok(fch.includes('"ok": true'), 'corte final: fichar el traslado');
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.fichar('traslado');`), { esperaError: true }).ok, 'fichar: no hay dos sesiones abiertas');
  psql(como('authenticated', 'tito@ok.test', `select hub.fichar('inicio', 'trabajo', '${tr}');`));
  ok(psql(`select count(*) || '|' || bool_and(inicio is not null and traslado is not null) from hub.sesiones where entidad_id = '${tr}'`) === '1|true'
    && psql(`select estado from hub.trabajos where id = '${tr}'`) === 'En progreso', 'fichar: el inicio reusa el traslado y pone el trabajo en progreso');
  psql(`insert into hub.tickets (id, titulo, estado, trabajo_id) values ('00000000-0000-0000-0000-0000000000f1', 'Sin wifi', 'Abierto', '${tr}')`);
  ok(!psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_estado('${tr}', 'Completado');`), { esperaError: true }).ok, 'trabajo: no se completa sin fichar el fin');
  psql(como('authenticated', 'tito@ok.test', `select hub.fichar('fin');`));
  psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_estado('${tr}', 'Completado');`));
  ok(psql(`select estado from hub.trabajos where id = '${tr}'`) === 'Completado', 'trabajo: con inicio y fin, se completa');
  ok(psql(`select estado from hub.tickets where id = '00000000-0000-0000-0000-0000000000f1'`) === 'Cerrado', 'paridad: completar el trabajo cierra su ticket abierto');
  psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_guardar_lineas('${tr}', '[{"nombre":"Router","cantidad":3,"precio":40,"inventario_id":"00000000-0000-0000-0000-0000000000b9"},{"nombre":"Mano de obra","cantidad":1,"precio":35}]');`));
  ok(psql(`select cantidad from hub.furgoneta_inventario where id = '00000000-0000-0000-0000-0000000000b9'`) === '0'
    && psql(`select tipo || cantidad || (trabajo_id = '${tr}') from hub.furgoneta_movimientos where producto_id = '00000000-0000-0000-0000-0000000000b9'`) === 'salida2true',
    'material: gastar 3 con 2 en stock deja 0 y apunta la salida REAL (2) con el trabajo');
  psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_guardar_lineas('${tr}', '[{"nombre":"Router","cantidad":1,"precio":40,"inventario_id":"00000000-0000-0000-0000-0000000000b9"}]');`));
  ok(psql(`select cantidad from hub.furgoneta_inventario where id = '00000000-0000-0000-0000-0000000000b9'`) === '2'
    && psql(`select count(*) from hub.documento_lineas where trabajo_id = '${tr}'`) === '1', 'material: bajar de 3 a 1 devuelve 2 al stock');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.trabajos where id = '${tr}';`));
  ok(psql(`select cantidad from hub.furgoneta_inventario where id = '00000000-0000-0000-0000-0000000000b9'`) === '3', 'material: borrar el trabajo devuelve lo que tenía');
  const rfch = psql(como('service_role', null, `select hub.reloj_fichar(id, 'traslado') from hub.usuarios where email = 'tito@ok.test';`)).split('\n').pop();
  ok(rfch.includes('"ok": true') && psql(`select tecnico_nombre from hub.sesiones where fin is null order by created_at desc limit 1`) === 'Tito'
    && psql(`select usuario_email from hub.auditoria where tabla = 'sesiones' order by id desc limit 1`) === 'tito@ok.test',
    'reloj: tras el corte, ficha a nombre de la persona y la auditoría la apunta');
  ok(!psql(como('service_role', null, `select hub.reloj_fichar(id, 'traslado') from hub.usuarios where email = 'tito@ok.test';`), { esperaError: true }).ok,
    'reloj: las reglas son las de hub.fichar (no hay dos sesiones abiertas)');
  psql(como('authenticated', 'tito@ok.test', `select hub.reloj_revocar(id) from hub.reloj_dispositivos;`));
  ok(psql(como('service_role', null, `select count(*) from hub.reloj_validar('${rtok}');`)).split('\n').pop() === '0', 'reloj: desvinculado deja de valer');
  ok(psql(`select count(*) from cron.job where jobname in ('hub-sync-app', 'hub-sync-app-completo')`) === '0', 'corte final: el sync con la app se apaga');
  const nt = psql(como('authenticated', 'ana@ok.test', `insert into hub.trabajos (descripcion) values ('Nuevo tras el corte') returning numero;`)).split('\n').pop();
  ok(Number(nt) > 700, `corte final: los trabajos nuevos siguen la numeración (${nt})`);
  // Paridad (20261018): marcar en la lista del día cierra el origen con las reglas de la app.
  const tl = psql(como('authenticated', 'ana@ok.test', `insert into hub.trabajos (titulo, estado) values ('Sin fichar', 'Pendiente') returning id;`)).split('\n').pop();
  const tkl = psql(como('authenticated', 'ana@ok.test', `insert into hub.tickets (titulo, estado) values ('Lista', 'En curso') returning id;`)).split('\n').pop();
  const l1 = psql(como('authenticated', 'ana@ok.test', `insert into hub.lista_dia (usuario, tipo, ref_id) values ('Tito', 'trabajo', '${tl}') returning id;`)).split('\n').pop();
  const l2 = psql(como('authenticated', 'ana@ok.test', `insert into hub.lista_dia (usuario, tipo, ref_id) values ('Tito', 'ticket', '${tkl}') returning id;`)).split('\n').pop();
  const av = psql(como('authenticated', 'tito@ok.test', `select hub.lista_dia_marcar('${l1}', true);`)).split('\n').pop();
  ok(av.includes('fichar') && psql(`select estado from hub.trabajos where id = '${tl}'`) === 'Pendiente' && psql(`select completado from hub.lista_dia where id = '${l1}'`) === 't',
    'lista del día: sin fichaje se marca en la lista pero el trabajo no se cierra (y avisa)');
  psql(como('authenticated', 'tito@ok.test', `select hub.lista_dia_marcar('${l2}', true);`));
  ok(psql(`select estado from hub.tickets where id = '${tkl}'`) === 'Cerrado' && psql(`select estado_previo from hub.lista_dia where id = '${l2}'`) === 'En curso', 'lista del día: marcar cierra el ticket y guarda su estado');
  psql(como('authenticated', 'tito@ok.test', `select hub.lista_dia_marcar('${l2}', false);`));
  ok(psql(`select estado from hub.tickets where id = '${tkl}'`) === 'En curso', 'lista del día: desmarcar lo devuelve a como estaba');
  psql(como('authenticated', 'ana@ok.test', `delete from hub.tickets where id = '${tkl}';`));
  ok(psql(`select count(*) from hub.lista_dia where ref_id = '${tkl}'`) === '0', 'lista del día: borrar el origen se lleva su fila');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.plantillas_trabajo (nombre, tipo, duracion_teorica, checklist) values ('Instalar TPV', 'Instalación', 120, '[{"texto":"Probar impresora","completado":false}]');`));
  ok(psql(`select tipo || '|' || jsonb_array_length(checklist) || '|' || activa from hub.plantillas_trabajo where nombre = 'Instalar TPV'`) === 'Instalación|1|true',
    'plantillas: tras el corte se crean (con sus pasos)');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.local_telefonos (local_id, nombre, numero, rol) values ('00000000-0000-0000-0000-0000000000c1', 'Pepe', '600111222', 'dueno');`));
  ok(psql(`select rol from hub.local_telefonos where numero = '600111222'`) === 'dueno' && psql(`select count(*) from hub.auditoria where tabla = 'local_telefonos'`) !== '0',
    'teléfonos de la sede: tras el corte se apuntan (con su rol) y quedan en la auditoría');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.local_camaras (local_id, marca, contrasena) values ('00000000-0000-0000-0000-0000000000c1', 'Hikvision', 'x');
    insert into hub.local_software (local_id, nombre, fecha_caducidad_certificado) values ('00000000-0000-0000-0000-0000000000c1', 'Glop', '2027-01-31');`));
  ok(psql(`select count(*) from hub.local_camaras where marca = 'Hikvision'`) === '1' && psql(`select count(*) from hub.auditoria where tabla = 'local_software'`) !== '0',
    'equipamiento: tras el corte se apunta (y queda en la auditoría)');
  ok(!psql(como('authenticated', 'ana@ok.test', `insert into hub.rmm_despliegues (local_id, rustdesk_password) values ('00000000-0000-0000-0000-0000000000c1', 'x');`), { esperaError: true }).ok
    && psql(`select count(*) from information_schema.triggers where event_object_schema = 'hub' and event_object_table = 'rmm_despliegues'`) === '0',
    'contraseñas de RustDesk: solo lectura también tras el corte, y fuera de la auditoría');
  const pt = psql(`insert into hub.plan_tareas (plan, nombre, periodicidad) values ('Silver', 'Revisar copia', 'mensual') returning id;`).split('\n').pop();
  psql(como('authenticated', 'tito@ok.test', `insert into hub.sitio_tarea_seguimiento (local_id, tarea_id, periodo) values ('00000000-0000-0000-0000-0000000000c1', '${pt}', '2026-10');`));
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.sitio_tarea_seguimiento (local_id, tarea_id, periodo) values ('00000000-0000-0000-0000-0000000000c1', '${pt}', '2026-10');`), { esperaError: true }).ok,
    'seguimiento: una marca por sede, tarea y periodo');
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.planes_mantenimiento (nombre, precio_mensual) values ('Basic', 35);`), { esperaError: true }).ok
    && psql(como('authenticated', 'ana@ok.test', `insert into hub.planes_mantenimiento (nombre, precio_mensual) values ('Basic', 35) returning nombre;`)).split('\n').pop() === 'Basic',
    'planes de mantenimiento: tras el corte solo un admin los cambia');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.mant_seguimiento (estado, notas) values ('interesado', 'Llamar el lunes');`));
  ok(psql(`select count(*) from hub.mant_seguimiento where estado = 'interesado'`) === '1', 'seguimiento comercial: tras el corte, cualquiera del equipo');
  const nl = psql(como('authenticated', 'tito@ok.test', `insert into hub.locales (nombre) values ('Sede con código') returning id;`)).split('\n').pop();
  ok(/^\d{6}$/.test(psql(`select codigo_verificacion from hub.locales where id = '${nl}'`)), 'código de verificación: una sede nueva del hub nace con sus 6 cifras');
  psql(como('authenticated', 'tito@ok.test', `insert into hub.local_software (local_id, nombre, fecha_caducidad_certificado) values ('${nl}', 'Glop', '2027-05-01');
    insert into hub.local_software (local_id, nombre, fecha_caducidad_certificado) values ('${nl}', 'Viejo', '2026-01-01');`));
  ok(psql(`select cert_caducidad from hub.locales where id = '${nl}'`) === '2027-05-01', 'certificado: la caducidad del software sube a la sede (la más tardía)');
  const ctr = psql(como('authenticated', 'tito@ok.test', `insert into hub.contratos (token, plan_nombre, cuerpo_html, local_id, precio_mensual) values ('tk1', 'Premium', '<p>x</p>', '${nl}', 49) returning id;`)).split('\n').pop();
  psql(`update hub.contratos set estado = 'firmado', firmado_at = '2026-10-31T23:30:00Z' where id = '${ctr}'`);
  ok(psql(`select fecha_inicio || '|' || vigencia_meses || '|' || renovacion_automatica from hub.contratos where id = '${ctr}'`) === '2026-10-31|12|true',
    'contratos: al firmar, la fecha de inicio es el día de Canarias (renueva al año, sola)');
  psql(como('authenticated', 'tito@ok.test', `delete from hub.contratos where id = '${ctr}';`));
  ok(psql(`select count(*) from hub.contratos where id = '${ctr}'`) === '1', 'contratos: solo un admin los borra');
  ok(psql(`set role service_role; select hub.siguiente_numero_mant(2026); select hub.siguiente_numero_mant(2026);`).split('\n').pop() === 'MANT-2026-0002'
    && psql(`set role service_role; select hub.siguiente_numero_abono(2027);`).split('\n').pop() === 'ABONO-2027-0001',
    'cobros (20261026): tras el corte, las series MANT- y ABONO- siguen su contador por año');
  ok(!psql(como('authenticated', 'ana@ok.test', `insert into hub.mant_facturas (importe) values (10);`), { esperaError: true }).ok
    && !psql(como('authenticated', 'ana@ok.test', `select hub.siguiente_numero_mant(2026);`), { esperaError: true }).ok,
    'cobros: el libro de cuotas y la serie, solo las funciones (ni un admin a mano)');
  psql(como('authenticated', 'tito@ok.test', `update hub.mant_config set zoho_notas = 'tito' where id;`));
  psql(como('authenticated', 'ana@ok.test', `update hub.mant_config set pago_metodos = '{sepa}' where id;`));
  ok(psql(`select coalesce(zoho_notas, '-') || '|' || array_to_string(pago_metodos, ',') from hub.mant_config`) === '-|sepa', 'cobros: los ajustes, solo un admin');
  const mf = psql(`insert into hub.mant_facturas (local_id, importe, estado) values ('${nl}', 52.43, 'pagada') returning id;`).split('\n').pop();
  psql(`insert into hub.mant_abonos (factura_id, motivo, importe) values ('${mf}', 'Cambio de plan', 5.92);`);
  ok(psql(`select abonado || '|' || abonable from hub.mant_facturas_abonadas where factura_id = '${mf}'`) === '5.92|46.51'
    && psql(`select ultima_factura_estado from hub.mant_cobros_estado where local_id = '${nl}'`) === 'pagada',
    'cobros: lo abonado y lo que queda por abonar; la última cuota en el cuadro de cobros');
  const pres2 = psql(`insert into hub.presupuestos (titulo, cliente_id, local_id) values ('Alarma', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1') returning id;`).split('\n').pop();
  psql(como('authenticated', 'tito@ok.test', `select hub.presupuesto_guardar_lineas('${pres2}', '[{"nombre":"Hub alarma","precio":180}]');`));
  const nuevoT = psql(como('authenticated', 'tito@ok.test', `select hub.trabajo_desde_presupuesto('${pres2}', '{"descripcion":"Instalar alarma","tipo":"Instalación","fecha":"2026-11-02","tecnicos":["Tito"]}');`)).split('\n').pop();
  const tidP = JSON.parse(nuevoT).id;
  ok(psql(`select presupuesto_id || '|' || tipo || '|' || array_to_string(tecnicos, ',') || '|' || fecha_programada from hub.trabajos where id = '${tidP}'`) === `${pres2}|Instalación|Tito|2026-11-02`
    && psql(`select count(*) from hub.documento_lineas where trabajo_id = '${tidP}' and nombre = 'Hub alarma'`) === '1' && JSON.parse(nuevoT).numero > 0,
    'presupuesto a trabajo: tras el corte, el trabajo nace con el presupuesto, sus datos y una copia de las líneas');
  const nota = psql(como('authenticated', 'tito@ok.test', `insert into hub.tablero_notas (user_id, titulo) values ('${titoId}', 'Comprar bridas') returning id;`)).split('\n').pop();
  ok(!psql(como('authenticated', 'tito@ok.test', `insert into hub.tablero_notas (user_id, titulo) values ('${anaId}', 'A nombre de otra');`), { esperaError: true }).ok, 'tablero: nadie apunta notas a nombre de otro');
  psql(como('authenticated', 'ana@ok.test', `update hub.tablero_notas set titulo = 'Pisada' where id = '${nota}'; delete from hub.tablero_notas where id = '${nota}';`));
  ok(psql(`select titulo from hub.tablero_notas where id = '${nota}'`) === 'Comprar bridas' && una('ana@ok.test', `select count(*) from hub.tablero_notas where id = '${nota}'`) === '1',
    'tablero: todos la ven y solo su autor la cambia o la borra');

  // Paridad (20261017): el trabajo manda su fecha a la agenda y la agenda la devuelve.
  const ta = psql(como('authenticated', 'ana@ok.test', `insert into hub.trabajos (titulo, fecha_programada, hora_llegada, duracion_teorica, tecnicos)
    values ('Cámaras', '2026-11-02', '2026-11-02 10:00+00', 90, '{Tito}') returning id;`)).split('\n').pop();
  ok(psql(`select count(*) || '|' || min(inicio)::text || '|' || min(fin)::text || '|' || min(tecnicos::text) from hub.agenda where trabajo_id = '${ta}'`)
    === '1|2026-11-02 10:00:00+00|2026-11-02 11:30:00+00|{Tito}', 'paridad: el alta con fecha crea su bloque (hora, duración y técnicos)');
  psql(como('authenticated', 'ana@ok.test', `update hub.trabajos set fecha_programada = '2026-11-04', hora_llegada = '2026-11-04 08:00+00' where id = '${ta}';`));
  ok(psql(`select min(inicio)::text from hub.agenda where trabajo_id = '${ta}'`) === '2026-11-04 08:00:00+00', 'paridad: cambiar la fecha del trabajo mueve su bloque');
  psql(como('authenticated', 'ana@ok.test', `insert into hub.agenda (trabajo_id, inicio, fin) values ('${ta}', '2026-11-05 08:00+00', '2026-11-05 12:00+00');`));
  psql(como('authenticated', 'ana@ok.test', `update hub.trabajos set fecha_programada = '2026-11-06' where id = '${ta}';`));
  ok(psql(`select string_agg((inicio at time zone 'Atlantic/Canary')::date::text, ',' order by inicio) from hub.agenda where trabajo_id = '${ta}'`) === '2026-11-06,2026-11-07',
    'paridad: con dos días, cambiar la fecha desplaza los dos');
  ok(psql(`select fecha_programada::text from hub.trabajos where id = '${ta}'`) === '2026-11-06', 'paridad: y el trabajo queda con la fecha de su primer bloque');

  // WhatsApp (paridad bloque 5): ¿de quién es el número?, por los últimos 9 dígitos; lo demás, solo la service key.
  ok(psql(`select count(*) from hub.wa_buscar_por_telefono('0034 600-11-12-22')`) === '1' && psql(`select count(*) from hub.wa_buscar_por_telefono('123')`) === '0',
    'whatsapp: el teléfono se reconoce por los últimos 9 dígitos (y uno corto no casa con nada)');
  ok(!psql(como('authenticated', 'tito@ok.test', `select * from hub.wa_locales_autorizados('600111222', null);`), { esperaError: true }).ok
    && !psql(como('authenticated', 'ana@ok.test', `insert into hub.wa_mensajes (conversacion_id, direccion) values (gen_random_uuid(), 'saliente');`), { esperaError: true }).ok,
    'whatsapp: los códigos de las sedes y los mensajes, solo las funciones');
  ok(psql(`select array_to_string(tablas, ',') from hub.areas where area = 'whatsapp'`) === 'wa_conversaciones,wa_mensajes'
    && psql(`select 'ticket_adjuntos' = any (tablas) from hub.areas where area = 'tickets'`) === 't', 'whatsapp: área propia y los adjuntos con los tickets');

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
