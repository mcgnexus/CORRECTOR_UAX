import ExcelJS from "exceljs";
import { isKeyValidated, keyExportRows, resultExportRows, type ExportBundle } from "./model";

const headerStyle: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF234D68" } },
  alignment: { vertical: "middle", horizontal: "center" },
};

function setHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => { cell.style = headerStyle; });
  row.height = 24;
}

export async function buildKeyXlsx(bundle: ExportBundle) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Corrector UAX";
  workbook.subject = "Clave de respuestas";
  const sheet = workbook.addWorksheet("Clave");
  sheet.addRow(["Pregunta", "Respuesta correcta", "Estado de clave"]);
  setHeader(sheet.getRow(1));
  const status = isKeyValidated(bundle) ? "Validada" : bundle.exam.status === "draft" ? "Borrador" : "Pendiente de validar";
  for (const item of keyExportRows(bundle)) sheet.addRow([item.questionNo, item.correctOption, status]);
  sheet.columns = [{ width: 14 }, { width: 24 }, { width: 28 }];
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `C${sheet.rowCount}` };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function buildResultsXlsx(bundle: ExportBundle) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Corrector UAX";
  workbook.subject = "Resultados del examen";
  const sheet = workbook.addWorksheet("Resultados");
  const questionHeaders = Array.from({ length: bundle.exam.numQuestions }, (_, index) => `P${index + 1}`);
  const headers = ["Nombre", "DNI", ...questionHeaders, "Aciertos", "Fallos", "Blancos", "Bruto", "Nota", "Estado"];
  sheet.addRow(headers);
  setHeader(sheet.getRow(1));

  const key = new Map(bundle.key.map((item) => [item.questionNo, item.correctOption]));
  const validatedKey = isKeyValidated(bundle);
  for (const result of resultExportRows(bundle)) {
    const row = sheet.addRow([
      result.student.name,
      result.student.dni,
      ...result.answers,
      result.correct,
      result.wrong,
      result.blank,
      result.rawScore === null ? null : Number(result.rawScore),
      result.score === null ? null : Number(result.score),
      result.state,
    ]);
    result.answers.forEach((answer, index) => {
      if (result.state !== "Corregido" || !validatedKey || answer === "" || answer === "En blanco") return;
      const correctOption = key.get(index + 1);
      row.getCell(index + 3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: answer === correctOption ? "FFC6EFCE" : "FFFFC7CE" },
      };
    });
  }
  sheet.columns = [
    { width: 30 },
    { width: 18 },
    ...questionHeaders.map(() => ({ width: 11 })),
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 16, style: { numFmt: "0.0000" } },
    { width: 12, style: { numFmt: "0.00" } },
    { width: 26 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  sheet.autoFilter = { from: "A1", to: `${columnName(headers.length)}${sheet.rowCount}` };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function columnName(index: number) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}
