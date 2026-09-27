# Fase 9 · Almacén: stock, MRP, compras y envíos

Ver §3 de `PLAN_SISTEMA_UNIFICADO.md` y `DECISIONES_FASES.md`. Hecha en una
entrega (2026-09-27).

## Decisiones de Fran

- Inventario y catálogo **se quedan en la app** hasta la fase Final (los
  técnicos gastan material desde los trabajos).
- **Proveedores y pedidos de compra pasan al hub**; el MRP calcula con el stock
  y el consumo que llegan de la app.
- Envíos: **Correos / Correos Express** y, sobre todo, registro manual con
  número de seguimiento.

## Qué hay

- **Migración `20261013_almacen.sql`** (aplicada):
  - Espejo de SOLO LECTURA (área `inventario`, dueño `app`): `hub.catalogo`,
    `hub.furgonetas` (las ubicaciones), `hub.furgoneta_inventario` y
    `hub.furgoneta_movimientos`, mismas columnas que la app. Carga inicial
    hecha: 177 artículos, 4 ubicaciones, 153 productos, 101 movimientos.
    Catálogo e inventario viajan por el `audit_log` (15 min); ubicaciones y
    movimientos, en la pasada nocturna.
  - Del hub: `hub.proveedores` (con plazo de entrega y pedido mínimo),
    `hub.material_proveedor` (qué sirve cada uno, su referencia, precio y el
    **preferido** por material), `hub.pedidos_compra` (PC-n; Borrador →
    Enviado → Confirmado → Recibido, fecha esperada por el plazo del proveedor,
    «entrada dada» en la app) con `pedido_compra_lineas` (el total lo suma la
    base) y `hub.envios` (agencia, seguimiento, estado).
    En la app, proveedores y compras nunca llegaron a producción: no había
    nada que importar.
  - **`hub.mrp()`**: por material (del catálogo, o por nombre si el producto no
    está enlazado): stock en todas las ubicaciones, mínimo, consumo de 90 días
    (salidas), cobertura en días, lo pedido y no recibido, proveedor preferido
    y plazo, y **cuánto pedir** = consumo diario × (plazo + cobertura) + mínimo
    − stock − en camino (cobertura en `hub.config.mrp_cobertura_dias`, 30).
    «Urgente» si no llega al mínimo o no cubre el plazo del proveedor.
  - Avisos: `hay_que_comprar`, `pedido_retrasado`, `pedido_sin_entrada`,
    `envio_atascado` (5 días sin entregar), `envio_incidencia`. Los ganchos de
    avisos quedan uno por fase (`hub.avisos_portal`, `_comandas`, `_almacen`,
    `_personas`, `_facturacion`), que junta `hub.avisos_extra()`.
- **Pantalla `#/almacen`** (Almacén y compras): Stock (con ubicaciones,
  consumo, cobertura, en camino), Qué pedir (por proveedor, se marcan y se
  prepara el pedido en borrador), Pedidos (ficha con líneas del catálogo,
  texto para el proveedor, copiar o abrir en el correo, estados), Proveedores
  (alta y materiales que sirven) y Envíos (enlace de seguimiento de Correos,
  Correos Express, MRW, SEUR, GLS).
- **MCP**: `stock`, `compras_sugeridas`, `envios_listar`, `envio_crear`.

## Cómo encaja con la app

El material RECIBIDO se sigue dando de entrada en el Inventario de la app (el
hub no escribe allí): el pedido queda en aviso hasta que alguien marca
«Entrada dada». Al cortar el inventario (fase Final), la recepción del pedido
moverá el stock directamente.

## Falta

Nada de Fran para usarlo: dar de alta proveedores y qué material sirve cada
uno (o el MRP no sabe a quién pedir).
