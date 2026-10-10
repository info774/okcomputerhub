-- Fusionar fichas duplicadas: clientes, contactos y sedes (idea de
-- `merge_contacts` de Atomic CRM, decisión de Fran 2026-10-10).
--
--   · hub.duplicados(tipo): grupos de fichas que PARECEN la misma (mismo NIF,
--     correo, teléfono, nombre o dirección). Solo lectura: vale ya, con las
--     áreas aún de la app. Lo que una persona marca «no son la misma» va a
--     hub.no_duplicados y deja de salir.
--   · hub.fusionar(tipo, queda, sale, probar): con probar = true (el defecto)
--     solo CUENTA: qué se mueve, qué se descarta, qué campos cambian y qué lo
--     impide. Con false lo hace, en una transacción: todo lo que colgaba de la
--     que sale pasa a la que queda, los huecos de la que queda se rellenan con
--     lo de la otra (notas juntas, teléfonos y correos de más a las notas), y
--     la que sale se BORRA (su copia queda en hub.fusiones y en la auditoría).
--     Exige admin y que TODA tabla con algo que mover sea ya del hub: con el
--     área de la app no escribe nada (PREPARADO para el corte).
--   · Zoho Books no tiene fusión por API: si los dos clientes tenían contacto
--     en Zoho, la fusión deja apuntado el de la que sale (fusiones.zoho_sale)
--     y se termina a mano en Zoho; mientras tanto hub.cliente_por_zoho() hace
--     que zoho-sync no resucite la ficha borrada.

-- ── Normalizar para comparar ─────────────────────────────────────────────
create or replace function hub.norm_texto(p text)
returns text language sql immutable set search_path = hub as $fn$
  select regexp_replace(translate(lower(coalesce(p, '')), 'áéíóúüñàèìòùâêîôûç', 'aeiouunaeiouaeiouc'), '[^a-z0-9]', '', 'g')
$fn$;

-- Nombre de empresa sin la forma jurídica del final («Bar Pepe, S.L.» = «Bar Pepe»).
create or replace function hub.norm_empresa(p text)
returns text language sql immutable set search_path = hub as $fn$
  select hub.norm_texto(regexp_replace(lower(coalesce(p, '')),
    '[\s,.]+(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?c\.?\s?p\.?|c\.?\s?b\.?|s\.?\s?l\.?\s?l\.?)\s*$', ''))
$fn$;

-- Los últimos 9 dígitos (la regla de wa_buscar_por_telefono).
create or replace function hub.norm_tel(p text)
returns text language sql immutable set search_path = hub as $fn$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9)
$fn$;

create or replace function hub.json_vacio(v jsonb)
returns boolean language sql immutable set search_path = hub as $fn$
  select v is null or jsonb_typeof(v) = 'null'
      or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
      or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0)
$fn$;

-- ── Lo que no son duplicados y lo que ya se fusionó ──────────────────────
create table if not exists hub.no_duplicados (
  tipo        text not null check (tipo in ('cliente','contacto','sede')),
  a           uuid not null,
  b           uuid not null,
  created_at  timestamptz not null default now(),
  autor_id    uuid,
  primary key (tipo, a, b),
  check (a < b)
);
alter table hub.no_duplicados enable row level security;
grant select, insert, delete on hub.no_duplicados to authenticated;
grant all on hub.no_duplicados to service_role;
drop policy if exists leer on hub.no_duplicados;
create policy leer on hub.no_duplicados for select to authenticated using ((select hub.es_usuario()));
drop policy if exists marcar on hub.no_duplicados;
create policy marcar on hub.no_duplicados for insert to authenticated with check ((select hub.es_admin()));
drop policy if exists quitar on hub.no_duplicados;
create policy quitar on hub.no_duplicados for delete to authenticated using ((select hub.es_admin()));
select hub.auditar('no_duplicados');

