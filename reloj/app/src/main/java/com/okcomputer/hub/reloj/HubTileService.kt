package com.okcomputer.hub.reloj

import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture

// Tile: lo esencial al deslizar desde la esfera. Pinta lo GUARDADO (sin red,
// al instante); lo refresca el trabajo de 15 min o abrir la app. Tocar abre la app.
class HubTileService : TileService() {

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(
                TileBuilders.Tile.Builder()
                    .setResourcesVersion(VERSION)
                    .setFreshnessIntervalMillis(15 * 60 * 1000L)
                    .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(disposicion()))
                    .build()
            )
            "tile"
        }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        CallbackToFutureAdapter.getFuture { c ->
            c.set(ResourceBuilders.Resources.Builder().setVersion(VERSION).build())
            "recursos"
        }

    private fun texto(t: String, color: Int, tam: Float = 14f, lineas: Int = 1, negrita: Boolean = false) =
        LayoutElementBuilders.Text.Builder()
            .setText(t)
            .setMaxLines(lineas)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(sp(tam))
                    .setColor(argb(color))
                    .setWeight(if (negrita) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                    .build()
            )
            .build()

    private fun hueco(alto: Float) = LayoutElementBuilders.Spacer.Builder().setHeight(dp(alto)).build()

    private fun disposicion(): LayoutElementBuilders.LayoutElement {
        val col = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
        col.addContent(texto("⬢ Ok Hub", LIMA, 13f, negrita = true)).addContent(hueco(6f))
        val estado = Repositorio.estado.value
        val r = Repositorio.resumenGuardado(this)
        if (Repositorio.token(this) == null || estado is Estado.Pendiente) {
            col.addContent(texto("Toca para vincular", MENTA, 15f, 2))
        } else if (r == null) {
            col.addContent(texto("Cargando…", MENTA, 15f))
        } else {
            val avisos = if (r.avisosUrgentes > 0) "⚠ ${r.avisosUrgentes} urgentes · ${r.avisosTotal}" else "${r.avisosTotal} avisos"
            col.addContent(texto(avisos, if (r.avisosUrgentes > 0) AMBAR else BLANCO, 18f, negrita = true)).addContent(hueco(4f))
            val ses = r.dia.sesion
            when {
                ses?.estado == "trabajando" -> col.addContent(texto("⏱ ${ses.trabajoNumero?.let { "#$it" } ?: "Trabajando"} · ${minutosDesde(ses.desde)} min", LIMA, 14f))
                ses != null -> col.addContent(texto("🚐 En traslado · ${minutosDesde(ses.desde)} min", LIMA, 14f))
                r.dia.siguiente != null -> col.addContent(texto("${hora(r.dia.siguiente.inicio).ifBlank { "Hoy" }} ${r.dia.siguiente.rotulo()}", BLANCO, 14f, 2))
                else -> col.addContent(texto("Sin paradas hoy", MENTA, 14f))
            }
            col.addContent(hueco(4f))
            val rmm = r.rmm
            col.addContent(texto("📡 ${rmm.caido} caídas · ${rmm.alertasAbiertas} alertas", if (rmm.caido > 0) ROJO else MENTA, 13f))
            r.cifras?.let { col.addContent(texto("Vencido ${euros(it.vencido)}", if (it.vencido > 0) AMBAR else MENTA, 13f)) }
            col.addContent(hueco(4f)).addContent(texto(hora(r.generado), GRIS, 11f))
        }
        val abrir = ModifiersBuilders.Clickable.Builder()
            .setId("abrir")
            .setOnClick(
                ActionBuilders.LaunchAction.Builder()
                    .setAndroidActivity(
                        ActionBuilders.AndroidActivity.Builder()
                            .setPackageName(packageName)
                            .setClassName(MainActivity::class.java.name)
                            .build()
                    ).build()
            ).build()
        return LayoutElementBuilders.Box.Builder()
            .setWidth(expand()).setHeight(expand())
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(abrir).build())
            .addContent(col.build())
            .build()
    }

    companion object {
        private const val VERSION = "1"
        private const val LIMA = 0xFF7DD956.toInt()
        private const val MENTA = 0xFFD4F4E2.toInt()
        private const val BLANCO = 0xFFFFFFFF.toInt()
        private const val AMBAR = 0xFFF5B83D.toInt()
        private const val ROJO = 0xFFFF6B6B.toInt()
        private const val GRIS = 0xFF8FA89A.toInt()
    }
}
