# Plan de implementación: Fase 3 — Lectura OMR local

## Alcance y contexto

Implementar la lectura OMR de una foto de hoja rellenada, reutilizando `exam_matrix_profiles` y la geometría normalizada de Fase 2. Esta fase es un banco de lectura en el detalle del examen: captura/selección local, corrección de perspectiva, detección de respuestas y confianza visible. **No** guardar imagen, lectura, alumno ni nota; roster, revisión/edición de dudosas, puntuación y guardado quedan para Fase 4/5. No tocar ni revertir los cambios sin confirmar de Fases 1/2.

## Decisiones acordadas

- La matriz UAX calibrada es de 50 preguntas en dos bloques; Fase 3 habilita OMR hasta 50 preguntas. Los exámenes de 51–100 siguen existiendo, pero el botón de lectura queda deshabilitado con explicación hasta contar con una matriz multipágina.
- Entrada: cámara trasera en móvil (`capture=environment`) y selector de archivo alternativo para móvil/escritorio. Aceptar imagen; limitar a 20 MB y procesar una versión local con lado máximo 2000 px.
- La foto debe estar en orientación vertical como la matriz. Corregir inclinación/perspectiva moderada con las marcas; si falta una marca, el papel está recortado o la foto está girada 90°, rechazar con instrucción de repetir.
- Todo el procesamiento (decodificación, escala de grises, transformada, medidas y revisión de resultados) ocurre en navegador/Web Worker. No transmitir ni persistir foto, recortes, pixeles, coordenadas del alumno ni lectura OMR. No registrar esos datos en logs.
- Procesamiento en JavaScript propio dentro de Web Worker; usar geometría fija ya calibrada, no añadir OpenCV.js en esta fase.
- Clasificación provisional: una opción con relleno claro = `ok`, ninguna = `blank`, más de una = `multiple`, señal débil/ambigua = `faint`; cada respuesta lleva confianza 0–1. No se autoacepta ni persiste nada en esta fase; no presentar umbrales como validados.
- Los objetivos de evaluación ≥99 % de exactitud autoaceptada / ≤1 % de omisión de revisión quedan explícitamente pendientes hasta tener corpus anonimizado representativo, tal como se acordó. La foto real local existente solo se usa como smoke test no versionado: contiene nombre y DNI.

## Trabajo

1. Reutilizar/refactorizar el detector de componentes de `src/lib/matrix/detect.ts` para exponer detección segura de marcas de registro y transformación perspectiva compartida por calibración y OMR. Validar marcadores, orientación, área útil y escala antes de muestrear.
2. Añadir `src/lib/omr` con función pura de lectura que reciba pixeles en gris, perfil persistido (burbujas/radio) y dimensiones del examen. Proyectar cada coordenada normalizada de la matriz sobre la hoja fotografiada; estimar el relleno dentro del centro de cada burbuja usando el fondo local para tolerar variación moderada de iluminación; comparar las opciones de cada pregunta y devolver `{ q, detected, confidence, flag }` sin dato del alumno.
3. Añadir un Web Worker dedicado con protocolo tipado, transferencia de `ArrayBuffer` (no clonar grandes imágenes), cancelación/error controlado y sin acceso de red. El hilo UI solo decodifica/redimensiona y muestra progreso; el procesamiento de pixeles y clasificación se ejecuta en el worker.
4. Integrar en detalle del examen una tarjeta **Probar lectura OMR** habilitada solo si existe matriz calibrada y `numQuestions ≤ 50`. Presentar acciones **Abrir cámara** y **Elegir imagen**, mostrar previsualización temporal, progreso y mensaje de calidad; descartar la imagen de memoria al reiniciar/salir/cancelar. Si la geometría no existe, ofrecer ir a calibración.
5. Mostrar una tabla local de pregunta, opción detectada, confianza y estado; resaltar `blank`, `multiple` y `faint`. Incluir leyenda de que la lectura es provisional y que Fase 4 añadirá revisión humana. No puntuar ni escribir a PostgreSQL.
6. Añadir límite de tamaño y checks de calidad básicos: imagen válida, orientación vertical, cuatro marcas/quad válido, resolución suficiente, blur/iluminación claramente insuficientes. Rechazar con mensajes accionables; no adivinar respuestas cuando falla la geometría.

## Validación

- Tests puros con hoja sintética transformada (perspectiva, escala y leve giro): localizar marcas y recuperar centros calibrados dentro de tolerancia; faltan marcas/recorte/orientación apaisada deben rechazarse.
- Casos de lectura de burbujas: respuesta limpia, blanco, doble marca, marca tenue, tinta/iluminación no uniforme y ninguna respuesta. Verificar flags/confianza y que no hay orden/permutación de opciones.
- Ejecutar smoke test local explícito con la foto `IMG-20261029-WA0000.jpg` (contiene PII), sin copiarla, versionarla, mostrar nombre/DNI en logs ni subirla; comprobar 50 preguntas y revisar manualmente el resultado agregado. También probar la imagen limpia de matriz como entrada errónea: no debe interpretarse como hoja rellenada.
- Suite automática con datos sintéticos; no reclamar métricas 99 % / 1 % con una sola hoja real. Documentar como pendiente hasta reunir hojas etiquetadas y anonimizar cualquier corpus.
- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; verificar que no se han añadido rutas de upload/storage ni migraciones en esta fase y que `.env.local`, PDFs/JPG y datos personales siguen fuera de Git.
- No hacer commit/push salvo petición explícita.

## Riesgos y límites

- La matriz está calibrada con una foto real de alta resolución, pero los umbrales de tinta y calidad aún no tienen validación estadística. Mantener la lectura como provisional; Phase 4 debe forzar revisión manual antes de guardar/puntuar.
- Los exámenes >50 preguntas quedan fuera del flujo OMR hasta que exista calibración multipágina.
- Marcas tapadas, cortes fuertes, giros de 90° y fotos muy borrosas se rechazan; no se corrigen automáticamente en esta versión.
- El smoke test real contiene nombre y DNI y se procesa exclusivamente en memoria local; el archivo existente debe seguir ignorado y nunca formar parte de fixtures versionados.
