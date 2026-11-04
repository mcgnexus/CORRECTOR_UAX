# Plan de implementación: Fase 4 — Roster y revisión OMR

## Alcance y decisiones

- Añadir al detalle del examen un roster de alumnos propio de ese examen y un flujo de revisión/guardado para las lecturas OMR de Fase 3.
- Cada alumno guarda nombre completo y DNI. Importación CSV UTF-8 con encabezados `nombre,dni` y alta individual. DNI normalizado y único por examen.
- Una sola lectura revisada por alumno y examen. Reemplazar una lectura existente requiere confirmación; no se conserva historial de intentos.
- El docente debe confirmar explícitamente todas las preguntas, incluidas las marcadas `ok`. Puede elegir una opción o confirmar que queda en blanco. `multiple` y `faint` no se resuelven automáticamente.
- Persistir solo las respuestas finales revisadas y la fecha de guardado. No persistir la imagen, pixeles, recortes, coordenadas, flags/confianza provisionales ni la nota. No comparar con la clave ni puntuar; eso queda para Fase 5.
- Cambiar el número de preguntas/opciones del examen queda bloqueado mientras haya resultados guardados. El docente debe eliminar explícitamente esos resultados primero.
- No modificar ni revertir cambios existentes de Fases 1–3 salvo los puntos de integración indicados.

## Flujo y datos

1. La imagen sigue decodificándose y procesándose en el navegador/worker como en Fase 3. Al obtener lectura provisional, abrir un paso de revisión que permita elegir un alumno existente o darlo de alta; ninguna imagen sale del navegador.
2. Mostrar una fila editable por pregunta con detección inicial, estado/confianza orientativos y selector de opción `A..` o `En blanco`. Marcar cada fila pendiente hasta que el docente la confirme explícitamente. No permitir guardar mientras quede alguna pendiente.
3. Guardar únicamente `examId`, `studentId` y respuestas finales `{ questionNo, optionIndex | null }`. En reemplazo, pedir confirmación antes de escribir. No enviar foto ni valores de confianza/provisionales a la API.
4. Mostrar roster y estado de lectura por alumno, permitiendo abrir/editar la lectura guardada y eliminarla. Eliminar un alumno con resultado requiere confirmación y elimina también ese resultado.
5. Añadir tablas relacionales: alumnos con nombre y DNI únicos por examen; resultado único por alumno; respuestas relacionadas con el resultado, una por pregunta y con opción nullable para blanco. Usar cascada acotada al eliminar examen/alumno. Guardar migración Drizzle; no desplegarla automáticamente en una base compartida/producción.

## Trabajo

1. Extender `src/db/schema.ts` y crear migración para roster, resultados y respuestas. Añadir índices/constraints de unicidad por examen+DNI, resultado único por alumno y pregunta única por resultado.
2. Crear validación pura para alta individual, CSV y respuestas revisadas. Normalizar nombre/DNI; limitar tamaño y número de filas del CSV; detectar filas inválidas, DNI duplicados en el archivo y conflictos con el roster. La importación es atómica: con errores no se inserta ninguna fila y se devuelven errores por número de fila, sin incluir DNI en logs.
3. Añadir funciones de dominio para listar/crear/eliminar alumnos, listar y cargar resultados, guardar/reemplazar respuestas y eliminar resultados. Cada operación verifica propiedad del examen. Usar transacción y bloqueo del examen en el guardado; validar rango, unicidad y cobertura exacta de preguntas/opciones contra la estructura actual.
4. Añadir rutas autenticadas bajo `/api/exams/[examId]` para roster/importación/resultados siguiendo los patrones de `key/route.ts` y `matrix/route.ts`; aplicar límites de cuerpo y respuestas de error consistentes, sin datos personales en logs.
5. Integrar gestión del roster y panel de lecturas en `src/app/examenes/[examId]/client.tsx`; conectar la salida local de `omr-reader.tsx` con el editor de revisión. Mantener estado de lectura en cliente hasta guardar y limpiar imagen/previsualización al cancelar o salir. Añadir confirmación de todas las preguntas, persistencia, edición y reemplazo.
6. En `src/lib/exams.ts` impedir cambios de `numQuestions`/`numOptions` si hay resultados guardados. La API debe responder conflicto accionable; los cambios de título/asignatura siguen permitidos.
7. No implementar puntuación, comparación con clave, escaneo de roster desde imagen, guardado de fotos, exportación de notas ni historial de intentos.

## Privacidad e integridad

- Nombre y DNI se almacenan en PostgreSQL como datos personales, limitados al roster del examen y visibles solo al propietario autenticado del examen. No se sube ni persiste la hoja escaneada.
- Evitar registrar cuerpos de petición, nombre, DNI o respuestas en logs. CSV solo se procesa en memoria y no se conserva.
- DNI se trim/normaliza (mayúsculas y separadores de espacio); unicidad case-insensitive por examen. No exigir checksum para no rechazar NIE u otros documentos usados como identificador; validar presencia y longitud acotada.
- Evitar resultados huérfanos: borrado de alumno requiere confirmación si existe resultado; cambios estructurales se bloquean hasta eliminar resultados explícitamente.
- Las respuestas blancas son valores explícitos `null`, no preguntas omitidas. Para guardar se exige exactamente una decisión confirmada por cada pregunta.

## Validación

- Pruebas unitarias de normalización, DNI duplicado/case-insensitive, CSV con comillas/filas inválidas, importación atómica, límite de tamaño/filas y validación de todas las respuestas (incluido blanco).
- Pruebas de dominio/API para autenticación, aislamiento entre propietarios, examen inexistente, transacciones, conflicto de DNI, resultado único, reemplazo, borrado, pregunta/opción fuera de rango y cobertura incompleta.
- Pruebas UI del flujo: revisión requerida para todas las filas, resolución de `blank/multiple/faint`, opción en blanco, cancelación sin guardar, creación/selección de alumno, reemplazo con confirmación y lista de lecturas guardadas.
- Verificar que el payload de guardado no contiene imagen, píxeles, coordenadas, flags ni confianza; no hay rutas de upload/storage.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run build`. Inspeccionar la migración generada; aplicar solo en base local/de prueba autorizada.
- No reclamar exactitud OMR ni métricas de aceptación; Fase 4 fuerza confirmación humana, y Fase 5 implementará el cálculo de nota.

## Archivos principales

- `src/db/schema.ts`, nueva migración en `drizzle/`
- `src/lib/` para esquema de validación y dominio de roster/resultados
- Nuevas rutas `src/app/api/exams/[examId]/...`
- `src/app/examenes/[examId]/page.tsx`, `client.tsx`, `omr-reader.tsx` y estilos
- `src/lib/exams.ts` para proteger cambios estructurales
