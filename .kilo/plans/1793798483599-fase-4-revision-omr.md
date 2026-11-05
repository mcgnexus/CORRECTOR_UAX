# Referencia completada: Fase 5 — Puntuación y resultado

Fase 5 ya está implementada; esta sección se conserva como contexto histórico. El plan vigente para implementar es Fase 6, al final de este archivo.

## Alcance y decisiones

- Implementar puntuación determinista según la fórmula normativa M5 de `Spec_App Correctora de Exámenes Tipo Test.md`. Solo se calcula en servidor con clave completa y validada; el LLM y las banderas OMR no puntúan.
- Regla configurable por examen: `pointsCorrect > 0`, `pointsWrong <= 0`, `pointsBlank <= 0`, `maxScore > 0`. Defaults: `1, 0, 0, 10`. Guardar valores decimales sin perder precisión y hacer redondeo half-up a dos decimales.
- Una entrega puntuada contiene todas las respuestas finales confirmadas, conteos (`correct`, `wrong`, `blank`), `rawScore`, `score`, fecha y versión. Una respuesta null cuenta como blanco. La foto, confianza, flags y geometría nunca se guardan.
- Persistir regla por examen. Si no hay regla guardada, aplicar defaults. Guardar/actualizar una regla recalcula en una transacción todos los resultados existentes cuando la clave está validada.
- Al guardar un borrador de clave, marcar scores/conteos derivados como pendientes (nulos) e incrementar versión; ocultarlos mientras `key_pending`. Al validar la nueva clave, recalcular todas las entregas en esa misma transacción y solo después dejar visible el estado validado. No aceptar nuevas entregas sin clave validada.
- Cambios de clave o regla recalculan automáticamente las entregas; mostrar mensaje al docente. Si la clave está en edición/no validada, el cálculo queda pendiente hasta validarla.
- El guardado de respuestas exige `Idempotency-Key`. Misma clave y mismo cuerpo devuelve el resultado vigente; misma clave con otro cuerpo produce conflicto. El cliente conserva la clave mientras reintenta exactamente el mismo cuerpo durante la sesión. Cola offline persistente queda para endurecimiento posterior.
- Control de concurrencia optimista por resultado: cliente manda `expectedVersion`; si cambió desde que se cargó, responder conflicto y no sobrescribir. Reemplazo conserva la confirmación explícita de Fase 4. Recálculos de clave/regla incrementan versión.
- Incluir una vista resumen persistida (aciertos, fallos, blancos, bruto y nota) en el roster/resultados. No implementar exportación, búsqueda/orden avanzado, historial de intentos ni sincronización offline duradera.

## Fórmula

Para cada pregunta, comparar la respuesta final con la clave validada: igualdad = acierto, opción diferente = fallo, `null` = blanco. Los conteos deben sumar exactamente `numQuestions`.

```text
rawScore = correct * pointsCorrect + wrong * pointsWrong + blank * pointsBlank
boundedScore = clamp(rawScore, 0, numQuestions * pointsCorrect)
score = round_half_up(boundedScore / (numQuestions * pointsCorrect) * maxScore, 2)
```

Implementar la fórmula en una función pura compartida, con aritmética decimal determinista para respetar half-up y prevenir errores de coma flotante. Servidor es la autoridad; respuesta calculada al cliente procede del resultado persistido.

## Trabajo

1. Añadir `src/lib/scoring.ts` con validación de regla, comparación de opciones y fórmula pura; soportar cualquier cantidad/opción admitida por el examen y blancos explícitos. Añadir pruebas para positivos, negativos, límites, cero, decimal half-up y conteos.
2. Extender `src/db/schema.ts`: regla por examen; conteos, bruto, nota y `version` en `exam_results`; tabla de claves de idempotencia con unicidad `(ownerId, examId, key)`, hash del cuerpo y vínculo al alumno/entrega vigente. Crear migración Drizzle sin aplicarla automáticamente en una base compartida/producción. La migración/backfill debe conservar respuestas existentes y calcular sus métricas con defaults + clave validada; si la clave no está validada o las respuestas no cubren preguntas, conservar respuestas y dejar métricas nulas/pendientes.
3. Extender validación de payloads: regla con límites de signo/finiteza, respuestas completas por pregunta/opción, `expectedVersion` y cuerpo estricto. Crear hash determinista del payload normalizado; no guardar ni loguear cuerpos sensibles.
4. Actualizar `saveOwnedReviewedResult`/ruta existente `/api/exams/[examId]/results`: exigir clave validada, comprobar `Idempotency-Key`, resolver repetición antes del control de versión, comprobar `replace` y `expectedVersion`, recalcular en servidor y guardar respuestas + conteos + nota + versión + clave idempotente en una sola transacción con lock del examen. Ante fallo no alterar la entrega anterior.
5. Añadir `GET|PUT /api/exams/[examId]/scoring` autenticado. Upsert regla dentro de transacción; si la clave está validada recalcular los resultados existentes y aumentar sus versiones antes de confirmar.
6. Actualizar `saveOwnedAnswerKeyDraft` para invalidar valores derivados y aumentar versiones al entrar en `key_pending`; actualizar `validateOwnedAnswerKey` para calcular y persistir los resultados de todas las entregas en la transacción antes de cambiar a `key_validated`. Validar la clave completa y estado del examen bajo lock.
7. Extender carga del detalle del examen con regla, estado y resultados calculados/versionados. En `client.tsx` añadir formulario de regla con defaults y explicación de penalización; en `omr-reader.tsx` enviar header idempotente/versión, conservar la clave solo para reintento idéntico y mostrar resumen únicamente tras respuesta persistida. Mostrar resultado pendiente sin nota mientras la clave no esté validada.
8. Las ediciones/reemplazos de Fase 4 deben pasar por el mismo cálculo y control de versión. Cambios de estructura del examen continúan bloqueados mientras haya resultados.

## Privacidad, integridad y fallos

- Recalcular en servidor; nunca aceptar del cliente conteos, `rawScore` o `score`. No guardar foto, `detected`, confianza o flags OMR.
- Cada lectura y regla verifica autenticación y propiedad del examen. El alumno debe pertenecer al mismo examen. No registrar DNI, respuestas ni hashes/cuerpos en logs.
- `Idempotency-Key` repetida con cuerpo distinto devuelve `409`; con mismo cuerpo retorna la entrega actual sin volver a reemplazarla. Claves asociadas al alumno se eliminan al eliminar el alumno; borrar solo una entrega no debe permitir que un reintento atrasado la recree silenciosamente.
- Error de versión obsoleta devuelve `409` accionable y no cambia respuestas ni nota. Error de red conserva el draft revisado en memoria y la clave idempotente para reintentar igual; no conservar imagen en cola ni prometer recuperación tras recarga/navegación.
- Mientras la clave esté `key_pending`, no aceptar nuevas entregas y no mostrar conteos/notas antiguos; al validar, recalcular todo atómicamente.

