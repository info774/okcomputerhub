package com.okcomputer.hub.reloj

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Cliente de la función `reloj` del hub. Todo va por POST con { accion, … } y
// el token del reloj (okr_…) en Authorization. La anon key del hub no es
// secreta (la lleva también el front): la pasarela de Supabase la pide.
object Api {
    const val HUB = "https://okhub-tenerife.web.app/"
    private const val URL_RELOJ = "https://adomalsxsymxzuozksmt.supabase.co/functions/v1/reloj"
    private const val ANON =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb21hbHN4c3lteHp1b3prc210Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDk0MTgsImV4cCI6MjEwMzUyNTQxOH0.6rmj9dYyvGTNhFhuHVmREbDJcaUsh1Z0V78AJ7_pYwk"

    class Respuesta(val codigo: Int, val cuerpo: JSONObject) {
        val ok get() = codigo in 200..299
        val error: String get() = cuerpo.optString("error").ifBlank { "Error $codigo" }
    }

    suspend fun llamar(accion: String, token: String?, extra: Map<String, Any?> = emptyMap()): Respuesta = withContext(Dispatchers.IO) {
        val con = URL(URL_RELOJ).openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.connectTimeout = 15000
            con.readTimeout = 30000
            con.doOutput = true
            con.setRequestProperty("Content-Type", "application/json")
            con.setRequestProperty("apikey", ANON)
            con.setRequestProperty("Authorization", "Bearer ${token ?: ANON}")
            val cuerpo = JSONObject().put("accion", accion)
            extra.forEach { (k, v) -> cuerpo.put(k, v ?: JSONObject.NULL) }
            con.outputStream.use { it.write(cuerpo.toString().toByteArray()) }
            val codigo = con.responseCode
            val texto = (if (codigo in 200..299) con.inputStream else con.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            Respuesta(codigo, try { JSONObject(texto) } catch (_: Exception) { JSONObject().put("error", "Respuesta rara del hub ($codigo)") })
        } finally {
            con.disconnect()
        }
    }
}
