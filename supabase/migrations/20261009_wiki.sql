-- ════════════════════════════════════════════════════════════════════════
-- Fase 5 · Wiki y buscador de documentos (sustituye Notion).
--
-- · hub.paginas: páginas en árbol (padre_id), markdown, enlazables a un
--   proyecto o cliente, con historial (hub.paginas_versiones: cada cambio de
--   título o contenido guarda la versión anterior) y búsqueda de texto
--   (tsvector en español).
-- · Buscador por significado (RAG): hub.documentos (qué se ha indexado: wiki,
--   Drive, conocimiento y tablero de la app) y hub.documentos_fragmentos
--   (trozos con su embedding de 384 dimensiones, gte-small). Los rellena la
--   función documentos-indexar; documentos-preguntar busca aquí
--   (hub.buscar_fragmentos: significado + palabras) y Claude redacta citando.
-- · Espejo de conocimiento y tablero_notas de la app (dueño app: solo se leen
--   y se indexan).
--
-- La extensión `vector` vive en el esquema de Breeze (decisión de Fran,
-- docs/DECISIONES_FASES.md): aquí solo se usa su tipo y su operador <=>, sin
-- crear ni cambiar nada allí (comprobar-migraciones lo permite solo para eso).
-- ════════════════════════════════════════════════════════════════════════

-- ── Páginas ─────────────────────────────────────────────────────────────
create table if not exists hub.paginas (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  titulo          text not null check (length(btrim(titulo)) > 0),
  contenido       text not null default '',
  padre_id        uuid references hub.paginas(id) on delete set null,
  orden           integer not null default 0,
  icono           text,
  proyecto_id     uuid references hub.proyectos(id) on delete set null,
  cliente_id      uuid,
  archivada       boolean not null default false,
  version         integer not null default 1,
  creado_por      uuid default (hub.usuario_actual()).id references hub.usuarios(id) on delete set null,
  actualizado_por uuid references hub.usuarios(id) on delete set null,
  tsv             tsvector generated always as (
                    setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') ||
                    setweight(to_tsvector('spanish', coalesce(contenido, '')), 'B')) stored
);
create index if not exists paginas_padre_idx on hub.paginas (padre_id, orden);
create index if not exists paginas_tsv_idx on hub.paginas using gin (tsv);
create index if not exists paginas_proyecto_idx on hub.paginas (proyecto_id);

create table if not exists hub.paginas_versiones (
  id          bigint generated always as identity primary key,
  pagina_id   uuid not null references hub.paginas(id) on delete cascade,
  version     integer not null,
  titulo      text not null,
  contenido   text not null,
  autor       uuid references hub.usuarios(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (pagina_id, version)
);

-- Cada cambio de título o contenido: la versión anterior al historial.
-- Y ningún ciclo en el árbol (una página no puede colgar de sí misma ni de
-- una de sus hijas).
create or replace function hub.pagina_antes()
returns trigger language plpgsql security definer set search_path = hub as $fn$
declare v uuid; n int := 0;
begin
  if new.padre_id is not null then
    v := new.padre_id;
    while v is not null and n < 50 loop
      if v = new.id then raise exception 'Una página no puede ir dentro de sí misma'; end if;
      select padre_id into v from hub.paginas where id = v;
      n := n + 1;
    end loop;
  end if;
  new.updated_at := now();
  new.actualizado_por := coalesce((hub.usuario_actual()).id, new.actualizado_por);
  if tg_op = 'UPDATE' and (new.titulo is distinct from old.titulo or new.contenido is distinct from old.contenido) then
    insert into hub.paginas_versiones (pagina_id, version, titulo, contenido, autor)
    values (old.id, old.version, old.titulo, old.contenido, old.actualizado_por)
    on conflict (pagina_id, version) do nothing;
    new.version := old.version + 1;
  end if;
  return new;
end
$fn$;
drop trigger if exists antes on hub.paginas;
create trigger antes before insert or update on hub.paginas for each row execute function hub.pagina_antes();

alter table hub.paginas enable row level security;
grant select, insert, update, delete on hub.paginas to authenticated;
grant all on hub.paginas to service_role;
drop policy if exists leer on hub.paginas;
create policy leer on hub.paginas for select to authenticated using ((select hub.es_usuario()));
drop policy if exists crear on hub.paginas;
create policy crear on hub.paginas for insert to authenticated with check ((select hub.es_usuario()));
drop policy if exists cambiar on hub.paginas;
create policy cambiar on hub.paginas for update to authenticated using ((select hub.es_usuario())) with check ((select hub.es_usuario()));
drop policy if exists borrar on hub.paginas;
create policy borrar on hub.paginas for delete to authenticated
  using ((select hub.es_admin()) or creado_por = (select (hub.usuario_actual()).id));
select hub.auditar('paginas');

alter table hub.paginas_versiones enable row level security;
revoke insert, update, delete on hub.paginas_versiones from authenticated;
grant select on hub.paginas_versiones to authenticated;
grant all on hub.paginas_versiones to service_role;
drop policy if exists leer on hub.paginas_versiones;
create policy leer on hub.paginas_versiones for select to authenticated using ((select hub.es_usuario()));

-- ── Espejo de conocimiento y tablero de notas de la app ─────────────────
create table if not exists hub.conocimiento (
  id              uuid primary key,
  created_at      timestamptz,
  titulo          text not null,
  categoria       text,
  tipo            text,
  descripcion     text,
  url             text,
  palabras_clave  text
);
create table if not exists hub.tablero_notas (
  id          uuid primary key,
  user_id     uuid,
  titulo      text not null,
  descripcion text,
  created_at  timestamptz,
  updated_at  timestamptz
);
insert into hub.areas (area, tablas, notas) values
  ('conocimiento', '{conocimiento,tablero_notas}', 'Fase 5: se leen y se indexan en el buscador; la wiki del hub es lo nuevo')
on conflict (area) do nothing;
do $$
declare t text;
begin
  foreach t in array array['conocimiento', 'tablero_notas'] loop
    execute format('grant select, insert, update, delete on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('alter table hub.%I enable row level security', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
    execute format('drop policy if exists escribir on hub.%I', t);
    execute format('create policy escribir on hub.%I for all to authenticated
                      using ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))
                      with check ((select hub.es_usuario()) and hub.tabla_es_del_hub(%L))', t, t, t);
    perform hub.auditar(t);
  end loop;
end $$;

-- ── Índice del buscador ─────────────────────────────────────────────────
create table if not exists hub.documentos (
  id             uuid primary key default gen_random_uuid(),
  fuente         text not null check (fuente in ('wiki', 'drive', 'app')),
  ref            text not null,               -- id de la página, del fichero de Drive o 'conocimiento:<id>'
  titulo         text not null,
  url            text,                        -- #/wiki/<id> o el enlace de Drive
  mime           text,
  modificado_at  timestamptz,                 -- cuándo cambió en su origen
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'indexado', 'error', 'omitido')),
  error          text,
  fragmentos     integer not null default 0,
  indexado_at    timestamptz,
  unique (fuente, ref)
);
create index if not exists documentos_estado_idx on hub.documentos (estado);

