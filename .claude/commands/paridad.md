---
description: Llevar al hub lo nuevo de la app actual (okcomputerclaude) y poner al día docs/PARIDAD.md
---

# /paridad — que el hub no se quede atrás de la app

La app actual (`okcomputerclaude`) sigue en producción y se sigue mejorando; el
hub tiene que tener TODO lo que tiene la app, ahora y en el futuro, hasta que la
sustituya (decisión de Fran, 2026-10-03). Este comando se lanza **solo cuando
Fran lo pide** (no hay tarea programada). La app NO se toca desde aquí: ni
commits, ni PRs, ni despliegues, ni escrituras en su base.

## Pasos

1. **Desde dónde.** Lee `docs/PARIDAD.md`: la línea «Revisado hasta» da el
   último commit de la app ya revisado. Trae la app al día (`git -C
   ../okcomputerclaude fetch origin main`; si no está clonada, añádela con
   `add_repo` en solo lectura y clónala junto al hub).
2. **Qué ha cambiado.** `git -C ../okcomputerclaude log --reverse --format='%h %cs %s'
   <revisado>..origin/main` y, por commit, `git show --stat` y el diff de lo
   que importe. Ignora lo que no es funcionalidad (docs internas, arneses,
   formato). Agrúpalos por área del mapa.
3. **Clasifica cada cambio** contra la tabla de `docs/PARIDAD.md`:
   - El área ya está en el hub (**Hecho** o **Solo lectura**) → **pórtalo** al
     hub: misma regla de negocio, pasada a TypeScript, en la pantalla o función
     del hub que le toca. Si el cambio trae una migración nueva en una tabla que
     el hub copia, añade la columna a la tabla espejo (migración nueva en `hub`)
     y a `_shared/tablas-app.ts` en la misma tanda: el sync tiene que cuadrar.
   - El área está como **Enlace** o **Falta** → no se porta suelto: se apunta en
     la fila de esa función («la app añadió X el AAAA-MM-DD, commit abc1234»)
     para que vaya en el bloque de paridad de esa área.
   - Es algo que el hub no debe copiar (p. ej. un parche de la APK) → se apunta
     como «no aplica» con el motivo.
4. **Comprueba.** `npm run lint`, `npm run build` y `npm run verify` (más el
   arnés de la pantalla tocada, o uno nuevo si no lo hay). Nada se fusiona en
   rojo.
5. **Fusiona y despliega sin preguntar** (acordado en `CLAUDE.md`): commit en
   español, fusión en `main`, despliegue del front y de las funciones tocadas.
   Migraciones nuevas sobre `hub`: se aplican como dice `CLAUDE.md`.
6. **Pon al día `docs/PARIDAD.md`**: estados que cambian, notas nuevas, y la
   línea «Revisado hasta» con el último commit de la app revisado y la fecha.
7. **Cuéntaselo a Fran** en pocas líneas: qué se ha portado, qué ha quedado
   apuntado para su bloque y qué necesita de él (si algo).

## Lo que NUNCA

- Escribir en la base de la app, salvo lo ya autorizado y listado en
  `CLAUDE.md` (hoy: lo que apunta la función `whatsapp` al contestar).
- Tocar `public` (es de Breeze) ni los roles de Breeze.
- Copiar a ciegas: si una regla de la app depende de algo que el hub aún no
  tiene, se apunta y se pregunta.