## Validación

- Tests puros: comparación A..Z por índice, acierto/fallo/blanco, penalización negativa, clamp inferior/superior, defaults y redondeo half-up exacto (incluidos casos de empate decimal); conteos suman preguntas.
- Tests de dominio/API: clave ausente/pending, aislamiento por propietario, regla inválida, resultados recalculados al cambiar regla/validar clave, score oculto mientras pending, transacción de reemplazo, versión obsoleta, idempotencia misma clave/mismo cuerpo y conflicto con cuerpo diferente.
- Comprobar que error durante cálculo/guardado conserva entrega anterior; idempotencia no duplica ni ejecuta dos veces el reemplazo.
- Verificar que payload de respuesta contiene solo alumno, versión, indicador de reemplazo y respuestas finales; nunca imagen, confianza/flags, conteos ni nota calculados por cliente.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; inspeccionar migración. No aplicar migración salvo base local/de prueba autorizada. No afirmar métricas OMR a partir de esta fase.

## Archivos principales

- `src/lib/scoring.ts` y tests; `src/db/schema.ts`, migración Drizzle
- `src/lib/exam-results.ts`, `src/lib/exam-keys.ts`, validación/rutas de resultados y nueva ruta scoring
- `src/app/examenes/[examId]/page.tsx`, `client.tsx`, `omr-reader.tsx` y `src/app/globals.css`

## Plan de implementación: Fase 6 — Exportación

Implementar M7 de `Spec_App Correctora de Exámenes Tipo Test.md`. Fases 4–5 (roster, revisión, puntuación e idempotencia) ya están implementadas; no modificarlas salvo integrar descargas en el detalle del examen.

### Decisiones

- Endpoint autenticado `GET /api/exams/[examId]/export?type=key|results&format=...`. Permitir solo `key` con `csv|xlsx|pdf|json` y `results` con `csv|xlsx|pdf`; `results.json` y combinaciones no admitidas responden `400`.
- Los ficheros de resultados incluyen nombre y DNI. La clave no incluye identidad de alumnos.
- CSV UTF-8 con BOM, escape estándar y separador configurable coma/punto y coma; selector en la UI y `;` predeterminado para Excel en configuración española.
- XLSX incluye una fila por alumno, columna por pregunta, conteos y nota. Colorear aciertos verde y fallos rojo solo cuando haya clave validada; no aplicar colores a estados pendientes.
- PDF de resultados: una página de resumen (tamaño roster, corregidos, pendientes, clave pendiente, media solo sobre notas calculadas) seguida de una ficha por alumno.
- PDF de clave: tabla imprimible con pregunta y respuesta. Se permite exportar cualquier borrador en todos los formatos; repetir todas las preguntas y dejar los huecos vacíos. CSV/XLSX/JSON incluyen estado de clave; PDF lleva advertencia visible `BORRADOR / NO VALIDADA` mientras no esté validada.
- Resultado sin entrega: respuestas/conteos/nota vacíos y estado `Pendiente`. Entrega revisada con `key_pending`: conservar respuestas, dejar conteos/nota vacíos y estado `Pendiente de clave`. Resultado puntuado: valores persistidos y estado `Corregido`. Una respuesta null explícita se representa como `En blanco`, no como celda vacía.
- JSON solo para clave con metadatos mínimos, estado y una fila por pregunta; huecos como `correctOption: null`. Nunca exportar confianza LLM, historial, imagen, geometría ni lectura OMR provisional.
- Añadir controles de descarga al detalle del examen. El separador elegido solo afecta CSV.

### Trabajo

1. Añadir `src/lib/exports/` para carga autenticada/propietaria, normalización de estados y generación de CSV, XLSX, PDF y JSON. Consultar clave, roster, respuestas y resultados sin recalcular ni mutar notas.
2. Añadir la ruta de exportación. Validar tipo/formato/separador y propiedad del examen; devolver `Content-Type`, `Content-Disposition: attachment` con nombre saneado y `Cache-Control: private, no-store`. Los errores de autorización no distinguen un examen ajeno de uno inexistente.
3. Construir CSV con BOM, coma o punto y coma, comillas y escape estándar. Neutralizar formula injection en campos de texto que tras whitespace/control empiecen por `=`, `+`, `-` o `@`; no convertir respuestas/notas en fórmulas.
4. Usar `exceljs` para XLSX tipado/estilizado y `pdfkit` para PDFs en runtime Node; añadir dependencias/tipos necesarios. Clave: filas ordenadas por pregunta, huecos visibles y estado. Resultados: resumen y una página por alumno, incluidos pendientes.
5. Cabeceras estables en español. Resultados: `Nombre`, `DNI`, `P1..Pn`, `Aciertos`, `Fallos`, `Blancos`, `Bruto`, `Nota`, `Estado`. Clave: `Pregunta`, `Respuesta correcta`; incluir una fila por pregunta. Valores de respuestas en letras A..Z o `En blanco` para una omisión explícita.
6. JSON clave versionado y ordenado, con examen (título, asignatura, dimensiones, estado) y respuestas `{ questionNo, correctOption }`; no incluir resultados en JSON.
7. Añadir botones/enlaces para clave/resultados y selector de separador en `src/app/examenes/[examId]/client.tsx`, manteniendo autenticación por cookie.

### Privacidad e integridad

- Cada solicitud verifica propietario y consulta únicamente ese examen/roster. No registrar DNI, respuestas ni contenido exportado; no enviar ficheros a servicios externos.
- Nombres de descarga derivados del título se limitan a caracteres seguros; nunca incluyen DNI, respuestas ni rutas suministradas por el usuario.
- Si la clave está incompleta, emitir todos los números de pregunta y dejar vacía toda respuesta desconocida; nunca inferir una opción. El estado de borrador debe quedar inequívoco, especialmente en PDF.
- Pendientes sin entrega tienen todas las respuestas vacías; `En blanco` solo representa una respuesta final confirmada como null. Cuando `key_pending`, se conservan respuestas revisadas pero no se exportan conteos/nota obsoletos.
- No se requiere migración de base de datos.

### Validación