create table if not exists hub.documentos_fragmentos (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null references hub.documentos(id) on delete cascade,
  orden         integer not null,
  texto         text not null,
  embedding     public.vector(384) not null,
  tsv           tsvector generated always as (to_tsvector('spanish', texto)) stored
);
create index if not exists fragmentos_doc_idx on hub.documentos_fragmentos (documento_id, orden);
create index if not exists fragmentos_tsv_idx on hub.documentos_fragmentos using gin (tsv);
create index if not exists fragmentos_emb_idx on hub.documentos_fragmentos using hnsw (embedding vector_cosine_ops);

do $$
declare t text;
begin
  foreach t in array array['documentos', 'documentos_fragmentos'] loop
    execute format('alter table hub.%I enable row level security', t);
    execute format('revoke insert, update, delete on hub.%I from authenticated', t);
    execute format('grant select on hub.%I to authenticated', t);
    execute format('grant all on hub.%I to service_role', t);
    execute format('drop policy if exists leer on hub.%I', t);
    execute format('create policy leer on hub.%I for select to authenticated using ((select hub.es_usuario()))', t);
  end loop;
end $$;

-- Búsqueda híbrida: por significado (distancia coseno) y por palabras, y se
-- juntan por posición (reciprocal rank fusion). Devuelve los k mejores trozos.
create or replace function hub.buscar_fragmentos(p_embedding public.vector(384), p_texto text, p_k integer default 8)
returns table (fragmento_id bigint, documento_id uuid, titulo text, url text, fuente text, texto text, puntos double precision)
language plpgsql stable security definer set search_path = hub as $fn$
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  return query
  with sem as (
    select f.id, row_number() over (order by f.embedding operator(public.<=>) p_embedding) as r
      from hub.documentos_fragmentos f
     order by f.embedding operator(public.<=>) p_embedding
     limit greatest(p_k, 1) * 4
  ), lex as (
    select f.id, row_number() over (order by ts_rank(f.tsv, q) desc) as r
      from hub.documentos_fragmentos f, websearch_to_tsquery('spanish', coalesce(p_texto, '')) q
     where coalesce(p_texto, '') <> '' and f.tsv @@ q
     order by ts_rank(f.tsv, q) desc
     limit greatest(p_k, 1) * 4
  ), juntos as (
    select coalesce(s.id, l.id) as id,
           coalesce(1.0 / (60 + s.r), 0) + coalesce(1.0 / (60 + l.r), 0) as p
      from sem s full join lex l on l.id = s.id
  )
  select f.id, d.id, d.titulo, d.url, d.fuente, f.texto, j.p::double precision
    from juntos j join hub.documentos_fragmentos f on f.id = j.id join hub.documentos d on d.id = f.documento_id
   order by j.p desc
   limit greatest(p_k, 1);
end
$fn$;
revoke execute on function hub.buscar_fragmentos(public.vector, text, integer) from public, anon;
grant execute on function hub.buscar_fragmentos(public.vector, text, integer) to authenticated, service_role;

-- La carpeta de Drive que se indexa (la pone un admin en Buscar → Ajustes).
insert into hub.config (clave, valor, descripcion) values
  ('drive_carpeta', 'null', 'Id de la carpeta de Google Drive que se indexa en el buscador (compartida con la cuenta de servicio del hub)')
on conflict (clave) do nothing;

-- Cada 10 minutos: la cola de indexado (páginas cambiadas, Drive cada 6 h).
select cron.schedule('hub-indexar', '*/10 * * * *', $$select hub.lanzar_funcion('documentos-indexar', '{"accion":"cola"}')$$);
