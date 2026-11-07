const answers = (options: Array<number | null>) => options.map((optionIndex, index) => ({ questionNo: index + 1, optionIndex }));

// Synthetic teaching material only; this is a manual key, not an AI response.
export const examDemo = {
  title: "Ejemplo ficticio: ciencias básicas",
  subject: "Demostración privada. Clave manual pendiente de revisión; sin IA.",
  status: "key_pending" as const,
  numQuestions: 4,
  numOptions: 4,
  key: ["A", "B", "C", "D"].map((correctOption, index) => ({ questionNo: index + 1, correctOption })),
  students: [
    { name: "Alba Ejemplo (ficticia)", dni: null, answers: answers([0, 1, 2, 3]), expectedScore: "10.00" },
    { name: "Bruno Ejemplo (ficticio)", dni: null, answers: answers([0, 0, null, 3]), expectedScore: "5.00" },
    { name: "Celia Ejemplo (ficticia)", dni: null, answers: null, expectedScore: null },
  ],
  aiText: `EXAMEN FICTICIO DE PRUEBA. Sin datos personales reales.
1. ¿Qué orgánulo realiza principalmente la fotosíntesis?
A) Cloroplasto B) Ribosoma C) Lisosoma D) Núcleo
2. ¿Cuál es la fórmula del agua?
A) CO2 B) H2O C) O2 D) NaCl
3. ¿Cuánto es 2 + 2?
A) 2 B) 3 C) 4 D) 5
4. ¿Qué planeta se conoce como el planeta rojo?
A) Venus B) Júpiter C) Saturno D) Marte`,
};

export function isDemoConfirmation(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const body = input as Record<string, unknown>;
  return Object.keys(body).length === 1 && body.confirmation === "CREAR EJEMPLO FICTICIO";
}
