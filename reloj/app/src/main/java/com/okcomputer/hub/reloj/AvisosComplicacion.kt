package com.okcomputer.hub.reloj

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

// Complicación: nº de avisos del puesto de mando en la esfera («⚠3» si hay
// urgentes). Lee lo guardado; tocarla abre la app en Avisos.
class AvisosComplicacion : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? = datos(type, "3", "Avisos")

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val r = Repositorio.resumenGuardado(this)
        val (valor, titulo) = when {
            Repositorio.token(this) == null -> "—" to "Hub"
            r == null -> "…" to "Avisos"
            r.avisosUrgentes > 0 -> "⚠${r.avisosUrgentes}" to "Urgentes"
            else -> "${r.avisosTotal}" to "Avisos"
        }
        return datos(request.complicationType, valor, titulo)
    }

    private fun datos(type: ComplicationType, valor: String, titulo: String): ComplicationData? {
        if (type != ComplicationType.SHORT_TEXT) return null
        val abrir = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_PANTALLA, "avisos").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return ShortTextComplicationData.Builder(
            PlainComplicationText.Builder(valor).build(),
            PlainComplicationText.Builder("$valor $titulo").build(),
        )
            .setTitle(PlainComplicationText.Builder(titulo).build())
            .setMonochromaticImage(MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_hub)).build())
            .setTapAction(abrir)
            .build()
    }
}
