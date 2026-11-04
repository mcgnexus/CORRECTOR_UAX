# Correctora UAX

Herramienta para profesores: corrige exámenes tipo test fotografiando la hoja de
respuestas desde el móvil. La especificación completa está en
`Spec_App Correctora de Exámenes Tipo Test.md`.

## Estado del proyecto

- **Fase 0 completada (base):** Next.js 16 (App Router) + TypeScript estricto,
  Auth.js con credenciales email/contraseña (Argon2id), Drizzle ORM + PostgreSQL,
  CRUD de exámenes aislado por profesor, PWA básica e interfaz en español.
- **Fase 1 implementada:** lectura de PDF local con pdf.js y OCR español con
  Tesseract.js; clave con DeepSeek, edición manual y validación en servidor.
- **Fase 2 implementada:** calibración por examen desde una imagen de la hoja de
  respuestas del centro (detección de marcas, perspectiva y rejilla de burbujas);
  se guardan solo coordenadas normalizadas, nunca la imagen.
- Fases 3–7 pendientes (OMR, corrección, alumnos,
  exportación, endurecimiento).

## Requisitos

- Node.js 20+ y npm.
- Una base de datos PostgreSQL (Neon o local).

## Configuración

1. Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL`: cadena de conexión PostgreSQL.
   - `DATABASE_SSL`: `require` o `disable` (opcional; por defecto se activa SSL
     para bases remotas y se desactiva para `localhost`/`127.0.0.1`).
   - `AUTH_SECRET`: secreto para firmar sesiones (genera uno con `openssl rand -base64 32`).
   - `APP_URL`: URL de la app.
2. Instalar dependencias: `npm install`.
3. Generar y aplicar migraciones:
   - `npm run db:generate`
   - `npm run db:migrate`
4. Escribir la API key de DeepSeek en `DEEPSEEK_API_KEY` dentro de `.env.local`
   (el archivo se crea con la variable vacía). Está ignorado por Git y no debe
   compartirse. `DEEPSEEK_MODEL` usa `deepseek-flash` por defecto. Reiniciar el
   servidor tras cambiar variables.

## Desarrollo

```bash
npm run dev        # servidor de desarrollo
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm test           # pruebas unitarias
npm run build      # build de producción
```

## Verificación contra la base de datos

Con `.env` configurado, este script comprueba registro, CRUD y aislamiento entre
dos profesores (crea y elimina sus propios datos de prueba):

```bash
npx tsx --env-file=.env scripts/verify-phase0.ts
npx tsx --env-file=.env scripts/verify-phase1.ts
npx tsx --env-file=.env scripts/verify-phase2.ts
npx tsx scripts/verify-calibration.ts "<ruta-de-imagen>"   # prueba local del detector
```

Los scripts crean datos de prueba y los eliminan al finalizar. El de Fase 1
comprueba borradores, validación y aislamiento de la clave; el de Fase 2,
la calibración de la matriz, su validación y aislamiento por profesor.

## Cuentas

- Registro abierto con email y contraseña (mínimo 12 caracteres).
- En esta versión del MVP **no** hay verificación de correo ni recuperación de
  contraseña; guarda bien tu contraseña.

## Privacidad

La imagen de la matriz se procesa en el navegador para detectar marcas y burbujas;
solo se guardan sus coordenadas por examen. Los PDF (máximo 20 MB y 50 páginas) se leen en el navegador; las páginas sin texto
seleccionable se procesan allí mismo con OCR español. El archivo no se sube ni
guarda. Solo al pulsar **Generar clave** se envía a DeepSeek el texto extraído
(máximo 100.000 caracteres); la clave resultante se guarda tras la acción del
profesor. La API key de DeepSeek solo se usa en el servidor. Ver el SPEC para los
detalles completos (RGPD, alcance, fases).
