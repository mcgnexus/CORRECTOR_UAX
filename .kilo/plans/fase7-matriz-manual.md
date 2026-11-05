# Matriz manual de aceptación Fase 7

No marcar un caso como aprobado a partir de Playwright o emulación. Registrar una fila por dispositivo, navegador y versión reales. No incluir nombres, DNI, imágenes de exámenes reales ni credenciales en capturas o evidencias.

## Metadatos de ejecución

| Campo | Valor |
|---|---|
| Fecha/hora y zona | Pendiente |
| Responsable | Pendiente |
| Modelo de dispositivo | Pendiente |
| Sistema operativo y versión | Pendiente |
| Navegador y versión | Pendiente |
| Versión de la app/commit | Pendiente |
| Red utilizada | Pendiente |
| Identificador de evidencia sintética | Pendiente |

## Casos

| ID | Caso y pasos reproducibles | Resultado esperado | Evidencia a recoger | Resultado |
|---|---|---|---|---|
| MOB-01 | Abrir el detalle del examen, usar cámara, denegar y luego permitir permiso; volver a entrar tras recargar. | La app explica el permiso, no se bloquea y no envía la imagen. | Grabación de pasos y log de red sin cuerpo de imagen. | Pendiente |
| MOB-02 | Capturar una hoja sintética en vertical; repetir con el dispositivo rotado y orientación automática desactivada. | Vista previa local legible; ninguna petición de red contiene foto, recorte o `Blob`. | Versión de navegador, captura sintética y panel Network. | Pendiente |
| MOB-03 | Revisar cada respuesta con teclado y lector de pantalla; cambiar una opción y guardar solo tras confirmar todas. | Orden de foco lógico, labels anunciados, progreso/error audible y guardado confirmado. | Vídeo TalkBack/VoiceOver y resultado por pregunta. | Pendiente |
| MOB-04 | Interrumpir red tras revisar, guardar, cerrar la pestaña, reabrir con la misma cuenta y reconectar. | Cola IndexedDB sobrevive; el replay conserva cuerpo y `Idempotency-Key`; al ACK desaparece. | DevTools/Application e historial de requests con IDs sintéticos. | Pendiente |
| MOB-05 | Cambiar sesión de cuenta con una entrega pendiente y luego volver a la cuenta propietaria. | Ninguna otra cuenta ve ni envía esa partición; la cuenta propietaria puede sincronizarla. | Dos cuentas sintéticas y headers/cuerpos de red. | Pendiente |
| MOB-06 | Crear una edición concurrente desde otro dispositivo; sincronizar la entrada vieja. Comparar y ensayar descartar y reemplazar. | No hay sobrescritura automática; la comparación muestra cada pregunta; reemplazo exige versión actual, confirmación y nueva clave. | Versiones antes/después y claves idempotentes redactadas parcialmente. | Pendiente |
| MOB-07 | Borrar alumno, examen y cuenta mientras otro dispositivo conserva una entrada offline; reconectar el dispositivo secundario. | Datos activos se borran; el secundario descarta la entrada en `404`/`410` y avisa. | Resultado del borrado, aviso cliente y consulta sin datos activos. | Pendiente |
| MOB-08 | Intentar login/exportación/acciones de cuenta solo con teclado; verificar foco visible, zoom 200 %, contraste y objetivos táctiles. | Operaciones disponibles sin puntero, contenido legible y sin pérdida/solapamiento. | Grabación, dispositivo, zoom y defectos. | Pendiente |
| MOB-09 | Con inspección remota comprobar subida de imagen, exportación, API privada y envío de texto a DeepSeek en entorno de prueba. | Foto nunca sale del dispositivo; API recibe solo IDs/version/respuestas finales; DeepSeek solo texto sintético con consentimiento; endpoints privados no se cachean. | HAR redactado, búsqueda de `multipart`, `Blob`, DNI y contenido privado. | Pendiente |

## Bloqueos de producción

- La ejecución física Android Chrome e iOS Safari, TalkBack/VoiceOver y auditoría de red deben realizarse y firmarse antes de cerrar esta matriz.
- Confirmar con el proveedor la región UE, TLS, cifrado en reposo, retención máxima de backups/logs de 30 días y evidencia de purga. No afirmar borrado inmediato de backups.
- Probar la invocación programada del endpoint de purga con `CRON_SECRET` ya configurado en el proveedor. El endpoint existente por sí solo no demuestra ejecución periódica.
- Usar exclusivamente identidades y hojas sintéticas. El corpus real/precisión OMR sigue fuera de esta aceptación.
