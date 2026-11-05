import PDFDocument from "pdfkit";
import { isKeyValidated, keyExportRows, resultExportRows, resultExportSummary, type ExportBundle } from "./model";

type PdfDocument = InstanceType<typeof PDFDocument>;

function collectPdf(render: (document: PdfDocument) => void) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, autoFirstPage: false, compress: false });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      render(document);
      const pages = document.bufferedPageRange();
      for (let index = 0; index < pages.count; index += 1) {
        document.switchToPage(pages.start + index);
        document.font("Helvetica").fontSize(8).fillColor("#666666");
        document.text(`Corrector UAX · Página ${index + 1} de ${pages.count}`, 44, document.page.height - 54, {
          width: document.page.width - 88,
          align: "right",
          lineBreak: false,
        });
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

function examHeading(document: PdfDocument, title: string, exam: ExportBundle["exam"]) {
  document.font("Helvetica-Bold").fontSize(20).fillColor("#17384f").text(title || "Examen", { align: "center" });
  document.moveDown(0.2).font("Helvetica-Bold").fontSize(11).fillColor("#333333").text(exam.title, { align: "center" });
  if (exam.subject) document.moveDown(0.2).font("Helvetica").fontSize(10).fillColor("#444444").text(exam.subject, { align: "center" });
  document.moveDown(0.4).font("Helvetica").fontSize(10).fillColor("#333333");
}

function keyStatus(bundle: ExportBundle) {
  if (isKeyValidated(bundle)) return "VALIDADA";
  return "BORRADOR / NO VALIDADA";
}

export function buildKeyPdf(bundle: ExportBundle) {
  const rows = keyExportRows(bundle);
  const validated = isKeyValidated(bundle);
  return collectPdf((document) => {
    document.addPage();
    examHeading(document, "Clave de respuestas", bundle.exam);
    document.font("Helvetica").fontSize(10).text(`${bundle.exam.numQuestions} preguntas · ${bundle.exam.numOptions} opciones`, { align: "center" });
    document.moveDown(0.8);
    if (!validated) {
      document.save().fillColor("#fff1cc").rect(44, document.y, document.page.width - 88, 34).fill().restore();
      document.fillColor("#8a4b08").font("Helvetica-Bold").fontSize(12).text(keyStatus(bundle), 54, document.y + 9, { width: document.page.width - 108, align: "center" });
      document.moveDown(2.5);
    }
    document.font("Helvetica-Bold").fontSize(10).fillColor("#222222");
    const midpoint = Math.ceil(rows.length / 2);
    const top = Math.max(document.y + 8, 135);
    const lineHeight = 12;
    const colWidth = (document.page.width - 100) / 2;
    for (let index = 0; index < rows.length; index += 1) {
      const column = index < midpoint ? 0 : 1;
      const offset = column === 0 ? index : index - midpoint;
      const x = 50 + column * (colWidth + 20);
      const y = top + offset * lineHeight;
      const answer = rows[index].correctOption ?? "________";
      document.font("Helvetica").fontSize(10).fillColor("#222222").text(`Pregunta ${rows[index].questionNo}:  ${answer}`, x, y, { width: colWidth });
    }
  });
}

export function buildResultsPdf(bundle: ExportBundle) {
  const rows = resultExportRows(bundle);
  const summary = resultExportSummary(rows);
  const validated = isKeyValidated(bundle);
  const key = new Map(bundle.key.map((item) => [item.questionNo, item.correctOption]));
  const average = summary.mean === null ? "Sin notas calculadas" : new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(summary.mean);

  return collectPdf((document) => {
    document.addPage();
    examHeading(document, "Resultados del examen", bundle.exam);
    document.font("Helvetica").fontSize(11).text(`${bundle.exam.numQuestions} preguntas · ${bundle.exam.numOptions} opciones`);
    document.moveDown(0.8);
    const summaryRows = [
      ["Alumnos en el roster", String(summary.total)],
      ["Entregas corregidas", String(summary.corrected)],
      ["Sin entrega", String(summary.pending)],
      ["Pendientes de validar clave", String(summary.keyPending)],
      ["Pendientes de cálculo", String(summary.calculationPending)],
      ["Media de notas calculadas", average],
    ];
    document.font("Helvetica-Bold").fontSize(12).text("Resumen");
    document.moveDown(0.4);
    const summaryStart = document.y;
    const summaryHeight = 20;
    summaryRows.forEach(([label, value], index) => {
      const y = summaryStart + index * summaryHeight;
      document.font("Helvetica").fontSize(11).text(label, 56, y, { width: 350 });
      document.font("Helvetica-Bold").fontSize(11).text(value, 410, y, { width: document.page.width - 466, align: "right" });
    });
    document.y = summaryStart + summaryRows.length * summaryHeight;
    document.moveDown(0.6);
    document.font("Helvetica").fontSize(9).fillColor("#555555").text(
      validated ? "Clave validada. Las notas corresponden a la regla guardada del examen." : "La clave está pendiente; no se muestran conteos ni notas derivados.",
      { width: document.page.width - 88 },
    );

    for (const row of rows) {
      document.addPage();
      examHeading(document, "Ficha de alumno", bundle.exam);
      document.font("Helvetica-Bold").fontSize(15).fillColor("#17384f").text(row.student.name);
      document.font("Helvetica").fontSize(10).fillColor("#333333").text(`DNI: ${row.student.dni}`);
      document.moveDown(0.3).font("Helvetica-Bold").fontSize(11).text(row.state);
      document.moveDown(0.65);
      const metrics = [
        ["Aciertos", row.correct === null ? "—" : String(row.correct)],
        ["Fallos", row.wrong === null ? "—" : String(row.wrong)],
        ["Blancos", row.blank === null ? "—" : String(row.blank)],
        ["Bruto", row.rawScore ?? "—"],
        ["Nota", row.score ?? "—"],
      ];
      const metricsStart = document.y;
      const metricWidth = (document.page.width - 88) / metrics.length;
      metrics.forEach(([label, value], index) => {
        const x = 44 + index * metricWidth;
        document.font("Helvetica").fontSize(8).fillColor("#555555").text(label, x, metricsStart, { width: metricWidth - 4 });
        document.font("Helvetica-Bold").fontSize(10).fillColor("#222222").text(value, x, metricsStart + 12, { width: metricWidth - 4 });
      });
      document.y = metricsStart + 34;
      document.moveDown(0.5);
      if (row.state === "Pendiente") {
        document.font("Helvetica-Oblique").fontSize(10).text("Sin entrega registrada.");
        continue;
      }
      document.font("Helvetica-Bold").fontSize(11).text("Respuestas");
      const midpoint = Math.ceil(row.answers.length / 2);
      const lineHeight = 11;
      const top = document.y + 8;
      const colWidth = (document.page.width - 104) / 2;
      for (let index = 0; index < row.answers.length; index += 1) {
        const column = index < midpoint ? 0 : 1;
        const offset = column === 0 ? index : index - midpoint;
        const answer = row.answers[index] || "—";
        const x = 52 + column * (colWidth + 20);
        const y = top + offset * lineHeight;
        const correctOption = key.get(index + 1);
        const color = row.state === "Corregido" && answer !== "En blanco" && answer !== "—"
          ? answer === correctOption ? "#26733a" : "#9f2d2d"
          : "#222222";
        document.font("Helvetica").fontSize(9).fillColor(color).text(`P${index + 1}: ${answer}`, x, y, { width: colWidth });
      }
    }
  });
}
