"use client";

import { useId, useState } from "react";

type Props = {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
};

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.4 5.3A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.6" />
      <path d="M6.3 6.8C4.3 8.2 2.8 10.3 2 12c1 2.5 5 7 10 7 1.4 0 2.7-.3 3.9-.9" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function PasswordInput({ id, name, label, autoComplete, required, minLength, maxLength }: Props) {
  const [visible, setVisible] = useState(false);
  const helpId = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby={helpId}
        />
        <button
          type="button"
          className="secundario password-toggle"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          <EyeIcon hidden={visible} />
        </button>
        <span id={helpId} className="sr-only">{visible ? "Contraseña visible" : "Contraseña oculta"}</span>
      </div>
    </>
  );
}
