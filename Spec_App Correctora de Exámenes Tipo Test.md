# Spec: App Correctora de Exámenes Tipo Test

Documento para guiar a agentes de IA (Claude Code, etc.) en la construcción de la app. Versión 0.4. Basado en el boceto «Flujo APP correctora examen».

## 1. Resumen

Herramienta para que el profesor acelere la corrección de exámenes tipo test: fotografía con el móvil la hoja de respuestas de un alumno, la app la lee, la compara con la clave que el propio profesor ha validado y muestra la puntuación al momento. La app guarda en el servidor las respuestas y la nota de cada alumno (nunca la foto) para consultarlas desde cualquier dispositivo y exportarlas; el profesor pasa las notas a mano, o con un fichero exportado, a la plataforma del centro.

El boceto original tiene dos ramas que ahora se reparten así:

1. **Clave del examen (una vez por examen)**: PDF del examen → LLM (DeepSeek) → respuestas teóricas → el profesor las revisa y las valida.
2. **Corrección (una vez por alumno y examen)**: foto de la plantilla de test → OMR → el profesor revisa las lecturas dudosas → confirma → el servidor guarda las respuestas finales y la nota → se muestra el resultado. Cada examen tiene su propio roster y una sola entrega vigente por alumno.

### Fuera de alcance

- Integraciones automáticas con otras plataformas: las notas se pasan a mano o con un fichero exportado.
- Guardar las fotos de las hojas: se descartan al terminar de corregir cada hoja.
- Preguntas de desarrollo y más de una respuesta correcta por pregunta.
- Corrección en lote y rol de administrador.

## 2. Usuarios

- **Profesor**: único rol. Cada profesor tiene su cuenta y solo ve sus propios exámenes.
- Los alumnos no usan la app. Cada examen mantiene sus propios registros de alumnos, identificados por una etiqueta escrita o importada por el profesor; no se reutiliza la identidad del alumno entre exámenes.

## 3. Flujo de uso

**Preparar el examen (una vez, en ordenador o móvil)**

1. Crear el examen: título, número de preguntas y número de opciones (por defecto 4).
2. Subir el PDF. El texto se extrae en el navegador y el servidor lo envía a DeepSeek, que devuelve la clave.
3. Revisar y editar la clave y pulsar **Validar**. Sin clave validada no se puede corregir.
4. Añadir alumnos al roster del examen, escribiendo sus etiquetas o importándolas desde CSV. La etiqueta debe ser única dentro de ese examen.
5. Imprimir la plantilla de respuestas que genera la app y repartirla a los alumnos.

**Corregir (en el móvil, hoja por hoja)**

6. Elegir el examen y pulsar **Corregir hoja**; seleccionar un alumno del roster pendiente.
7. Fotografiar su hoja con una guía de encuadre en pantalla.
8. El móvil lee las marcas (OMR). Si la foto no sirve (borrosa, recortada, poca luz), se pide otra.
9. Las preguntas dudosas se muestran con un recorte temporal de la foto para que el profesor decida. La foto y los recortes solo viven en memoria local y se descartan al terminar o cancelar.
10. Tras resolver las dudosas, el profesor confirma la corrección. La app guarda atómicamente las respuestas finales y la nota en el servidor; solo después del éxito muestra aciertos, fallos, blancos, nota y preguntas falladas con su respuesta correcta. Si ya existe una entrega, se pide confirmación explícita para reemplazarla.

La foto se procesa por completo en el móvil y se descarta: al servidor solo llegan las respuestas finales, las correcciones del profesor y la nota. Si falla la red al confirmar, la corrección queda como borrador local reintentable, no como entrega guardada. Un reintento no duplica la entrega.

**Consultar y exportar (desde cualquier dispositivo)**

11. Abrir un examen y ver el roster con sus respuestas, aciertos, fallos, blancos y nota cuando exista una entrega, y el estado pendiente o corregido. Los pendientes son los registros del roster sin entrega confirmada.
12. Abrir la ficha de un alumno, editar una respuesta si hubo un error y recalcular su nota. Seguir corrigiendo hojas pendientes desde otro móvil u ordenador.
13. Exportar la clave generada por la IA o el listado de alumnos con sus respuestas y calificaciones en los formatos admitidos para cada tipo de exportación.

## 4. Decisiones de diseño

