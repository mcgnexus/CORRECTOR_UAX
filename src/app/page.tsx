import Link from "next/link";

export default function Inicio() {
  return (
    <main id="main-content" className="contenedor">
      <div className="tarjeta" style={{ marginTop: "2rem" }}>
        <h1>Correctora UAX</h1>
        <p>
          Corrige exámenes tipo test desde el móvil: fotografía la hoja de respuestas, la app la
          lee y la compara con la clave validada.
        </p>
        <div className="fila-acciones">
          <Link href="/login">Iniciar sesión</Link>
          <Link href="/registro">Crear una cuenta</Link>
        </div>
      </div>
    </main>
  );
}
