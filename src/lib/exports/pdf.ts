import PDFDocument from "pdfkit";
import { isKeyValidated, keyExportRows, reportCalculationRows, reportStudentRows, resultExportRows, resultExportSummary, type ExportBundle, type ReportStudentRow } from "./model";

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

function reportTableHeader(document: PdfDocument, top: number) {
  const columns = [
    { label: "Pregunta", x: 44, width: 52 },
    { label: "Respuesta", x: 98, width: 82 },
    { label: "Correcta", x: 182, width: 72 },
    { label: "Resultado", x: 256, width: 118 },
    { label: "Puntos", x: 376, width: 64 },
  ];
  document.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  document.save().fillColor("#234d68").rect(44, top, document.page.width - 88, 16).fill().restore();
  for (const column of columns) document.fillColor("#ffffff").text(column.label, column.x + 2, top + 4, { width: column.width - 4 });
  document.fillColor("#222222");
  return columns;
}

function renderReportStudent(document: PdfDocument, bundle: ExportBundle, row: ReportStudentRow) {
  document.addPage();
  examHeading(document, "Informe de corrección", bundle.exam);
  document.font("Helvetica-Bold").fontSize(16).fillColor("#17384f").text(row.student.name);
  document.font("Helvetica").fontSize(10).fillColor("#333333").text("DNI: " + row.student.dni + " · " + row.state);
  document.moveDown(0.4);
  if (row.breakdown) {
    const summary = [
      ["Aciertos", String(row.breakdown.correct)],
      ["Fallos", String(row.breakdown.wrong)],
      ["Blancos", String(row.breakdown.blank)],
      ["Nota", row.breakdown.score],
    ];
    const start = document.y;
    const width = (document.page.width - 88) / summary.length;
    summary.forEach(([label, value], index) => {
      const x = 44 + index * width;
      document.font("Helvetica").fontSize(8).fillColor("#555555").text(label, x, start, { width: width - 4 });
      document.font("Helvetica-Bold").fontSize(12).fillColor("#222222").text(value, x, start + 12, { width: width - 4 });
    });
    document.y = start + 34;
  }
  document.moveDown(0.3).font("Helvetica-Bold").fontSize(11).fillColor("#222222").text("Detalle por pregunta");
  const top = document.y + 6;
  let columns = reportTableHeader(document, top);
  let y = top + 22;
  const lineHeight = 13;
  for (const question of row.questions) {
    if (y + lineHeight > document.page.height - 120) {
      document.addPage();
      document.font("Helvetica-Bold").fontSize(12).fillColor("#17384f").text("Informe de corrección · continuación");
      document.font("Helvetica").fontSize(9).fillColor("#555555").text(row.student.name + " · DNI: " + row.student.dni);
      const continuationTop = document.y + 6;
      columns = reportTableHeader(document, continuationTop);
      y = continuationTop + 22;
    }
    const values = [String(question.questionNo), question.given, question.correct ?? "—", question.outcome, question.points ?? "—"];
    const color = question.outcome === "Acierto" ? "#26733a" : question.outcome === "Fallo" ? "#9f2d2d" : "#222222";
    document.font("Helvetica").fontSize(9).fillColor(color);
    columns.forEach((column, index) => document.text(values[index], column.x + 2, y, { width: column.width - 4, lineBreak: false }));
    y += lineHeight;
  }
  document.y = y;
  document.moveDown(0.6);
  if (document.y > document.page.height - 150) document.addPage();
  document.font("Helvetica-Bold").fontSize(11).fillColor("#222222").text("Cálculo de la nota");
  document.moveDown(0.3);
  for (const [label, value] of reportCalculationRows(row)) {
    const start = document.y;
    document.font("Helvetica").fontSize(9).fillColor("#333333").text(label, 56, start, { width: 340 });
    document.font("Helvetica-Bold").fontSize(9).fillColor("#222222").text(value, 400, start, { width: document.page.width - 456, align: "right" });
    document.y = start + 13;
  }
}

export function buildReportPdf(bundle: ExportBundle) {
  const rows = reportStudentRows(bundle);
  return collectPdf((document) => {
    document.addPage();
    examHeading(document, "Informe de corrección", bundle.exam);
    document.font("Helvetica").fontSize(11).text(`${bundle.exam.numQuestions} preguntas · ${bundle.exam.numOptions} opciones`);
    document.moveDown(0.6);
    document.font("Helvetica-Bold").fontSize(12).text("Contenido");
    document.moveDown(0.3);
    document.font("Helvetica").fontSize(10).fillColor("#333333").text(
      "Cada alumno incluye el detalle de respuestas, la respuesta correcta de cada fallo y el cálculo paso a paso de la nota.",
      { width: document.page.width - 88 },
    );
    if (!isKeyValidated(bundle)) {
      document.moveDown(0.6).save().fillColor("#fff1cc").rect(44, document.y, document.page.width - 88, 34).fill().restore();
      document.fillColor("#8a4b08").font("Helvetica-Bold").fontSize(11).text("Clave pendiente: el detalle y la nota no están disponibles.", 54, document.y + 10, { width: document.page.width - 108 });
      document.moveDown(2.4);
    }
    document.font("Helvetica").fontSize(10).fillColor("#333333").text(`Alumnos incluidos: ${rows.length}`);
    for (const row of rows) renderReportStudent(document, bundle, row);
  });
}