1. **La app calibra la matriz del centro a partir de una imagen** de la hoja de respuestas en blanco. Se detectan las cuatro marcas de registro y la rejilla de burbujas, y se guarda por examen la geometría normalizada (coordenadas), no la imagen. Leer sin calibración es mucho menos fiable.
2. **El LLM nunca puntúa.** Solo genera la clave. Comparar y puntuar es código determinista.
3. **La clave la valida siempre el profesor** antes de corregir. El LLM puede equivocarse; es el control más importante.
4. **El OMR siempre devuelve confianza** y marca las lecturas de baja confianza para revisión. Solo se autoaceptan lecturas que superen el umbral calibrado y validado con el conjunto de prueba; no se promete detectar perfectamente toda ambigüedad.
5. **Privacidad por diseño**: la foto se procesa en el navegador y se descarta. En el servidor solo se guardan las respuestas finales confirmadas y la nota de cada alumno, nunca la imagen ni las lecturas OMR en bruto.
6. **Móvil primero**: pantallas pensadas para usar con una mano y pocos toques por alumno.

## 5. Arquitectura y stack

- **Frontend**: Next.js (TypeScript, App Router) como PWA, mobile-first, desplegado en Vercel.
- **Servidor**: rutas API de Next.js, PostgreSQL (Neon) con Drizzle ORM y Auth.js (email). Guarda usuarios, exámenes, claves, reglas de puntuación, roster por examen, entregas, respuestas y notas. No guarda el PDF del examen ni las fotos de las hojas.
- **LLM**: API de DeepSeek llamada desde el servidor (la clave de API nunca llega al navegador), con salida JSON estricta. Capa intercambiable mediante una interfaz `AnswerKeyProvider`.
- **Texto del PDF**: pdf.js en el navegador; al servidor solo llega el texto del examen. Si el PDF es escaneado, OCR en el navegador (Tesseract.js) o clave introducida a mano.
- **Matriz**: el profesor sube una imagen de la hoja de respuestas del centro. La calibración (marcas, perspectiva y rejilla) ocurre en el navegador y solo se guardan las coordenadas normalizadas por examen; la imagen no se transmite ni persiste.
- **OMR**: en el móvil, dentro de un Web Worker, con OpenCV.js (corrección de perspectiva con las marcas de registro y medición de relleno por burbuja). Si OpenCV.js resulta pesado en móviles de gama baja, se puede hacer la detección con canvas y JavaScript propio, viable porque la plantilla es fija.
- **Sincronización entre dispositivos**: la fuente de verdad es el servidor. Cada dispositivo carga el examen y su roster al abrirlo. Las ediciones concurrentes de respuestas requieren control de versión o aviso de conflicto; no se sobrescribe silenciosamente una edición concurrente.
- **Exportación**: se genera en el servidor a partir de los datos guardados. La matriz de formatos admitidos está definida en M7 y en el contrato del endpoint.
- **Conexión**: hace falta red para confirmar una entrega. Si falla, la corrección completa queda pendiente localmente y se reintenta con una clave de idempotencia; no se presenta como guardada hasta recibir confirmación del servidor.

## 6. Modelo de datos (servidor)

- `users(id, name, email)`
- `exams(id, owner_id, title, subject, num_questions, num_options, status, created_at)`; status: `draft | key_pending | key_validated`
- `answer_key_items(exam_id, question_no, correct_option, llm_confidence, edited_by_teacher)`: clave única `(exam_id, question_no)` y FK a `exams`.
- `scoring_rules(exam_id, points_correct, points_wrong, points_blank, max_score)`: una regla vigente por examen.
- `exam_students(id, exam_id, label, normalized_label, created_at)`: roster propio del examen; `label` es el nombre, código o alias que decide el profesor; `normalized_label` se calcula recortando espacios exteriores y normalizando mayúsculas/minúsculas, y es único junto con `exam_id`. No se comparte identidad entre exámenes.
- `submissions(id, exam_id, student_id, correct, wrong, blank, raw_score, score, created_at, updated_at, version)`: una entrega vigente por alumno y examen, única por `(exam_id, student_id)`; `student_id` referencia `exam_students`. Solo se persiste una entrega confirmada.
- `submission_answers(submission_id, question_no, final_option, edited_by, edited_at)`: única por `(submission_id, question_no)`; `final_option` es nula si queda en blanco y contiene solo la respuesta final confirmada, no el resultado OMR en bruto.
- `idempotency_keys(owner_id, exam_id, key, request_hash, submission_id, created_at)`: unicidad por `(owner_id, exam_id, key)`; repetir la misma clave con el mismo cuerpo devuelve el estado actual de la entrega sin duplicar; reutilizarla con otro cuerpo devuelve conflicto. La retención de estas claves debe cubrir la ventana de reintento local.