- Tests CSV: BOM, ambos delimitadores, tildes/ñ, comillas, delimitadores dentro de campos, CRLF, vacíos y formula injection.
- Tests de combinaciones permitidas/rechazadas, autorización/owner isolation, nombres/headers/cache, clave incompleta y estados pendiente, clave pendiente y corregido.
- Reabrir XLSX con ExcelJS y verificar columnas, tipos, pendientes y rellenos verde/rojo solo con clave validada.
- Verificar cabecera `%PDF`, resumen, cantidad de páginas/fichas y advertencia de borrador en clave PDF.
- Verificar JSON versionado, ordenado, huecos null, sin PII; `results.json` rechazado.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. No se aplica ninguna migración.

### Archivos principales

- Nueva ruta `src/app/api/exams/[examId]/export/route.ts`
- Nuevos módulos y pruebas `src/lib/exports/`
- `src/app/examenes/[examId]/client.tsx` y estilos
- `package.json` y lockfile para ExcelJS/PDFKit

## Plan de implementación: Fase 7 — Endurecimiento

Las Fases 4–6 ya están implementadas. Esta fase cubre M8 de la SPEC. No se deben almacenar imágenes ni lecturas OMR provisionales. El proveedor de infraestructura no está identificado en el repositorio: retención de backups/logs, región UE y cifrado en reposo son comprobaciones bloqueantes antes de producción.

### Decisiones confirmadas

- Cola offline persistente en IndexedDB, particionada por cuenta; conservar cada entrega hasta confirmación del servidor o borrado explícito, sin TTL automático.
- La cola guarda solo `ownerId`, `examId`, `studentId`, respuestas finales, `replace`, `expectedVersion`, `Idempotency-Key`, fecha/estado/reintentos. No guardar nombre, DNI, puntuación, confianza, texto del examen, foto, recortes ni objeto File. IndexedDB no se cifra en la app; avisar al docente y permitir purgar.
- Reintentos con la misma clave y el mismo cuerpo; reconexión/visibilidad/inicio de página más botón manual. No depender de Background Sync ni prometer sincronización si el navegador está cerrado (Safari iOS no lo garantiza).
- Conflictos de versión/entrega no se resuelven automáticamente: comparar respuesta en cola con versión servidor; permitir descartar la cola o reabrir/revisar y reemplazar explícitamente con versión actual y clave idempotente nueva.
- Al borrar cuenta, eliminar servidor y purgar cola de esa cuenta en el dispositivo actual. Advertir que otro dispositivo desconectado no se puede borrar remotamente; al reconectar, su entrada obsoleta se descarta con aviso tras `404`/`410`.
- Objetivo de accesibilidad WCAG 2.2 AA. Pruebas manuales en teléfonos Android/Chrome e iOS/Safari están disponibles.
- Retención objetivo: máximo 30 días para backups y logs del proveedor; al seleccionar proveedor verificar región UE, cifrado en reposo, TLS, purga y demostrar expiración. No afirmar purga inmediata de backups.
- Pruebas destructivas solo en PostgreSQL dedicado mediante `DATABASE_URL_TEST`; nunca usar `DATABASE_URL` normal ni hacer fallback.

### Trabajo

1. Crear capa `src/lib/offline-queue/` sobre IndexedDB con versión de esquema, CRUD, índices por cuenta/examen, listado por propietario y borrado de cuenta/examen/alumno. Fijar reglas estrictas de payload y no serializar objetos del navegador salvo respuestas confirmadas. Avisar en UI que la cola local no está cifrada por la aplicación.
2. Integrar cola en el guardado OMR: si no hay conexión, falla la red o hay `5xx`, persistir la petición exacta y liberar URL/canvas/imagen después de confirmar escritura IndexedDB. Reintentar al recibir `online`, al volver a foreground y al abrir la app con sesión del mismo propietario; ofrecer reintento y borrado manual.
3. Tratar estados de reintento sin pérdida ni sobrescritura: `2xx`/replay -> borrar; `5xx`/red -> conservar; `401` -> esperar autenticación del mismo propietario; `key_not_validated` -> esperar clave validada; `version_conflict`/`exists` -> bloquear envío automático y pedir comparación explícita; `404`/`410` por examen/alumno/entrega eliminados -> retirar entrada y avisar. Nunca reenviar bajo otra cuenta.
4. Mostrar panel accesible de pendientes con estado, fecha y acciones reintentar/borrar. En conflicto permitir revisar el payload guardado; un reemplazo usa `expectedVersion` actual, exige confirmación de preguntas y genera un `Idempotency-Key` nuevo. Limitar reintentos automáticos por sesión/cooldown para evitar bucles; mantener manual hasta éxito o borrado.
5. Añadir flujo de borrado de cuenta en una zona de peligro del dashboard y endpoint autenticado de eliminación. Exigir contraseña actual (Argon2), confirmación irreversible y eliminar `users` dentro de transacción; las FK deben borrar exámenes, claves, roster, resultados, respuestas, reglas e idempotencia. Tras éxito purgar cola local de ese `ownerId` y cerrar sesión. Si el servidor devuelve `404`/`410` al sincronizar desde otros dispositivos, purgar esas entradas con aviso. Mantener borrado existente de examen/alumno y verificar cascadas.
6. Hacer que fallos de DeepSeek generen un evento estructurado limitado a `eventId`, código normalizado, HTTP status, intentos y duración; omitir `ownerId`, `examId`, texto, nombre, DNI, respuestas, token y cuerpo/respuesta crudos. El editor mostrará el último error con acción explícita `Reintentar`; no guardar eventos en una tabla con PII.
7. Auditar y corregir flujos de login, CRUD examen/roster, clave, escaneo, revisión, exportación, cola y borrado conforme WCAG 2.2 AA: nombres accesibles, labels, foco/teclado, anuncios de progreso/errores/conflictos, contraste, orden de lectura, diálogos de confirmación y áreas táctiles. Añadir axe a pruebas de navegador y revisión manual con TalkBack/VoiceOver.
8. Añadir Playwright para Chromium/WebKit y un harness de servidor con DeepSeek simulado. Probar solicitud offline/reload/reconnect con `Idempotency-Key` idéntica, eliminación al confirmar, conflictos, separación por propietario, estado/key-pending y ausencia de cuerpos con archivos/imagen. Usar captura sintética generada durante la prueba, nunca la hoja con datos reales.
9. Añadir tests DB de aislamiento por propietario y cascadas de borrar alumno/examen/cuenta; validar contraseña incorrecta/correcta y limpieza de cola en cliente. `DATABASE_URL_TEST` es obligatorio, debe ser una base aparte con nombre terminado en `_test`, rechazar igualdad con `DATABASE_URL` y ejecutar allí las migraciones antes de tests; nunca truncar ni migrar la base normal.
10. Preparar una matriz manual reproducible y ejecutar en dispositivos reales disponibles: Android Chrome y iOS Safari (versiones anotadas); captura de cámara, orientación/permisos, revisión, offline, cerrar/reabrir, reintento online, conflictos, borrar cuenta y teclado/lector de pantalla. Confirmar visualmente en Web Inspector/Chrome remoto que ninguna petición incluye imagen/Blob/multipart y que solo salen texto del examen a DeepSeek y respuestas finales al API autorizado.
11. Ajustar retención local de rate-limit: purgar registros hash de `auth_attempts` expirados (ventana actual 15 minutos) mediante tarea periódica verificable; limpiar la clave email/IP conocida al borrar cuenta. Conservar solo eventos técnicos no sensibles en logs de plataforma y configurar máximo 30 días para logs/backups en el proveedor cuando se seleccione.

