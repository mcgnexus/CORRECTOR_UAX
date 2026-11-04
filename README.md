# Correctora UAX

Herramienta para profesores: corrige exámenes tipo test fotografiando la hoja de
respuestas desde el móvil. La especificación completa está en
`Spec_App Correctora de Exámenes Tipo Test.md`.

## Estado del proyecto

- **Fase 0 completada (base):** Next.js 16 (App Router) + TypeScript estricto,
  Auth.js con credenciales email/contraseña (Argon2id), Drizzle ORM + PostgreSQL,
  CRUD de exámenes aislado por profesor, PWA básica e interfaz en español.
- Fases 1–7 pendientes (clave con LLM, plantilla, OMR, corrección, alumnos,
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
```

## Cuentas

- Registro abierto con email y contraseña (mínimo 12 caracteres).
- En esta versión del MVP **no** hay verificación de correo ni recuperación de
  contraseña; guarda bien tu contraseña.

## Privacidad

Las fotos de las hojas de respuesta se procesan en el móvil y nunca se suben.
En el servidor solo se guardan respuestas finales y notas. Ver el SPEC para los
detalles completos (RGPD, alcance, fases).