La foto no se guarda nunca: se procesa en el móvil y se descarta. Durante la captura y revisión, la imagen, los recortes y la lectura en bruto viven solo en memoria local (`{ answers: [{ q, detected, confidence, flag }], quality }`, con `flag` en `ok | blank | multiple | faint`). Al confirmar, una transacción guarda las respuestas finales y sus conteos/nota calculados, nunca `detected`, `confidence` ni `flag`. Si no hay conexión, el borrador de respuestas se conserva localmente para reintento, pero no cuenta como entrega confirmada; la imagen y los recortes no se incluyen en ese borrador. Un reemplazo requiere confirmación explícita y actualiza la entrega vigente; no se conserva historial en esta versión. La nota es un dato derivado persistido para agilizar listados y se recalcula con la clave validada y la regla vigente. El roster permite calcular pendientes como alumnos sin entrega confirmada.

Las tablas relacionadas deben imponer integridad referencial para que una entrega solo relacione un examen con un miembro de su propio roster (por ejemplo, `exam_students` tiene `UNIQUE(exam_id, id)` y `submissions` tiene FK compuesta `(exam_id, student_id)` a esa clave, además de `UNIQUE(exam_id, student_id)`). `submission_answers` debe tener una respuesta final por pregunta del examen. Todas las consultas y escrituras verifican el propietario del examen en el servidor; no basta con confiar en IDs enviados por el cliente.

## 7. Requisitos funcionales

### M1. Examen y clave

- Crear examen con número de preguntas y de opciones. Subir PDF (máx. 20 MB) y extraer su texto.
- Prompt del LLM: responder cada pregunta y devolver únicamente JSON `[{"q":1,"answer":"B","confidence":0.0-1.0}]`. Validar el esquema y reintentar una vez si es inválido.
- Antes de validar, exigir exactamente una respuesta por pregunta, numeración dentro de `1..num_questions`, sin preguntas duplicadas y opción dentro de `num_options`. Rechazar claves incompletas o inválidas tanto en la interfaz como en el servidor.
- Pantalla de revisión: tabla editable que resalta las respuestas de baja confianza. El botón **Validar clave** solo se habilita si la clave está completa y válida.
- Alternativa: introducir o pegar la clave a mano.

### M2. Plantilla

- Calibrar la matriz del centro subiendo una imagen de la hoja en blanco: detectar marcas de registro y burbujas, y guardar la geometría por examen. La app no imprime plantillas; el profesor indica a quién pertenece la hoja antes de fotografiarla.

### M3. Captura y lectura

- Foto con la cámara del móvil desde el navegador, con guía de encuadre y aviso de poca luz.
- Corrección de perspectiva con las marcas de registro. Rechazo con mensaje claro si no se detectan.
- Por pregunta: opción detectada, confianza y bandera (`ok`, `blank`, `multiple`, `faint`). El umbral de autoaceptación debe calibrarse con el conjunto de prueba de la Fase 3.
- Todo el procesamiento ocurre en el móvil; la imagen no se sube.

### M4. Revisión de dudosas

- Lista solo de las preguntas con bandera distinta de `ok`, cada una con un recorte temporal de la foto y botones para las opciones configuradas o en blanco (no limitar a A/B/C/D cuando haya más o menos opciones).
- No se muestra nota mientras queden dudosas sin resolver.
- La imagen y los recortes no se guardan ni se transmiten; se descartan al confirmar o cancelar la revisión.

### M5. Comparar, puntuar y resultado