create table if not exists hub.fusiones (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  tipo          text not null check (tipo in ('cliente','contacto','sede')),
  queda_id      uuid not null,
  sale_id       uuid not null,
  queda_nombre  text,
  sale_nombre   text,
  sale_ficha    jsonb not null,                 -- la ficha borrada, tal cual
  movidas       jsonb not null default '{}',    -- { tabla: filas }
  descartadas   jsonb not null default '{}',    -- { tabla: filas } (la que queda ya tenía la suya)
  campos        jsonb not null default '{}',    -- { campo: [antes, después] } de la que queda
  zoho_queda    text,                           -- dos contactos de Zoho: falta fusionarlos allí
  zoho_sale     text,
  zoho_hecho_at timestamptz,
  autor_id      uuid,
  autor_nombre  text
);
create index if not exists fusiones_zoho_sale_idx on hub.fusiones (zoho_sale) where zoho_sale is not null;
create index if not exists fusiones_sale_idx on hub.fusiones (sale_id);
alter table hub.fusiones enable row level security;
grant select, update on hub.fusiones to authenticated;
grant all on hub.fusiones to service_role;
drop policy if exists leer on hub.fusiones;
create policy leer on hub.fusiones for select to authenticated using ((select hub.es_admin()));
-- Lo único que se toca después: «ya está hecho en Zoho».
drop policy if exists zoho on hub.fusiones;
create policy zoho on hub.fusiones for update to authenticated using ((select hub.es_admin())) with check ((select hub.es_admin()));
revoke update on hub.fusiones from authenticated;
grant update (zoho_hecho_at) on hub.fusiones to authenticated;
select hub.auditar('fusiones');

-- ── Duplicados ───────────────────────────────────────────────────────────
-- [{ ids: [...], motivos: ['nif', 'nombre'…] }], los más seguros primero.
-- Grupos de 2 a 8 (un teléfono o correo de 20 fichas es de una cadena, no un
-- duplicado). Un grupo sale mientras quede una pareja sin marcar «no son la
-- misma».
create or replace function hub.duplicados(p_tipo text)
returns jsonb language plpgsql stable set search_path = hub as $fn$
declare
  v jsonb;
begin
  if p_tipo = 'cliente' then
    with c as (select id, hub.norm_texto(nif) nif, hub.norm_empresa(nombre) nom, lower(btrim(email)) em, hub.norm_tel(telefono) tel from hub.clientes),
    k as (
      select 'nif' m, nif k, id from c where length(nif) >= 8
      union all select 'nombre', nom, id from c where length(nom) >= 4
      union all select 'correo', em, id from c where em like '_%@_%'
      union all select 'teléfono', tel, id from c where length(tel) = 9)
    select jsonb_agg(g) into v from (
      select jsonb_build_object('ids', to_jsonb(ids), 'motivos', to_jsonb(array_agg(distinct m))) g, ids
        from (select m, array_agg(id order by id) ids from k group by m, k having count(*) between 2 and 8) x
       group by ids) y
     where exists (select 1 from jsonb_array_elements_text(y.g->'ids') a(v), jsonb_array_elements_text(y.g->'ids') b(v)
                    where a.v::uuid < b.v::uuid and not exists (select 1 from hub.no_duplicados n where n.tipo = p_tipo and n.a = a.v::uuid and n.b = b.v::uuid));
  elsif p_tipo = 'contacto' then
    with c as (select id, hub.norm_texto(nombre) nom, cliente_id, local_id, lower(btrim(email)) em, hub.norm_tel(telefono) tel from hub.contactos),
    k as (
      select 'teléfono' m, tel k, id from c where length(tel) = 9
      union all select 'correo', em, id from c where em like '_%@_%'
      union all select 'nombre', nom || ':' || cliente_id, id from c where length(nom) >= 3 and cliente_id is not null
      union all select 'nombre', nom || ':' || local_id, id from c where length(nom) >= 3 and local_id is not null)
    select jsonb_agg(g) into v from (
      select jsonb_build_object('ids', to_jsonb(ids), 'motivos', to_jsonb(array_agg(distinct m))) g, ids
        from (select m, array_agg(distinct id order by id) ids from k group by m, k having count(distinct id) between 2 and 8) x
       group by ids) y
     where exists (select 1 from jsonb_array_elements_text(y.g->'ids') a(v), jsonb_array_elements_text(y.g->'ids') b(v)
                    where a.v::uuid < b.v::uuid and not exists (select 1 from hub.no_duplicados n where n.tipo = p_tipo and n.a = a.v::uuid and n.b = b.v::uuid));
  elsif p_tipo = 'sede' then
    with c as (select id, hub.norm_empresa(nombre) nom, cliente_id, hub.norm_texto(direccion) dir from hub.locales),
    k as (
      select 'nombre' m, nom || ':' || cliente_id k, id from c where length(nom) >= 3 and cliente_id is not null
      union all select 'nombre', nom, id from c where length(nom) >= 8
      union all select 'dirección', dir, id from c where length(dir) >= 12)
    select jsonb_agg(g) into v from (
      select jsonb_build_object('ids', to_jsonb(ids), 'motivos', to_jsonb(array_agg(distinct m))) g, ids
        from (select m, array_agg(distinct id order by id) ids from k group by m, k having count(distinct id) between 2 and 8) x
       group by ids) y
     where exists (select 1 from jsonb_array_elements_text(y.g->'ids') a(v), jsonb_array_elements_text(y.g->'ids') b(v)
                    where a.v::uuid < b.v::uuid and not exists (select 1 from hub.no_duplicados n where n.tipo = p_tipo and n.a = a.v::uuid and n.b = b.v::uuid));
  else
    raise exception 'Tipo desconocido: %', p_tipo;
  end if;
  -- Primero lo más seguro (NIF, correo), después lo que solo se parece.
  return coalesce((select jsonb_agg(e order by
      case when e->'motivos' ? 'nif' then 0 when e->'motivos' ? 'correo' then 1 else 2 end,
      jsonb_array_length(e->'motivos') desc)
    from jsonb_array_elements(v) e), '[]'::jsonb);
