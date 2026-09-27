-- ════════════════════════════════════════════════════════════════════════
-- Fase 5 · El tipo `vector` sin tocar Breeze.
--
-- `public` (de Breeze) está cerrado: ni authenticated ni service_role tienen
-- USAGE (regla 1 de CLAUDE.md, y así se queda). Por eso nadie fuera de
-- postgres puede escribir ni recibir valores de tipo public.vector por
-- PostgREST. Todo lo que toca el tipo va por funciones del hub propiedad de
-- postgres, que reciben el vector como TEXTO ('[0.1,0.2,…]') y lo convierten
-- dentro:
--   · hub.guardar_fragmentos(documento, trozos jsonb)  (solo service_role)
--   · hub.buscar_fragmentos(texto_vector, texto, k)    (sustituye a la de
--     20261009_wiki.sql, que recibía public.vector)
-- ════════════════════════════════════════════════════════════════════════

create or replace function hub.guardar_fragmentos(p_documento uuid, p_trozos jsonb)
returns integer language plpgsql security definer set search_path = hub as $fn$
declare n integer;
begin
  delete from hub.documentos_fragmentos where documento_id = p_documento;
  insert into hub.documentos_fragmentos (documento_id, orden, texto, embedding)
  select p_documento, (t->>'orden')::int, t->>'texto', (t->>'embedding')::public.vector(384)
    from jsonb_array_elements(coalesce(p_trozos, '[]')) t;
  get diagnostics n = row_count;
  return n;
end
$fn$;
revoke execute on function hub.guardar_fragmentos(uuid, jsonb) from public, anon, authenticated;
grant execute on function hub.guardar_fragmentos(uuid, jsonb) to service_role;

drop function if exists hub.buscar_fragmentos(public.vector, text, integer);
create or replace function hub.buscar_fragmentos(p_embedding text, p_texto text, p_k integer default 8)
returns table (fragmento_id bigint, documento_id uuid, titulo text, url text, fuente text, texto text, puntos double precision)
language plpgsql stable security definer set search_path = hub as $fn$
declare v public.vector(384) := p_embedding::public.vector(384);
begin
  if not (coalesce(auth.jwt()->>'role', '') = 'service_role' or hub.es_usuario()) then return; end if;
  return query
  with sem as (
    select f.id, row_number() over (order by f.embedding operator(public.<=>) v) as r
      from hub.documentos_fragmentos f
     order by f.embedding operator(public.<=>) v
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
revoke execute on function hub.buscar_fragmentos(text, text, integer) from public, anon;
grant execute on function hub.buscar_fragmentos(text, text, integer) to authenticated, service_role;