- Comparar la opción final con la clave validada.
- Regla configurable por examen: `points_correct > 0`, `points_wrong <= 0`, `points_blank <= 0` y `max_score > 0`. Por defecto `points_correct=1`, `points_wrong=0`, `points_blank=0`, `max_score=10`.
- Fórmula normativa: `raw_score = correct × points_correct + wrong × points_wrong + blank × points_blank`; `bounded_score = clamp(raw_score, 0, num_questions × points_correct)`; `score = round_half_up(bounded_score / (num_questions × points_correct) × max_score, 2)`. Los conteos deben sumar `num_questions`; clasificar cada pregunta comparando su `final_option` con la clave validada: coincide = acierto, opción distinta = fallo, sin opción = blanco. Las banderas OMR no determinan la puntuación una vez que el profesor ha resuelto la lectura.
- El módulo compartido de puntuación es la única implementación de esta fórmula. Servidor y cliente deben usar el mismo resultado; el servidor valida todas las entradas y es la autoridad.
- Al confirmar, guardar respuestas, conteos y nota en una sola transacción. Mostrar el resultado como persistido solo tras éxito. La petición incluye clave de idempotencia para reintentos. Si ya existe entrega, reemplazarla solo tras confirmación explícita del profesor; cancelar conserva la entrega anterior.

### M6. Alumnos, consulta y edición

- Crear el roster del examen escribiendo etiquetas o importándolas desde CSV. Rechazar etiquetas vacías o duplicadas dentro del mismo examen (comparación normalizada, sin distinguir mayúsculas/minúsculas y recortando espacios exteriores). La misma etiqueta puede usarse en otro examen.
- Listado por examen con todos los integrantes del roster, aciertos, fallos, blancos y nota cuando exista entrega, y estado derivado: `pending` si no hay entrega confirmada, `confirmed` si existe (en la interfaz se muestra como «Pendiente» o «Corregido»). Permitir búsqueda y orden.
- Ficha del alumno: sus respuestas frente a la clave, sin foto. Se puede editar una respuesta y la nota se recalcula.
- Se puede seguir corrigiendo desde otro dispositivo con la misma cuenta. Cada profesor solo ve sus exámenes y alumnos.
- Si cambia la clave validada o la regla de puntuación, recalcular en transacción todas las notas afectadas, mantener respuestas/conteos y avisar al profesor. No permitir que una edición concurrente sobrescriba silenciosamente datos más recientes; usar `version` o un control equivalente.
- Al reemplazar una entrega, la nueva entrega completa sustituye la vigente de forma atómica; si falla el guardado, la anterior permanece intacta.

### M7. Exportación

- **Clave**: CSV, Excel (.xlsx), PDF (hoja de clave imprimible) y JSON.
- **Resultados/roster**: CSV y Excel (.xlsx), con una fila por alumno del roster, respuestas pregunta a pregunta, aciertos, fallos, blancos y nota; las entregas pendientes tienen respuestas y nota vacías y estado `pending`. Excel colorea aciertos y fallos. PDF con resumen del examen y fichas individuales, incluyendo el estado pendiente cuando no hay entrega. JSON no se admite para resultados en esta versión.
- El endpoint solo admite estas combinaciones: `type=key` con `format=csv|xlsx|pdf|json`; `type=results` con `format=csv|xlsx|pdf`.
- CSV en UTF-8 con BOM y separador configurable (coma o punto y coma), con escape estándar de campos y cabeceras estables en español para que Excel en español lo abra bien.
- La exportación incluye solo los alumnos y exámenes del profesor que la pide.

## 8. API y módulos

En el servidor:

- `POST /api/exams` · `GET /api/exams` · `GET /api/exams/:id`
- `POST /api/exams/:id/key/generate`: recibe el texto extraído del PDF, llama a DeepSeek y devuelve la clave en JSON
- `PUT /api/exams/:id/key` · `POST /api/exams/:id/key/validate` (la validación del servidor comprueba integridad y opciones)
- `PUT /api/exams/:id/scoring`
- `GET|POST /api/exams/:id/students` · `PATCH|DELETE /api/exams/:id/students/:studentId`: gestiona roster por examen; POST admite importación CSV y rechaza duplicados normalizados
- `PUT /api/exams/:id/submissions/:studentId`: guarda o reemplaza atómicamente las respuestas finales; exige `Idempotency-Key`. El servidor registra la clave y un hash del cuerpo; misma clave/cuerpo devuelve el estado actual sin duplicar, y misma clave/cuerpo distinto devuelve conflicto. Si ya existe entrega, requiere confirmación explícita de reemplazo (salvo repetición de la misma clave idempotente). Devuelve nota y estado persistido calculados por el servidor.
- `GET /api/exams/:id/submissions` · `GET /api/exams/:id/submissions/:studentId` (el listado incluye roster y estado `pending|confirmed`, presentado como Pendiente/Corregido)
- `PATCH /api/exams/:id/submissions/:studentId/answers`: edita respuestas y recalcula
- `GET /api/exams/:id/export?type=key|results&format=...`: aplica la matriz de formatos de M7; rechaza combinaciones no admitidas
- Todos los endpoints comprueban sesión y propiedad del examen/roster/entrega en cada solicitud; errores de autorización no revelan si un recurso ajeno existe.

