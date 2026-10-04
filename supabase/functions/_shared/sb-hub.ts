// supabase-js sobre el esquema `hub`, con la service key. Lo usa el motor de
// cobro del mantenimiento (stripe-*, firma-contrato), portado de la app tal
// cual: allí habla con `db.from(...)` y así el código se queda igual. Lo que
// escribe lleva `x-hub-origen` (y `x-hub-usuario` si se sabe) para que la
// auditoría diga quién fue.
// OJO: las tablas espejo no tienen claves foráneas, así que aquí NO valen los
// «embeds» de PostgREST (`clientes(...)` dentro de un select): se lee aparte.
import { createClient } from 'npm:@supabase/supabase-js@2'

export function dbHub(origen: string, email?: string | null) {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    db: { schema: 'hub' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-hub-origen': origen, ...(email ? { 'x-hub-usuario': email } : {}) } },
  })
}

// ¿Manda ya el hub en esta tabla? (hub.areas; sin área = del hub). El motor de
// cobro no hace NADA mientras el mantenimiento sea de la app: lo cobra y lo
// factura la app, y hacerlo también aquí serían dos cobros y dos facturas.
// deno-lint-ignore no-explicit-any
export async function tablaDelHub(db: any, tabla: string): Promise<boolean> {
  const { data } = await db.from('areas').select('dueno').contains('tablas', [tabla]).limit(1)
  return ((data?.[0]?.dueno as string | undefined) ?? 'hub') === 'hub'
}
