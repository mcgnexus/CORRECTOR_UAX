"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEnviando(true);
    const datos = new FormData(event.currentTarget);
    const resultado = await signIn("credentials", {
      email: String(datos.get("email") ?? ""),
      password: String(datos.get("password") ?? ""),
      redirect: false,
    });
    setEnviando(false);
    if (resultado?.error) {
      setError("Correo o contraseña incorrectos. Comprueba los datos e inténtalo de nuevo.");
      return;
    }
    router.push("/examenes");
    router.refresh();
  }

  return (
    <main className="contenedor">
      <div className="tarjeta">
        <h2>Iniciar sesión</h2>
        <form onSubmit={onSubmit}>
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {error ? <p className="error">{error}</p> : null}
          <div className="fila-acciones" style={{ marginTop: "1rem" }}>
            <button type="submit" disabled={enviando}>
              {enviando ? "Comprobando…" : "Entrar"}
            </button>
            <Link href="/registro">Crear una cuenta</Link>
          </div>
        </form>
      </div>
    </main>
  );
}