end
$fn$;

-- Cuántos grupos hay de cada (la baldosa).
create or replace function hub.duplicados_resumen()
returns jsonb language sql stable set search_path = hub as $fn$
  select jsonb_build_object('cliente', jsonb_array_length(hub.duplicados('cliente')),
                            'contacto', jsonb_array_length(hub.duplicados('contacto')),
                            'sede', jsonb_array_length(hub.duplicados('sede')))
$fn$;

-- ── Fusionar ─────────────────────────────────────────────────────────────
create or replace function hub.fusionar(p_tipo text, p_queda uuid, p_sale uuid, p_probar boolean default true)
returns jsonb language plpgsql security definer set search_path = hub as $fn$
declare
  v_tabla text := case p_tipo when 'cliente' then 'clientes' when 'contacto' then 'contactos' when 'sede' then 'locales' end;
  v_col   text := case p_tipo when 'cliente' then 'cliente_id' when 'contacto' then 'contacto_id' when 'sede' then 'local_id' end;
  q jsonb; s jsonb; v_nueva jsonb; vq jsonb; vs jsonb; k text; v_t text; v_n int; v_d int;
  v_choque text; v_cols text; v_tel text; v_et jsonb; v_nota_sale text;
  v_mover jsonb := '{}'; v_descartar jsonb := '{}'; v_campos jsonb := '{}';
  v_bloqueos text[] := '{}'; v_avisos text[] := '{}'; v_notas text[] := '{}';
  v_zoho_sale text; v_zoho_queda text;
  yo hub.usuarios := hub.usuario_actual();
  v_tablas text[] := '{}';