### Privacidad y límites

- La cola local sobrevive logout/reinicio hasta ACK/borrado, pero una sesión distinta solo ve su partición. No guardar datos personales directos; explicar la persistencia local y su falta de cifrado app-level.
- La eliminación de cuenta purga datos activos del servidor inmediatamente y cola local del dispositivo actual. Los dispositivos offline requieren reconectar o borrar sus datos del navegador; los backups expiran según política (objetivo 30 días), no inmediatamente.
- Revalidar cada ruta por propietario; `401`/`404` no deben revelar existencia ajena. No introducir caché de PII ni service worker que almacene rutas API privadas. El detalle offline de la cola requiere que la app vuelva a abrirse con conectividad; no prometer shell offline/Background Sync.
- Mantener historial de logs sin identificadores, textos ni payloads. Verificar que el logger de OCR solo emite progreso y que DeepSeek solo recibe texto del examen con consentimiento existente.
- El corpus real y las métricas ≥99 %/≤1 % de Fase 3 siguen pendientes; esta fase no valida precisión OMR ni autoriza afirmar esas métricas.

### Validación y salida a producción

- Unit tests IndexedDB: aislamiento entre propietarios, supervivencia a reload, reintento idéntico, ACK, borrado manual, error de cuota y manejo de 401/404/409/410/5xx.
- Tests DB con `DATABASE_URL_TEST`: cascadas completas, rechazo de operaciones cruzadas entre propietarios, cuenta borrada no recupera datos activos, hash/idempotencia conservados o eliminados según FK.
- E2E Playwright offline/online y axe; ejecutar además matriz física en Android Chrome e iOS Safari, con versiones/dispositivo y resultado por caso registrados.
- Auditoría de red: archivo nunca enviado en formulario, query, body, logs ni IndexedDB; payload de resultado solo IDs/version/respuestas; DeepSeek solo texto de examen; exportaciones privadas no cacheadas.
- Verificar eliminación activa y de colas, TTL de `auth_attempts` y pruebas de borrado; revisar búsqueda final de logs para no encontrar datos personales.
- Confirmar con proveedor antes de producción: región UE, TLS, cifrado en reposo, backups y logs con retención <=30 días, purga y evidencia. Mientras falte proveedor o esta evidencia, marcar lanzamiento de producción como bloqueado.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, tests DB/E2E y `npm run build`; no aplicar migraciones destructivas fuera de la base `_test`.

## Plan de cierre tras implementación parcial de Fase 7

Este apartado concreta el trabajo de cierre sobre el estado actual del árbol. La implementación automatizable puede completarse sin declarar producción lista; la liberación sigue bloqueada hasta ejecutar las pruebas en DB/E2E y aportar evidencia del proveedor y de dispositivos físicos. Preservar todos los cambios locales existentes de Fases 4–6.

### Estado comprobado

- Implementado: IndexedDB con allowlist de campos y transacciones confirmadas; sincronización contextual OMR y global en dashboard; estados retryable/conflicto/recurso eliminado; comparación de respuestas y reemplazo explícito con versión vigente/UUID nuevo; purga local por propietario/examen/alumno.
- Implementado: borrado de cuenta autenticado con contraseña Argon2, confirmación estricta y rate-limit; cola local purgada al borrar y recuperable si falla la purga. Las rutas con JWT antiguo continúan limitadas por propietario y no devuelven datos activos tras las cascadas.
- Implementado: logging DeepSeek con allowlist de evento técnico, reintento explícito en editor y stub de pruebas limitado a loopback. Purga de rate-limit reutilizable y endpoint cron protegido.
- Implementado: pruebas unitarias IndexedDB/state/telemetría/cron/URL; pruebas DB acotadas a fixtures; configuración Playwright Chromium/WebKit y axe con hoja sintética. La matriz manual está preparada, no ejecutada.
- `POST /api/exams/[examId]/results` diferencia `exists`, `key_not_validated`, `version_conflict`, `idempotency_conflict` y `replayed_deleted` (`410`). Mantener estos códigos en la máquina de estados y no tratar todo `409` como el mismo caso.
- `drizzle.config.ts` ya no usa fallback PostgreSQL. El harness exige `DATABASE_URL_TEST`, nombre terminado en `_test` y URL distinta de `DATABASE_URL` antes de migrar o conectarse.
- `DATABASE_URL_TEST` está configurada en `.env.local` (ignorado) apuntando a `corrector_uax_test` en Neon. Siguen sin configurarse el proveedor de despliegue/cron y los dispositivos físicos. Playwright/axe están configurados y sus suites ya se ejecutaron.

### Trabajo de cierre

