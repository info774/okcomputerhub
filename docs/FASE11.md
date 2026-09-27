# Fase 11 · Facturación propia — PROGRAMADA, SIN ACTIVAR

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisión de Fran

**Programada y probada pero SIN ACTIVAR**: Zoho Books sigue emitiendo las
facturas hasta que la gestoría la valide y Fran dé el OK.

## Qué hay

- **Migración `20261015_facturacion.sql`** (aplicada):
  - `hub.series_factura`: **F** (facturas), **R** (rectificativas) y **P**
    (PRUEBA, sin valor fiscal). `hub.series_contador` por serie y año.
  - `hub.facturas` + `hub.factura_lineas` (IGIC por línea: 0, 3, 5, 7, 9,5,
    15, 20 %; la base con descuento la calcula la base de datos; los totales,
    un trigger) + `hub.factura_cobros` (lo cobrado es su suma).
  - **`hub.emitir_factura(id)`** (solo admins): número correlativo **sin
    huecos** (contador bloqueado; un borrador no gasta número), código
    `F-2026-0001`, datos del cliente y del emisor **congelados**, vencimiento,
    y **huella sha256 encadenada** con la de la factura anterior (reales con
    reales, prueba con prueba), al estilo del reglamento de sistemas de
    facturación (RD 1007/2023, «Veri*factu»). Exige el NIF del cliente por
    encima de 400 € y los datos fiscales del emisor.
  - **Lo emitido no se toca** (ni un admin, ni sus líneas, ni se borra): se
    corrige con **`hub.crear_rectificativa(id, motivo)`** (borrador con las
    líneas en negativo; al emitirla la original queda «rectificada»).
  - **El candado**: mientras `hub.config.facturacion_activa` no sea `true`,
    `emitir_factura` solo emite la serie **P**.
  - Avisos (`hub.avisos_facturacion`, solo admins): factura propia vencida,
    borrador olvidado (solo series reales).
- **Pantalla `#/facturacion`** (solo admins, «Facturación (sin activar)»):
  lista, borrador con cliente/NIF y líneas, **desde trabajos por facturar**
  (una línea por trabajo con lo que se hizo, más su material de la app),
  emitir, factura para imprimir o guardar en PDF (con la marca «PRUEBA — SIN
  VALOR FISCAL» en la serie P y la huella), cobros, rectificar, datos del
  emisor. No hay botón de activar, a propósito.

## Para activarla (cuando toque; NO ahora)

1. La gestoría revisa facturas de la serie P (numeración, IGIC, datos,
   rectificativas) y da el visto bueno.
2. Completar los datos del emisor en `#/facturacion/ajustes` (NIF, dirección,
   IBAN).
3. Lo que falta para Veri*factu: envío de cada registro a la AEAT y el QR en
   la factura (se programa entonces, con el certificado de la empresa).
4. Fran da el OK y se pone `facturacion_activa = true` en `hub.config`
   (desde el SQL del proyecto o con una migración). Desde ese momento se deja
   de emitir en Zoho (si no, habría dos numeraciones): hay que decidir con la
   gestoría la fecha de corte y la serie.
5. Portar el envío por correo al cliente (hoy lo hace Zoho).

## Lo que no se hace

- El hub no marca los trabajos de la app como facturados (no escribe allí):
  la factura guarda `trabajo_ids` y la lista «desde trabajos» ya no los ofrece.