begin
  if not hub.es_admin() then raise exception 'Solo un admin fusiona fichas'; end if;
  if v_tabla is null then raise exception 'Tipo desconocido: %', p_tipo; end if;
  if p_queda is null or p_sale is null or p_queda = p_sale then raise exception 'Hacen falta dos fichas distintas'; end if;
  execute format('select to_jsonb(t) from hub.%I t where id = $1', v_tabla) into q using p_queda;
  execute format('select to_jsonb(t) from hub.%I t where id = $1', v_tabla) into s using p_sale;
  if q is null or s is null then raise exception 'No encuentro alguna de las dos fichas (¿ya se fusionó?)'; end if;

  if not hub.tabla_es_del_hub(v_tabla) then
    v_bloqueos := v_bloqueos || format('%s se sigue llevando en la app', v_tabla);
  end if;

  -- Lo que cuelga de la que sale, tabla a tabla (toda tabla de hub con la
  -- columna: así entra sola una tabla nueva). Choque = un índice único que
  -- incluye la columna y donde la que queda ya tiene su fila: esa se descarta.
  for v_t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tt using (table_schema, table_name)
     where c.table_schema = 'hub' and tt.table_type = 'BASE TABLE' and c.column_name = v_col
       and c.data_type = 'uuid' and c.table_name <> v_tabla
     order by 1
  loop
    execute format('select count(*) from hub.%I where %I = $1', v_t, v_col) into v_n using p_sale;
    continue when v_n = 0;
    select string_agg(format('exists (select 1 from hub.%I x where x.%I = $2%s)', v_t, v_col,
             coalesce((select string_agg(format(' and x.%1$I = r.%1$I', a.attname), '')
                         from unnest(ix.indkey::int2[]) ak join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ak
                        where a.attname <> v_col), '')), ' or ')
      into v_choque
      from pg_index ix
     where ix.indrelid = format('hub.%I', v_t)::regclass and ix.indisunique and ix.indpred is null
       and not (0 = any(ix.indkey::int2[]))
       and exists (select 1 from unnest(ix.indkey::int2[]) ak join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ak where a.attname = v_col);
    v_d := 0;
    if v_choque is not null then
      execute format('select count(*) from hub.%I r where r.%I = $1 and (%s)', v_t, v_col, v_choque) into v_d using p_sale, p_queda;
    end if;
    if v_n > v_d then v_mover := v_mover || jsonb_build_object(v_t, v_n - v_d); end if;
    if v_d > 0 then v_descartar := v_descartar || jsonb_build_object(v_t, v_d); end if;
    v_tablas := v_tablas || v_t;
    if not hub.tabla_es_del_hub(v_t) then
      v_bloqueos := v_bloqueos || format('%s (%s fila%s) se sigue llevando en la app', v_t, v_n, case when v_n = 1 then '' else 's' end);
    end if;
  end loop;

  -- Cobros: nada que deje un cobro colgando de una ficha borrada.
  if p_tipo = 'cliente' then
    if not hub.json_vacio(q->'stripe_customer_id') and not hub.json_vacio(s->'stripe_customer_id') and q->'stripe_customer_id' <> s->'stripe_customer_id' then
      v_bloqueos := v_bloqueos || 'Los dos tienen cliente en Stripe (distinto): primero hay que dejar los cobros en uno'::text;
    end if;
    if not hub.json_vacio(q->'zoho_id') and not hub.json_vacio(s->'zoho_id') and q->'zoho_id' <> s->'zoho_id' then
      v_zoho_queda := q->>'zoho_id'; v_zoho_sale := s->>'zoho_id';
      v_avisos := v_avisos || 'Los dos tienen contacto en Zoho Books: después hay que fusionarlos allí (el hub lo deja apuntado)'::text;
    end if;
    if not hub.json_vacio(q->'google_contact_id') and not hub.json_vacio(s->'google_contact_id') and q->'google_contact_id' <> s->'google_contact_id' then
      v_avisos := v_avisos || 'El contacto de Google de la que sale se queda en Google Contactos'::text;
    end if;
  elsif p_tipo = 'sede' then
    if not hub.json_vacio(s->'stripe_subscription_id') then
      v_bloqueos := v_bloqueos || case when hub.json_vacio(q->'stripe_subscription_id')
        then 'La que sale cobra por Stripe: tiene que ser la que se queda'
        else 'Las dos cobran por Stripe: primero hay que dar de baja una de las dos cuotas' end;
    end if;
    if not hub.json_vacio(q->'zoho_subscription_id') and not hub.json_vacio(s->'zoho_subscription_id') and q->'zoho_subscription_id' <> s->'zoho_subscription_id' then
      v_bloqueos := v_bloqueos || 'Las dos tienen suscripción en Zoho Billing: primero hay que dejar una'::text;
    end if;
    if (q->>'cliente_id') is distinct from (s->>'cliente_id') and not hub.json_vacio(q->'cliente_id') and not hub.json_vacio(s->'cliente_id') then
      v_avisos := v_avisos || 'Son de clientes distintos: se queda el cliente de la que se queda'::text;
    end if;
    if not hub.json_vacio(q->'drive_folder_id') and not hub.json_vacio(s->'drive_folder_id') and q->'drive_folder_id' <> s->'drive_folder_id' then
      v_avisos := v_avisos || 'La carpeta de Drive de la que sale no se toca (habrá que juntarlas a mano)'::text;
    end if;
  elsif p_tipo = 'contacto' then
    if not hub.json_vacio(q->'google_resource_name') and not hub.json_vacio(s->'google_resource_name') and q->'google_resource_name' <> s->'google_resource_name' then
      v_avisos := v_avisos || 'El contacto de Google de la que sale se queda en Google Contactos'::text;
    end if;
  end if;

  -- La ficha que queda: sus huecos se rellenan con lo de la otra.
  v_nueva := q;
  for k, vs in select * from jsonb_each(s) loop
    continue when k in ('id', 'created_at');
    vq := q -> k;
    if k = 'notas' then
      -- Se junta al final, con lo que no cabe en otros campos.
      if not hub.json_vacio(vs) and btrim(vs #>> '{}') <> btrim(coalesce(vq #>> '{}', '')) then v_nota_sale := vs #>> '{}'; end if;
    elsif k in ('notas_tecnicas', 'notas_mantenimiento', 'alarma_notas') then
      if hub.json_vacio(vq) then
        if not hub.json_vacio(vs) then v_nueva := jsonb_set(v_nueva, array[k], vs); end if;
      elsif not hub.json_vacio(vs) and btrim(vs #>> '{}') <> btrim(vq #>> '{}') then
        v_nueva := jsonb_set(v_nueva, array[k], to_jsonb((vq #>> '{}') || E'\n\n— De «' || coalesce(s->>'nombre', 'la ficha fusionada') || E'»:\n' || (vs #>> '{}')));
      end if;
    elsif k = 'etiquetas' then
      if jsonb_typeof(vs) = 'array' then
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into v_et
          from (select jsonb_array_elements(case when jsonb_typeof(vq) = 'array' then vq else '[]' end) e
                union select jsonb_array_elements(vs)) x;
        v_nueva := jsonb_set(v_nueva, array[k], v_et);
      end if;
    elsif k in ('activo', 'favorito') then
      if vs = 'true'::jsonb then v_nueva := jsonb_set(v_nueva, array[k], vs); end if;
    elsif hub.json_vacio(vq) then
      if not hub.json_vacio(vs) then v_nueva := jsonb_set(v_nueva, array[k], vs); end if;
    elsif k in ('telefono', 'telefono2') and not hub.json_vacio(vs) then
      v_tel := hub.norm_tel(vs #>> '{}');
      if v_tel <> hub.norm_tel(v_nueva->>'telefono') and v_tel <> hub.norm_tel(v_nueva->>'telefono2') then
        if p_tipo = 'contacto' and hub.json_vacio(v_nueva->'telefono2') then
          v_nueva := jsonb_set(v_nueva, '{telefono2}', vs);
        else
          v_notas := v_notas || ('Otro teléfono: ' || (vs #>> '{}'));
        end if;
      end if;
    elsif k = 'email' and lower(btrim(vs #>> '{}')) <> lower(btrim(vq #>> '{}')) then
      v_notas := v_notas || ('Otro correo: ' || (vs #>> '{}'));
    elsif k = 'nif' and hub.norm_texto(vs #>> '{}') <> hub.norm_texto(vq #>> '{}') then
      v_notas := v_notas || ('Otro NIF: ' || (vs #>> '{}'));
      v_avisos := v_avisos || 'Tienen NIF distinto: se queda el de la que se queda'::text;
    elsif k = 'direccion' and hub.norm_texto(vs #>> '{}') <> hub.norm_texto(vq #>> '{}') then
      v_notas := v_notas || ('Otra dirección: ' || (vs #>> '{}'));
    end if;
  end loop;
  if hub.json_vacio(q->'notas') and v_nota_sale is not null and array_length(v_notas, 1) is null then
    v_nueva := jsonb_set(v_nueva, '{notas}', to_jsonb(v_nota_sale));
  elsif v_nota_sale is not null or array_length(v_notas, 1) > 0 then
    v_nueva := jsonb_set(v_nueva, '{notas}', to_jsonb(concat_ws(E'\n\n', nullif(btrim(q->>'notas'), ''),
      '— De «' || coalesce(s->>'nombre', 'la ficha fusionada') || E'»:\n' || concat_ws(E'\n', v_nota_sale, array_to_string(v_notas, E'\n')))));
  end if;
  select coalesce(jsonb_object_agg(e.key, jsonb_build_array(q->e.key, e.value)), '{}') into v_campos
    from jsonb_each(v_nueva) e where e.value is distinct from q->e.key;

  if p_probar then
    return jsonb_build_object('probar', true, 'queda', q, 'sale', s, 'campos', v_campos,
      'movidas', v_mover, 'descartadas', v_descartar, 'bloqueos', to_jsonb(v_bloqueos), 'avisos', to_jsonb(v_avisos),
      'zoho', case when v_zoho_sale is null then null else jsonb_build_object('queda', v_zoho_queda, 'sale', v_zoho_sale) end);
  end if;
  if array_length(v_bloqueos, 1) > 0 then
    raise exception 'No se puede fusionar: %', array_to_string(v_bloqueos, '; ');
  end if;

  -- Hacerlo: mover (y descartar los choques), borrar la que sale y, ya sin
  -- ella (por si un campo único pasa de una a otra), rellenar la que queda.
  foreach v_t in array v_tablas loop
    if v_descartar ? v_t then
      select string_agg(format('exists (select 1 from hub.%I x where x.%I = $2%s)', v_t, v_col,
               coalesce((select string_agg(format(' and x.%1$I = r.%1$I', a.attname), '')
                           from unnest(ix.indkey::int2[]) ak join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ak
                          where a.attname <> v_col), '')), ' or ')
        into v_choque
        from pg_index ix
       where ix.indrelid = format('hub.%I', v_t)::regclass and ix.indisunique and ix.indpred is null
         and not (0 = any(ix.indkey::int2[]))
         and exists (select 1 from unnest(ix.indkey::int2[]) ak join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ak where a.attname = v_col);
      execute format('delete from hub.%I r where r.%I = $1 and (%s)', v_t, v_col, v_choque) using p_sale, p_queda;
    end if;
    execute format('update hub.%I set %I = $1 where %I = $2', v_t, v_col, v_col) using p_queda, p_sale;
  end loop;
  execute format('delete from hub.%I where id = $1', v_tabla) using p_sale;
  if v_campos <> '{}'::jsonb then
    select string_agg(format('%I', c), ', '), string_agg(format('r.%I', c), ', ') into v_cols, v_choque
      from jsonb_object_keys(v_campos) c;
    execute format('update hub.%1$I t set (%2$s) = (select %3$s from jsonb_populate_record(null::hub.%1$I, $1) r) where t.id = $2',
      v_tabla, v_cols, v_choque) using v_nueva, p_queda;
  end if;

  insert into hub.fusiones (tipo, queda_id, sale_id, queda_nombre, sale_nombre, sale_ficha, movidas, descartadas, campos,
                            zoho_queda, zoho_sale, autor_id, autor_nombre)
  values (p_tipo, p_queda, p_sale, q->>'nombre', s->>'nombre', s, v_mover, v_descartar, v_campos,
          v_zoho_queda, v_zoho_sale, yo.id, yo.nombre);

  return jsonb_build_object('probar', false, 'queda_id', p_queda, 'movidas', v_mover, 'descartadas', v_descartar,
    'campos', v_campos, 'avisos', to_jsonb(v_avisos),
    'zoho', case when v_zoho_sale is null then null else jsonb_build_object('queda', v_zoho_queda, 'sale', v_zoho_sale) end);
end
$fn$;
revoke execute on function hub.fusionar(text, uuid, uuid, boolean) from anon;

-- El cliente del hub que corresponde a un contacto de Zoho que ya se fusionó
-- (sigue la cadena si la que quedó se fusionó a su vez). Lo usa zoho-sync para
-- no volver a crear la ficha borrada mientras el contacto siga vivo en Zoho.
create or replace function hub.cliente_por_zoho(p_zoho text)
returns uuid language sql stable security definer set search_path = hub as $fn$
  with recursive c(id, n) as (
    select queda_id, 1 from hub.fusiones where tipo = 'cliente' and zoho_sale = p_zoho
    union all
    select f.queda_id, c.n + 1 from hub.fusiones f join c on f.sale_id = c.id where f.tipo = 'cliente' and c.n < 20)
  select c.id from c where exists (select 1 from hub.clientes x where x.id = c.id) order by c.n limit 1
$fn$;