1. **Endurecer la cola local.** Auditar su API para validar estrictamente todos los campos y rechazar campos adicionales; no persistir propiedades no permitidas. Hacer que cada operación IndexedDB espere el éxito de la transacción completa, manejar `blocked`/`versionchange`/cuota y probar aislamiento por cuenta, upgrade de esquema y borrados por cuenta/examen/alumno. Mantener idempotencia y cuerpo lógico idénticos en cada replay. Mantener el cooldown automático; reintento manual no debe quedar limitado por él.
2. **Completar la máquina de estados y los conflictos.** `2xx` elimina la entrada; red/`5xx` conserva y reintenta; `401` espera sesión del mismo propietario; `key_not_validated` espera la clave; `404`/`410` elimina y anuncia descarte; `exists`, `version_conflict` e `idempotency_conflict` bloquean sincronización automática. Para conflictos, volver a cargar el roster autenticado y presentar respuestas actuales junto a las respuestas de la cola, pregunta por pregunta. Permitir descartar o reabrir para revisión; reemplazar requiere confirmación explícita, `expectedVersion` vigente y UUID idempotente nuevo. Guardar la nueva entrada antes de borrar la anterior para no perder respuestas si falla IndexedDB. Nunca reenviar bajo otro `ownerId`.
3. **Cerrar ciclo de cuenta y cascadas.** Verificar que la eliminación requiere sesión, contraseña Argon2 y confirmación estricta; ejecutar el borrado activo en transacción y confirmar las cascadas del esquema. En cliente purgar solo la partición local del propietario autenticado y cerrar sesión; si falla la purga local, indicar con claridad que la cuenta ya fue borrada y ofrecer una acción recuperable para eliminar esa partición. Probar JWT obsoleto después del borrado: ninguna ruta puede devolver datos activos.
4. **Comprobar telemetría DeepSeek.** Añadir pruebas que capturen los eventos de error y validen una allowlist exacta (`eventId`, código normalizado, status, intentos, duración); asegurar ausencia de texto, IDs de cuenta/examen, PII, token y cuerpos. En el editor mantener el texto local y el consentimiento explícito, mostrar el error genérico y ofrecer botón explícito de reintento; no reintentar automáticamente operaciones facturables.
5. **Completar purga periódica de rate-limit.** Centralizar el borrado por expiración (ventana de 15 minutos) y exponer una tarea interna protegida con secreto de cron, respuesta sin datos de filas y comparación segura del secreto. Añadir test del secreto y del filtro temporal. La llamada periódica en el proveedor queda pendiente de configuración; la purga al intentar autenticación se mantiene como defensa adicional. Al borrar cuenta limpiar las claves email y email/IP conocidas de la solicitud actual sin almacenar email o IP en claro.
6. **Aislar pruebas PostgreSQL.** Añadir validador compartido que exija `DATABASE_URL_TEST`, compruebe que el nombre de base termina en `_test` y que la URL no coincide con `DATABASE_URL`; fallar antes de abrir conexión si cualquiera falla. Crear comandos explícitos para migrar y ejecutar tests DB con esa URL, sin fallback a la URL por defecto de `drizzle.config.ts`; no truncar ni borrar tablas globalmente. Usar fixtures con IDs aleatorios y limpieza limitada a esos IDs. Cubrir aislamiento entre propietarios, borrados de alumno/examen/cuenta, rollback, contraseña y tombstones/idempotencia.
7. **Añadir automatización de navegador y accesibilidad.** Añadir Playwright para Chromium y WebKit y axe-core. Levantar app/harness con DeepSeek simulado sin permitir endpoints configurables fuera del entorno de test ni llamadas de red reales. Generar la hoja sintética en la prueba. Cubrir cámara/carga, revisión, modo offline, recarga, reconexión, replay con el mismo header, ACK, conflictos y reemplazo, separación por cuenta, borrado de cuenta y ausencia de `File`/`Blob`/multipart en red e IndexedDB. Ejecutar axe en login, dashboard, detalle, formularios, estados de error, conflicto y zona de peligro; corregir teclado/foco, nombres, anuncios, contraste, orden de lectura y objetivos táctiles conforme WCAG 2.2 AA.
8. **Registrar aceptación sin exagerar cobertura.** Añadir matriz manual reproducible con dispositivo, versión del SO/navegador, pasos, resultado y evidencia requerida. No marcarla ejecutada hasta probar Android Chrome e iOS Safari físicos, TalkBack/VoiceOver y auditoría de tráfico en remoto. No instalar service worker ni cachear rutas privadas.
9. **Validación integrada.** Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, tests DB con URL `_test`, Playwright en ambos motores, axe y `npm run build`. Revisar búsqueda de logs y red para garantizar que no hay datos personales, respuestas provisionales ni imagen. No ejecutar migraciones contra `DATABASE_URL` ni contra una base cuyo nombre no termine en `_test`.

### Puertas externas de producción

- El código y pruebas automatizables pueden completarse sin declarar producción lista. El usuario autorizó explícitamente el uso de la región us-east-2 (fuera de la UE); siguen pendientes la evidencia de TLS/cifrado en reposo, retención de backups/logs no superior a 30 días y purga efectiva.
- El endpoint/tarea de purga periódica requiere que el proveedor elegido invoque el cron con secreto; sin configuración y prueba de ejecución, la tarea periódica no se considera operativa.
- Ejecutar y registrar la matriz física Android/iOS, incluyendo lector de pantalla y auditoría de red. No inferir precisión OMR ni afirmar las métricas de Fase 3.
- Si `DATABASE_URL_TEST` o dispositivos reales siguen sin estar disponibles, detener solo esas verificaciones, no sustituirlas por `DATABASE_URL`, datos reales o emulación presentada como dispositivo físico, y dejar el release bloqueado.

### Resultado de implementación y verificación local

- [x] Cola local estricta, sync global/contextual, tombstones, comparación de conflictos y reemplazo manual con persistencia nueva antes de retirar la anterior.
- [x] Cuenta, cascadas, JWT obsoleto, telemetría sin PII, endpoint de cron y matriz manual reproducible.
- [x] `npm run typecheck`, `npm run lint`, `npm test` (58 pruebas) y `npm run build` pasan.
- [x] Axe sin violaciones en `/`, `/login`, `/registro` y en las páginas privadas cubiertas por E2E (detalle, conflicto y zona de cuenta).
- [x] `npm audit --omit=dev`: 0 vulnerabilidades de producción. `npm audit` completo informa 12 moderadas transitivas de desarrollo (`esbuild`/`minimatch`); el fix sugerido por npm requiere downgrades breaking y no se aplicó.
- [x] `npm run test:db`: 3 pruebas pasan en PostgreSQL Neon (`corrector_uax_test`, región us-east-2). El usuario autorizó explícitamente el uso fuera de la UE; la base normal no se usó.
- [x] `npm run test:e2e`: 14/14 pruebas pasan en Chromium y WebKit, incluidas axe, hoja OMR sintética, replay offline idempotente, conflictos, borrado de examen remoto, borrado de cuenta, JWT obsoleto y purga de la cola local.
- [x] Se corrigió el harness E2E: migraciones con `drizzle-kit` fuera de shell (ruta con espacios), guard re-evaluado en workers, origen único `localhost` para que `signOut` no cambie el almacenamiento de origen, y creación del esquema IndexedDB en la fixture.
- [x] Incidencia de registro 500: la base normal (`corrector_uax`) solo tenía aplicadas las migraciones 0000–0002. Se aplicaron 0003 y 0004 (`npm run db:migrate`); registro y login verificados por API y navegador (200 + sesión). El endpoint de registro ahora devuelve 503 con mensaje accionable y log técnico (`register_failed`) ante fallos transitorios de base, en lugar de un 500 opaco.
- [ ] Matriz Android/iOS y TalkBack/VoiceOver: pendiente de ejecución física.
- [ ] Evidencia de retención/cifrado/backups y ejecución programada real del cron: pendiente de confirmar con el proveedor y configurar la invocación. La región us-east-2 queda aceptada por decisión explícita del usuario.

