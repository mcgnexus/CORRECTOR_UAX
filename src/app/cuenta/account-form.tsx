"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { accountPatchSchema, type AccountProfile } from "@/lib/account-profile";
import PasswordInput from "../password-input";

export default function AccountForm({ initialProfile }: { initialProfile: AccountProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [email, setEmail] = useState(initialProfile.email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reauthenticate, setReauthenticate] = useState(false);
  const emailChanged = email.trim().toLowerCase() !== profile.email;

  async function leave() {
    // Keep the owner-scoped offline queue intact; it resumes only for this same account.
    try { await signOut({ redirect: false }); }
    finally {
      router.replace("/login");
      router.refresh();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>, passwordOnly: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setMessage("");
    const input: Record<string, unknown> = passwordOnly ? {
      currentPassword: String(data.get("currentPassword") ?? ""),
      newPassword: String(data.get("newPassword") ?? ""),
      confirmPassword: String(data.get("confirmPassword") ?? ""),
    } : {
      name: String(data.get("name") ?? ""),
      lastName: String(data.get("lastName") ?? ""),
      email,
      institution: String(data.get("institution") ?? ""),
      department: String(data.get("department") ?? ""),
      ...(emailChanged ? { currentPassword: String(data.get("currentPassword") ?? "") } : {}),
    };
    const parsed = accountPatchSchema.safeParse(input);
    if (!parsed.success) {
      setError("Revisa los campos. La nueva contrasena debe tener entre 12 y 128 caracteres y ambas copias deben coincidir.");
      return;
    }
    if (emailChanged && !passwordOnly && !input.currentPassword) {
      setError("Para cambiar el correo, indica tu contrasena actual.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = await response.json() as { profile?: AccountProfile; reauthenticate?: boolean; error?: string };
      if (response.status === 401) {
        setReauthenticate(true);
        setMessage("La sesion ha caducado. Inicia sesion de nuevo.");
        return;
      }
      if (!response.ok || !result.profile) {
        setError(result.error ?? "No se pudo guardar la cuenta.");
        return;
      }
      if (result.reauthenticate) {
        setReauthenticate(true);
        setMessage("Credenciales actualizadas. Todas tus sesiones se han cerrado. Inicia sesion con el nuevo correo o contrasena.");
        // Clear the local Auth.js session without navigating away from the success notice.
        await signOut({ redirect: false });
        return;
      }
      setProfile(result.profile);
      setEmail(result.profile.email);
      setMessage("Perfil actualizado.");
      router.refresh();
    } catch {
      setError("No se pudo confirmar el cambio. Si cambiaste credenciales, prueba a iniciar sesion con las nuevas antes de reintentar.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <p className="aviso">Cambiar el correo o la contrasena cierra todas tus sesiones, tambien en otros dispositivos. La cola local de entregas no se borra ni se transfiere a otra cuenta: vuelve a entrar en esta misma cuenta para sincronizarla. En un equipo compartido puedes purgarla mas abajo antes de salir.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {reauthenticate ? <button type="button" onClick={() => void leave()}>Iniciar sesion de nuevo</button> : <>
      <section className="tarjeta" aria-labelledby="profile-title">
        <h2 id="profile-title">Datos personales y academicos</h2>
        <form onSubmit={(event) => void submit(event, false)}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <label htmlFor="account-name">Nombre o nombre completo</label>
            <input id="account-name" name="name" autoComplete="given-name" defaultValue={profile.name} maxLength={100} required />
            <label htmlFor="account-lastname">Apellidos (opcional)</label>
            <input id="account-lastname" name="lastName" autoComplete="family-name" defaultValue={profile.lastName ?? ""} maxLength={100} />
            <label htmlFor="account-email">Correo electronico</label>
            <input id="account-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
            <label htmlFor="account-institution">Centro o universidad (opcional)</label>
            <input id="account-institution" name="institution" autoComplete="organization" defaultValue={profile.institution ?? ""} maxLength={160} />
            <label htmlFor="account-department">Departamento (opcional)</label>
            <input id="account-department" name="department" defaultValue={profile.department ?? ""} maxLength={160} />
            {emailChanged && <PasswordInput id="email-current-password" name="currentPassword" label="Contrasena actual para cambiar el correo" autoComplete="current-password" maxLength={128} required />}
            <div className="fila-acciones" style={{ marginTop: "1rem" }}><button type="submit">Guardar perfil</button></div>
          </fieldset>
        </form>
      </section>
      <section className="tarjeta" aria-labelledby="password-title">
        <h2 id="password-title">Cambiar contrasena</h2>
        <form onSubmit={(event) => void submit(event, true)}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <PasswordInput id="password-current" name="currentPassword" label="Contrasena actual" autoComplete="current-password" maxLength={128} required />
            <PasswordInput id="password-new" name="newPassword" label="Nueva contrasena (12-128 caracteres)" autoComplete="new-password" minLength={12} maxLength={128} required />
            <PasswordInput id="password-confirm" name="confirmPassword" label="Repetir nueva contrasena" autoComplete="new-password" minLength={12} maxLength={128} required />
            <div className="fila-acciones" style={{ marginTop: "1rem" }}><button type="submit">Cambiar contrasena y cerrar sesiones</button></div>
          </fieldset>
        </form>
      </section>
    </>}
  </>;
}
