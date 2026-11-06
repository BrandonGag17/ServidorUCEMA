const express = require("express");
const path = require("node:path");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;
const DAILY_CRON = process.env.CRON_SCHEDULE || "0 9 * * *";
const MAIL_TO = process.env.MAIL_TO || "brandongag14@gmail.com";
const MAIL_FROM = process.env.MAIL_FROM || "brandongag14@gmail.com";
const RESULTS_SHEET_NAME = process.env.RESULTS_SHEET_NAME || "Resultados";

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let comparacionEnCurso = false;

function obtenerGoogleAuth() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new Error("Faltan las credenciales de Google en Render.");
  }

  const credentials = JSON.parse(rawCredentials);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets"
    ]
  });
}

async function ejecutarComparacion() {
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    throw new Error("Falta configurar APPS_SCRIPT_URL en Render.");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST"
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data.error || "No se pudo completar la comparación.");
  }

  return data;
}

async function obtenerResultadosFaltantes() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("Falta configurar GOOGLE_SHEET_ID en Render.");
  }

  const auth = obtenerGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RESULTS_SHEET_NAME}!A:Z`
  });

  const rows = response.data.values || [];

  if (rows.length <= 1) {
    return [];
  }

  return rows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
}

function armarTextoMail({ totalPrimera, totalSegunda, faltantes, filasFaltantes }) {
  const encabezado = [
    "Reporte diario de faltantes",
    `Fecha: ${new Date().toLocaleString("es-AR")}`,
    ``,
    `Total primera planilla: ${totalPrimera ?? 0}`,
    `Total segunda planilla: ${totalSegunda ?? 0}`,
    `Cantidad de faltantes: ${faltantes ?? 0}`,
    "",
    "Registros faltantes en la hoja Resultados:"
  ];

  if (!filasFaltantes.length) {
    encabezado.push("No hay registros faltantes en este análisis.");
    return encabezado.join("\n");
  }

  const textoFilas = filasFaltantes.map((fila, index) => {
    const linea = fila.map((valor) => String(valor ?? "").trim()).join(" | ");
    return `${index + 1}. ${linea}`;
  });

  return [...encabezado, ...textoFilas].join("\n");
}

async function enviarMailConFaltantes() {
  const smtpUser = process.env.SMTP_USER || MAIL_FROM;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpPass) {
    console.warn("SMTP_PASS no configurado. No se envía el mail diario.");
    return;
  }

  const { totalPrimera, totalSegunda, faltantes } = await ejecutarComparacion();
  const filasFaltantes = await obtenerResultadosFaltantes();

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const mailBody = armarTextoMail({
    totalPrimera,
    totalSegunda,
    faltantes,
    filasFaltantes
  });

  await transporter.sendMail({
    from: `"Servidor UCEMA" <${MAIL_FROM}>`,
    to: MAIL_TO,
    subject: `Faltantes - ${new Date().toLocaleDateString("es-AR")}`,
    text: mailBody
  });

  console.log(`Mail diario enviado a ${MAIL_TO}`);
}

// ==========================================
// ENDPOINT: DESCARGAR EXCEL
// ==========================================

app.get("/api/descargar", async (_req, res) => {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    return res.status(500).json({
      error: "Falta configurar GOOGLE_SHEET_ID en Render."
    });
  }

  try {
    const auth = obtenerGoogleAuth();
    const drive = google.drive({ version: "v3", auth });

    const response = await drive.files.export(
      {
        fileId: spreadsheetId,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      { responseType: "arraybuffer" }
    );

    const excel = Buffer.from(response.data);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="planilla.xlsx"'
    );
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(excel);
  } catch (error) {
    console.error("Error al exportar Google Sheets:", error.message);
    return res.status(500).json({
      error: "No se pudo exportar la planilla. Revisá las credenciales y los permisos."
    });
  }
});

// ==========================================
// ENDPOINT: COMPARAR PLANILLAS
// ==========================================

app.post("/api/comparar", async (_req, res) => {
  if (comparacionEnCurso) {
    return res.status(409).json({
      error: "Ya hay una comparación en curso. Esperá a que termine."
    });
  }

  comparacionEnCurso = true;

  try {
    const data = await ejecutarComparacion();

    return res.status(200).json({
      success: true,
      message: "Comparación finalizada correctamente.",
      totalPrimera: data.totalPrimera,
      totalSegunda: data.totalSegunda,
      faltantes: data.faltantes,
      pestañaResultados: "Resultados"
    });
  } catch (error) {
    console.error("Error al comparar planillas:", error);
    return res.status(500).json({
      error: error.message || "No se pudo completar la comparación."
    });
  } finally {
    comparacionEnCurso = false;
  }
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

// ==========================================
// CRON DIARIO
// ==========================================

cron.schedule(DAILY_CRON, async () => {
  try {
    console.log("Ejecutando tarea diaria de comparación y mail...");
    await enviarMailConFaltantes();
  } catch (error) {
    console.error("Error en la tarea diaria:", error);
  }
});

console.log(`Tarea diaria programada con cron: ${DAILY_CRON}`);

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