## Plan vigente: corrección de calibración sobre la plantilla real

Este apartado sustituye las recomendaciones anteriores de aflojar umbrales y compensar la rejilla visualmente con deslizadores. Objetivo: detectar y mostrar correctamente las 200 burbujas de la plantilla `matriz respuestas_page-0001.jpg`, confirmada por el usuario como el archivo que falla (50 preguntas, A–D, izquierda 1–25 y derecha 26–50). Conservar el resto de Fases 5–7 y los controles de retoque existentes.

### Diagnóstico comprobado por lectura

- `matrix-calibrator.tsx:87–90` dibuja `bubble.x * width` y `bubble.y * height`, pero `calibrateMatrix` devuelve coordenadas canónicas relativas a los cuatro marcadores. El lector sí usa `projectMatrixPoint`. Esta discrepancia produce desplazamiento visual incluso si los centros guardados son correctos; los deslizadores pueden entonces corromper un perfil válido al compensar una vista previa incorrecta.
- En la imagen real, las cuatro marcas rodean exclusivamente la tabla situada en la mitad inferior, no las esquinas de la página. `pickFourCorners` usa objetivos al 10/90 % de toda la imagen y puede elegir letras/logo en lugar de las marcas superiores.
- `calibrateMatrix` filtra componentes y agrupa X/Y en toda la página, antes de rectificar la perspectiva. Seleccionar las columnas/filas más frecuentes no demuestra que sean burbujas ni que formen una rejilla coherente; incluye potencialmente cabecera, números y letras.
- `bubbleRadius` se calcula a partir del espaciado de filas/columnas, no del radio observado; la vista previa lo escala por ancho de página mientras el lector lo escala por el menor span de marcadores.
- Guardar/borrar en `MatrixCalibrator` no propaga el perfil a `OmrReader`: ambos reciben inicialmente `matrixProfile` desde `client.tsx`, sin callback que actualice ese dato.
- Las pruebas sintéticas actuales sitúan marcas en las esquinas de la hoja, carecen de cabecera y comprueban conteos/rango, no el error de reproyección real. La ejecución de `verify-calibration.ts` no se pudo realizar en modo planificación por permisos; no afirmar reproducción numérica antes de ejecutarla.

### Implementación ordenada

1. **Reproducir y fijar la referencia antes de cambiar el algoritmo.** Ejecutar localmente `scripts/verify-calibration.ts` sobre la imagen real y registrar selección de marcas y error de centros, no solo conteos. El archivo está presente pero no aparece en el glob ordinario; comprobar su condición de ignorado. Crear una fixture de regresión recortada/saneada de la plantilla en blanco y puntos de referencia anotados independientemente del detector. Si no se incluye el JPG en Git, generar una fixture equivalente con cabecera y marcas alrededor de la tabla y mantener además el chequeo local contra el original. Nunca incluir fotos de alumnos o datos de identidad. No generar el golden ejecutando el detector que se está probando.
2. **Unificar la geometría.** Usar un único par de transformaciones imagen <-> cuadrilátero canónico y una utilidad compartida para radios. Reproyectar los centros con `projectMatrixPoint` en la superposición del calibrador, no con tamaño completo de imagen. Estimar el radio de los contornos observados y expresarlo conforme al contrato persistido actual: radio en píxeles / menor span medio entre marcas. Vista previa y lectura deben convertirlo de la misma manera. Mantener el JSON actual (IDs pregunta/opción, X/Y canónicos y radio escalar); no introducir cambios de esquema por este arreglo. Validar finitud, cuadrilátero convexo, orden TL/TR/BL/BR y homografía no singular; rechazar configuraciones degeneradas.
3. **Seleccionar marcas por geometría de tabla, no por esquinas de foto.** Obtener candidatos compactos y cuadrados, agrupados por tamaño/solidez. Evaluar cuadriláteros candidatos mediante alineación, coherencia de tamaños y evidencia de dos bloques de burbujas dentro del marco; limitar el número de hipótesis para no disparar tiempo/memoria. No favorecer un marco mayor por sí solo ni inferir una cuarta marca en lectura automática si no existe evidencia suficiente. Conservar la selección manual como salida ante ambigüedad, indicando expresamente tocar el centro de cada cuadrado negro (no sus vértices).
4. **Detectar la rejilla dentro del marco rectificado.** Tras validar marcas, excluir componentes fuera del cuadrilátero y normalizar sus centros antes del clustering. Filtrar círculos/anillos mediante tamaño observado, forma, cierre/ocupación y soporte de borde; no basta su bounding box, porque letras y números también pasan ese filtro. Ajustar dos grupos de cuatro columnas y 25 filas para esta plantilla usando soporte real, espaciados y residuales; cada celda debe corresponder a una observación o quedar explícitamente no resuelta. No fabricar éxito seleccionando sin más los ocho/25 clusters más frecuentes. Mantener el camino genérico de dos bloques ya soportado para otras dimensiones, sin hardcodear píxeles ni forzar la plantilla de 50 sobre exámenes con otra configuración. Para configuraciones incompatibles, mostrar error y no renumerar silenciosamente las preguntas.
5. **Validación y ajustes seguros.** Identificar primera/última fila y A/D de cada bloque con etiquetas visibles (q1, q25, q26, q50). Exponer motivo de rechazo: marcas ambiguas, filas/columnas faltantes o exceso de residual. No habilitar guardado de una rejilla reconstruida sin evidencia suficiente. Mantener ajustes existentes en coordenadas canónicas, invalidar el estado de guardado cuando cambien y rechazar posiciones fuera del marco en vez de saturarlas con `clamp01`, que colapsa celdas en los bordes. Una modificación debe conservar separaciones y pasar la validación antes del PUT. Al reemplazar/rotar imagen cancelar resultados anteriores y no dejar overlays de otro análisis; cerrar bitmaps al sustituir/desmontar.
6. **Propagar el perfil guardado.** Añadir callback de guardado/borrado desde `MatrixCalibrator` al estado de `ExamDetalleClient`; solo actualizarlo tras ACK y, si procede, GET autenticado del perfil confirmado. Pasar ese mismo estado al lector. Al cambiar perfil durante una revisión, conservar la revisión explícita del docente sin recalcularla ni sobrescribirla automáticamente; el nuevo perfil se aplica a la siguiente lectura, con aviso si existe una revisión abierta. Tras borrar, impedir nuevas lecturas sin calibración.
7. **Perfiles previos y despliegue.** Mantener representación y DB existentes, sin borrar ni transformar automáticamente perfiles guardados. Mostrar instrucción de recalibrar los perfiles ajustados con la superposición antigua, pues no se puede reconstruir la intención de esos desplazamientos. No tocar resultados/notas ya guardados. Preparar el cambio local y sus pruebas; commit, push y redespliegue requieren solicitud explícita, no asumir autorización por despliegues de turnos anteriores.