En el navegador:

- `matrix.calibrate(imagen, numQuestions, numOptions)` detecta marcas y burbujas y devuelve la geometría normalizada
- `omr.read(imagen, geometría)` devuelve la lectura con confianza (Web Worker)
- `scoring.compute(clave, lectura, regla)` devuelve aciertos, fallos, blancos, bruto y nota conforme a la fórmula normativa de M5 (módulo compartido; el servidor valida y persiste el cálculo definitivo)

## 9. Requisitos no funcionales

- **Privacidad (RGPD)**: las fotos y recortes de las hojas no salen del móvil ni se guardan. En el servidor solo se guardan, por roster de examen, una etiqueta, las respuestas finales y la nota; las lecturas OMR en bruto se descartan localmente. Base de datos en una región de la UE, datos cifrados en tránsito y en reposo, autorización del propietario verificada en cada ruta y exportación. DeepSeek solo recibe el texto del examen, nunca datos ni etiquetas de alumnos; el profesor debe ser informado de este envío. El borrado de un alumno elimina su roster, entrega y claves de idempotencia asociadas; borrar un examen elimina sus claves, roster y entregas; borrar la cuenta inicia el borrado de todos sus datos. Aplicar estas eliminaciones también a logs/cachés y purgar copias de seguridad según una política de retención documentada antes de producción; no prometer purga inmediata de copias hasta que expire su retención.
- **Rendimiento**: de la foto al resultado en menos de 5 s en un móvil de gama media (objetivo a medir en la Fase 3).
- **Fiabilidad**: ninguna nota se muestra con lecturas dudosas pendientes. El resultado se presenta como persistido solo tras confirmación del servidor; el guardado es transaccional e idempotente, y un reemplazo fallido no altera la entrega anterior.
- **Compatibilidad**: Chrome en Android y Safari en iOS.
- **Observabilidad**: logs de las llamadas fallidas al LLM con botón de reintento. No registrar texto del examen, etiquetas, respuestas ni tokens/secretos en logs; definir retención y borrado de logs antes de producción.

## 10. Plan de trabajo para agentes

Cada fase termina con criterios de aceptación y tests. Ramas pequeñas y revisión de cada fase antes de pasar a la siguiente.

**Fase 0 — Base.** Repo, Next.js como PWA, Postgres/Drizzle, Auth, CRUD de exámenes. *Aceptación:* un profesor inicia sesión desde el móvil y crea un examen.

**Fase 1 — Clave.** Extracción de texto del PDF, integración con DeepSeek con JSON validado, pantalla de revisión y validación. *Aceptación:* con 3 exámenes de prueba se obtiene una clave editable y validable; si el LLM devuelve basura, se reintenta y se informa.

**Fase 2 — Calibración de la matriz.** Detección de las cuatro marcas de registro, corrección de perspectiva y rejilla de burbujas desde una imagen de la hoja del centro; guardado de coordenadas normalizadas por examen. *Aceptación:* una foto de la matriz (inclinada y con una marca poco nítida) produce 2 bloques × 25 filas × 4 opciones y la calibración se reutiliza al reabrir el examen; la imagen no sale del dispositivo.

**Fase 3 — OMR en el móvil.** Módulo en Web Worker con corrección de perspectiva y detección de burbujas; corpus de fotos reales etiquetadas manualmente, con partición de calibración y evaluación, dispositivos admitidos y condiciones documentadas (luz normal, sombra, hoja torcida, borrones). *Aceptación:* en el conjunto reservado, (a) ≥ 99 % de las respuestas autoaceptadas coinciden con la referencia manual y (b) ≤ 1 % de las preguntas etiquetadas como ambiguas/ilegibles por la referencia se autoaceptan en vez de enviarse a revisión. Publicar denominadores, tamaño/composición del corpus y métricas por condición. Una lectura de baja confianza se deriva a revisión; no se afirma que toda ambigüedad se detecta. Medir también tiempo en un móvil de gama media.

