package com.okcomputer.hub.reloj

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// Cada 15 minutos (lo mínimo que deja Android) se trae el resumen para que la
// tile y la complicación estén al día aunque no se abra la app.
class Refresco(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (Repositorio.token(applicationContext) == null) return Result.success()
        return if (Repositorio.refrescar(applicationContext) == "Sin conexión") Result.retry() else Result.success()
    }

    companion object {
        private const val NOMBRE = "okhub-refresco"
        fun programar(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<Refresco>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NOMBRE, ExistingPeriodicWorkPolicy.KEEP, req)
        }
        fun cancelar(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork(NOMBRE) }
    }
}