### Validación obligatoria

- Sobre la plantilla real: los cuatro centros seleccionados deben coincidir con los cuadrados de la tabla, y las 200 burbujas con la numeración correcta. Error máximo de centro <= 20 % del radio observado frente a la referencia independiente, con tolerancia mínima de 2 píxeles por reescalado; registrar máximo/mediana, no solo un booleano o un conteo.
- Prueba de ida/vuelta geométrica con marco interno, márgenes asimétricos, rotación leve y perspectiva: proyectar a canónico y volver no desplaza los puntos más de la tolerancia numérica. Comprobar también radio/superposición frente a la misma región que muestrea OMR.
- Regresiones de detector: cabecera realista, logo/texto/números, cambios de resolución, iluminación, anillos tenues, marcas falsas cerca de las esquinas de página y una celda/fila ausente. Los casos ambiguos deben fallar sin generar una rejilla aparentemente válida. Cubrir dimensiones mínimas para evitar acceso a `rows[1]` con una sola fila.
- E2E Chromium y WebKit: subir la fixture de plantilla (no un perfil insertado directamente), detectar, inspeccionar coordenadas proyectadas/golden, guardar, leer una hoja marcada con ese perfil sin recargar la página y comprobar respuestas esperadas. Incluir fallo automático -> marcación manual, ajuste inválido, cambio de imagen y borrado de perfil. Verificar que ningún archivo/píxel se envía a API, logs o IndexedDB.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y E2E/DB únicamente con `DATABASE_URL_TEST`. No exigir métricas de precisión del corpus real a partir de una plantilla y unas fixtures; las pruebas físicas y de corpus siguen pendientes.

### Fuera de alcance

Nuevos formatos de hoja, OCR de numeración arbitraria, cambios de scoring/DeepSeek y migraciones de BD. Si esta plantilla se usa con otra cantidad de preguntas, no inferir un reparto distinto sin un requisito explícito; conservar las restricciones actuales y pedir confirmación en lugar de alterar la numeración impresa.

### Resultado de implementación (calibración)

- Corregida la superposición del calibrador: ahora reproyecta cada burbuja con `projectMatrixPoint` y dibuja el radio con `bubblePixelRadius`, la misma geometría que usa el lector. Antes multiplicaba coordenadas canónicas por el tamaño de la página.
- Selección de marcas por evidencia de tabla: agrupación por tamaño, combinaciones acotadas de cuatro esquinas, exclusión de marcos que dejen anillos fuera y desempate por área mínima. Se rechazaron marcos de cabecera y marcas falsas de esquina en la plantilla real y en la fixture realista. Filtro `fill >= 0.85` para no confundir discos de respuesta con marcas.
- Rejilla calculada dentro del marco rectificado: filas agrupadas con tolerancia en unidades canónicas, clustering local por fila, soporte por columna, regresión lineal por bloque y verificación de que cada celda tiene una burbuja observada. Tolerancias convertidas de píxeles a canónico (el error anterior colapsaba todas las filas en un cluster).
- Inferencia de la cuarta marca solo en calibración y con evidencia; la lectura automática sigue exigiendo cuatro marcas. Marcos fuera de la imagen y orden distinto de TL/TR/BL/BR se rechazan.
- Ajustes de rejilla sin saturación en los bordes: si una burbuja sale del marco se bloquea el guardado con aviso. Guardar/borrar propaga el perfil a `OmrReader`; si hay una revisión abierta se avisa y no se recalcula.
- Verificación sobre `matriz respuestas_page-0001.jpg`: marcas (230,763), (1044,763), (230,1507), (1044,1507); 200 burbujas; radio 10,75 px; q1A=(319,815), q25D=(568,1478), q26A=(761,815), q50D=(1011,1478).
- `npm test`: 65 pruebas pasan (incluye fixture con cabecera, marcas falsas, celda ausente, una sola fila y lectura con el perfil calibrado). `typecheck`, `lint`, `build` y E2E: 16/16 en Chromium y WebKit, incluido calibrar una plantilla subida, guardar y leer una hoja marcada sin recargar.
- No se ha hecho commit, push ni despliegue: el plan exige solicitud explícita. Siguen pendientes la matriz física Android/iOS y la evidencia del proveedor.

## Plan vigente: informes claros, móvil y retoque en vivo

Este apartado es el alcance vigente de la siguiente implementación. Preservar las funciones de recorte, retoque automático, roles, permisos y exportaciones ya desplegadas. No cambiar BD, credenciales, scoring ni resultados guardados.

### Decisiones y diagnóstico

- Renombrar `Probar lectura OMR` a **Introducir examen del alumno** y actualizar las referencias de ayuda/pruebas. Mantener la denominación técnica OMR solo en instrucciones secundarias cuando sea útil.
- El usuario confirmó que quiere ver expresamente **Marcó B · Correcta: C** ante un fallo en ambos PDF: informe detallado y antiguo PDF de resultados. El modelo del informe ya contiene `given`, `correct` y `outcome`; no falta persistencia de la respuesta correcta.
- `pdf.ts:renderReportStudent` ya imprime una columna `Correcta`; `buildResultsPdf` solo colorea el fallo. Mejorar ambos sin cambiar los datos ni duplicar el motor de corrección. Con clave sin validar no mostrar correcciones como definitivas.
- Los sliders actuales solo llaman `setTone`; el repintado ocurre al pulsar el botón de aplicar. `paint` mezcla dibujado, estado y parámetros usados por el worker, por lo que no debe llamarse sin refactor a cada movimiento.
- El CSS móvil obliga a un ancho mínimo de 620px para la revisión y el recorte usa una sombra de 9999px sin contención. Playwright solo tiene proyectos Desktop Chrome/Safari: falta evidencia móvil automatizada.

