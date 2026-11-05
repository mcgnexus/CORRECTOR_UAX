"use client";

import { useState } from "react";
import Link from "next/link";
import PasswordInput from "../password-input";
import { useRouter } from "next/navigation";

export default function RegistroPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEnviando(true);
    const datos = Object.fromEntries(new FormData(event.currentTarget));
    const respuesta = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    setEnviando(false);
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      setError(cuerpo.error ?? "No se pudo crear la cuenta. Revisa los datos.");
      return;
    }
    router.push("/login");
  }

  return (
    <main id="main-content" className="contenedor">
      <div className="tarjeta">
        <h1>Crear cuenta de profesor</h1>
        <p className="vacio">
          Elige una contraseña de al menos 12 caracteres. En esta versión no hay verificación de
          correo ni recuperación automática de la cuenta.
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="name">Nombre</label>
          <input id="name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={100} />
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <PasswordInput id="password" name="password" label="Contraseña" autoComplete="new-password" required minLength={12} maxLength={128} />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="fila-acciones" style={{ marginTop: "1rem" }}>
            <button type="submit" disabled={enviando}>
              {enviando ? "Creando…" : "Crear cuenta"}
            </button>
            <Link href="/login">Ya tengo cuenta</Link>
          </div>
        </form>
      </div>
    </main>
  );
}