**Fase 4 — Corrección completa.** Captura con guía de encuadre, revisión de dudosas, comparación, puntuación, guardado transaccional e idempotente en el servidor y pantalla de resultado tras confirmación. Tests unitarios de blancos, penalización, doble marca, límites y redondeo. *Aceptación:* resultado idéntico a la fórmula normativa y una corrección manual de referencia; reintentar no duplica entregas, reemplazar requiere confirmación y un fallo de red conserva intacta la entrega anterior.

**Fase 5 — Alumnos y consulta.** Roster independiente por examen, importación CSV con etiquetas únicas, entregas, listado de pendientes, ficha con edición de respuestas, recálculo de notas y sincronización entre dispositivos con control de concurrencia. *Aceptación:* un alumno sin entrega aparece pendiente; al confirmar una hoja en un móvil, aparece corregida en un ordenador; etiquetas duplicadas se rechazan dentro del examen; al cambiar la clave, las notas se recalculan.

**Fase 6 — Exportación.** CSV/XLSX/PDF/JSON para la clave y CSV/XLSX/PDF para resultados/roster. *Aceptación:* las combinaciones no admitidas se rechazan; los ficheros se abren bien en Excel en español, incluyen estado pendiente cuando proceda y las cifras coinciden con el cálculo del servidor.

**Fase 7 — Endurecimiento.** Cola local de reintentos idempotentes si falla la red, pruebas en Android e iOS, accesibilidad, borrado de datos y revisión de privacidad (comprobar en la pestaña de red que ninguna imagen sale del móvil). Acordar/documentar la retención de copias de seguridad y logs antes de producción y verificar el borrado de acuerdo con esa política.

## 11. Instrucciones para los agentes

- Mantener este documento como fuente de verdad; proponer cambios antes de desviarse.
- Tipado estricto, validación de entradas con Zod, autorización por propietario en cada ruta y tests para toda la lógica de puntuación, OMR, aislamiento de datos, idempotencia y transacciones de reemplazo/recálculo.
- No almacenar claves en el repositorio; usar variables de entorno.
- Cada PR: descripción, tests pasando y captura de la pantalla afectada.

## 12. Supuestos y preguntas abiertas

Supuestos que he tomado (corrígelos si no son así):

- 4 opciones por pregunta, una sola correcta, hasta 100 preguntas por examen.
- Una hoja de respuestas por alumno, usando la matriz del centro calibrada por examen.
- Penalización por fallo configurable, desactivada por defecto.
- Se guardan las respuestas y la nota de cada alumno en el servidor; la foto nunca se guarda.
- Idioma de la interfaz: español. Los alumnos son universitarios y mayores de edad; el RGPD se aplica igualmente a sus datos.
- Cada examen mantiene su propio roster; sus etiquetas son únicas dentro del examen y no identifican/reutilizan al mismo alumno entre exámenes.
- Una entrega confirmada por alumno y examen. Una recorrección la reemplaza solo tras confirmación; no hay historial de intentos en esta versión.
- La nota se escala a `max_score` usando la fórmula de M5, con dos decimales.
- Criterios de evaluación OMR iniciales: exactitud ≥ 99 % entre respuestas autoaceptadas y tasa de omisión de revisión ≤ 1 % de las preguntas ambiguas/ilegibles de referencia, medidos en el corpus reservado descrito en Fase 3.

Pendientes de decidir antes de producción:

1. Acordar qué móviles/modelos mínimos y condiciones de captura se consideran admitidos; esto delimita el conjunto de evaluación OMR.
2. Definir la política operativa concreta de retención y purga de copias de seguridad/logs con el proveedor de infraestructura.
3. Confirmar si la plantilla propia del centro debe entrar en alcance; por defecto se usa la generada por la app.
4. Confirmar si los PDF escaneados requieren OCR en navegador o si la clave manual basta para el lanzamiento inicial.
5. Confirmar los valores iniciales de penalización y nota máxima del centro; se aplican los límites y fórmula definidos en M5.