### Implementación

1. **Nombres y textos.** Cambiar el título a `Introducir examen del alumno` en `omr-reader.tsx`. Explicar el flujo en términos de fotografía/archivo, revisión y guardado. Actualizar referencias visibles y selectores de pruebas sin renombrar rutas o contratos internos innecesariamente.

2. **Respuesta correcta en los dos PDF.** Reutilizar la clave validada y la comparación de respuestas existente; el informe detallado debe mostrar `Fallo · Correcta: C` junto a la respuesta dada o una segunda línea equivalente, además de la columna correcta. En el antiguo PDF de resultados, la celda debe incluir las dos letras (por ejemplo `B → C`) y una leyenda explícita, no solo color. Usar texto ASCII si la fuente PDF no soporta una flecha. Ajustar ancho/alto de filas y paginación con medición de texto; no mantener `lineBreak: false` si recorta el mensaje. Mantener conteos, desglose y nota exactos. No mostrar una letra inventada ante clave incompleta/no validada; conservar el estado pendiente y pruebas de autorización. CSV/Excel conservan sus columnas existentes de respuesta y correcta.

3. **Separar previsualización de análisis.** En el lector extraer un pintado sin efectos de estado, basado siempre en el bitmap original + rotación + recorte + tono vigente. Conservar una fuente limpia sin overlays para el worker. La vista previa debe usar exactamente la misma fórmula de brillo/contraste que se aplicará al análisis, no un filtro CSS con otra semántica. Diferenciar ajustes visibles/borrador de los parámetros del último análisis; evitar que mover un slider cambie silenciosamente el significado de una revisión existente.

4. **Previsualización en vivo eficiente.** En cada cambio del slider actualizar el valor visible y programar un solo repintado con `requestAnimationFrame`, coalesciendo movimientos rápidos. Cachear la base rotada/recortada mientras no cambien geometría o archivo para evitar reconstruirla completa por evento; no crear copias grandes sin límite. Limpiar frames pendientes y buffers al cambiar imagen/reiniciar/desmontar. No disparar worker, red, confirmaciones ni reiniciar revisión desde el movimiento del slider. Desactivar la edición durante un análisis en curso para evitar carreras.

5. **Aplicar y releer con seguridad.** Mantener una acción explícita `Aplicar ajustes y releer` que analice el tono y recorte que se ven. Con revisión abierta pedir confirmación antes de modificar su estado; cancelar conserva selección de alumno, respuestas y confirmaciones. Avisar `Vista previa modificada; relee para actualizar la detección` cuando el tono difiera del último análisis, sin impedir guardar una revisión manual ya válida. El botón de retoque automático debe preparar el tono y seguir el mismo camino de previsualización/análisis explícito, no modificar la imagen o parámetros antes de una confirmación que pueda cancelarse. Mantener los marcadores alineados; ningún overlay puede entrar en los píxeles analizados. Cubrir también restablecer recorte, rotación y selección manual mientras existen ajustes pendientes.

6. **Diseño responsive.** Auditar login/registro, dashboard y detalle, priorizando introducción de examen, foto + sliders, calibración, revisión, roster y exportaciones. Mantener el diseño actual. A 320–430px: sin scroll horizontal de página; controles sin solapamiento; textos largos y nombres pueden partir; acciones envuelven o apilan; objetivos táctiles de aproximadamente 44px y foco visible. En móvil mantener foto y sliders próximos mediante un panel compacto adaptable a la altura disponible, sin sticky que tape contenido/teclado. El lienzo conserva proporción y no se deforma por `max-height` junto a dimensiones intrínsecas. La tabla de revisión puede conservar desplazamiento local accesible si no cabe; no reducir fuente hasta hacerla ilegible ni duplicar formularios interactivos para móvil/escritorio. Contener el sombreado de recorte dentro del área de imagen; porcentajes del overlay y coordenadas de puntero deben referirse al rectángulo real del lienzo (sin bordes/padding/márgenes añadidos). Arrastrar no desplaza la página mientras se recorta, y el scroll normal funciona fuera de ese modo. Conservar selección y proporciones al girar la pantalla.

### Pruebas y aceptación

- Unitarias PDF/modelo: fallo con respuesta distinta y letra correcta explícita en ambos PDF; acierto y blanco; clave pendiente/incompleta; 100 preguntas, nombres largos y paginación sin truncar ni perder el cálculo. Asegurar que pruebas comprueban relación pregunta/respuesta/correcta, no solo presencia global de una letra.
- Unitarias de retoque: vista previa/análisis producen los mismos píxeles para brillo/contraste; no hay efecto acumulativo al mover el slider y volver al valor inicial; secuencias recorte/rotación/restablecimiento mantienen coordenadas coherentes.
- Ampliar Playwright con cobertura móvil Chromium y WebKit (perfiles o contextos móviles aislados), sin presentar emulación como teléfono físico. Comprobar 320, 375/390 y 430px y orientación horizontal, además del escritorio existente. Usar fixtures sintéticas y base `_test` exclusivamente.
- E2E: subir fotografía, mover cada slider y comprobar cambio medible de píxeles antes de pulsar aplicar; restaurar valores restaura la imagen; ningún worker de lectura ni request de guardado se dispara al moverlos. Revisiones, alumno y confirmaciones se conservan; aplicar relee; cancelar no destruye revisión. Probar recorte por eventos táctiles, cancelar/restablecer y marcado manual después del retoque. Verificar ausencia de desbordamiento global, controles visibles, axe y navegación por teclado.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` y las suites DB/E2E disponibles con `DATABASE_URL_TEST`. Registrar las limitaciones de móviles físicos; no prometer detección perfecta con cualquier iluminación, reflejo o desenfoque.

### Entrega y límites

No requiere migraciones ni acceso a datos reales de alumnos. No modificar la cuenta administradora ni variables de despliegue. Esta solicitud no autoriza por sí sola commit/push/despliegue: preparar implementación verificada y esperar petición explícita para publicar. Las pruebas en Android/iOS físicos y las garantías del proveedor siguen siendo comprobaciones externas independientes.
