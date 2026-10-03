package com.okcomputer.hub.reloj

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.wear.remote.interactions.RemoteActivityHelper

// «Abrir en el móvil»: el enlace (ficha del hub, Cómo llegar…) se abre en el
// teléfono emparejado, que es donde se trabaja con calma.
object Movil {
    fun abrir(ctx: Context, url: String?) {
        if (url.isNullOrBlank()) return
        val intent = Intent(Intent.ACTION_VIEW).addCategory(Intent.CATEGORY_BROWSABLE).setData(Uri.parse(url))
        val futuro = RemoteActivityHelper(ctx, ContextCompat.getMainExecutor(ctx)).startRemoteActivity(intent, null)
        futuro.addListener({
            val bien = try { futuro.get(); true } catch (_: Exception) { false }
            Toast.makeText(ctx, if (bien) "Abierto en el móvil" else "No se pudo abrir en el móvil", Toast.LENGTH_SHORT).show()
        }, ContextCompat.getMainExecutor(ctx))
    }
}
