// El «contexto de Zoho» que espera el motor de cobro portado de la app
// (zoho-factura-mant.ts, zoho-abono-mant.ts), montado sobre el cliente de Zoho
// PROPIO del hub (zoho.ts: su Self Client, región eu, refresh token en el
// Vault). Así el código portado no cambia y no hay dos maneras de hablar con
// Zoho. Permisos que pide (PENDIENTE_FRAN §5): invoices CREATE/UPDATE,
// creditnotes CREATE/UPDATE, customerpayments CREATE, settings READ y
// chartofaccounts READ.
import { ORG, zohoToken } from './zoho.ts'
import { hubDb } from './hub-db.ts'

export interface ZohoCtx { ZOHO_ORG_ID: string; apiDomain: string; booksAppDomain: string }

export function zohoCtx(): ZohoCtx {
  return { ZOHO_ORG_ID: ORG(), apiDomain: 'www.zohoapis.eu', booksAppDomain: 'books.zoho.eu' }
}

export async function zohoAccessToken(_ctx: ZohoCtx): Promise<string> {
  return await zohoToken(hubDb({ origen: 'zoho' }))
}

// Impuestos y cuentas bancarias de Zoho Books para los ajustes de facturación
// del mantenimiento (zohoOpcionesFacturacion de la app).
export async function zohoOpcionesFacturacion() {
  const ctx = zohoCtx()
  const token = await zohoAccessToken(ctx)
  const get = async (path: string) => {
    const res = await fetch(`https://${ctx.apiDomain}/books/v3/${path}${path.includes('?') ? '&' : '?'}organization_id=${ctx.ZOHO_ORG_ID}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(20000) })
    return await res.json().catch(() => ({}))
  }
  const [taxes, cuentas] = await Promise.all([get('settings/taxes'), get('chartofaccounts?filter_by=AccountType.Bank')])
  return {
    ok: true,
    // deno-lint-ignore no-explicit-any
    impuestos: (taxes.taxes || []).map((t: any) => ({ id: t.tax_id, nombre: t.tax_name, porcentaje: t.tax_percentage })),
    // deno-lint-ignore no-explicit-any
    cuentas: (cuentas.chartofaccounts || []).map((c: any) => ({ id: c.account_id, nombre: c.account_name })),
  }
}
