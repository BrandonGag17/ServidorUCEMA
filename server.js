const express = require("express");
const path = require("node:path");
const { google } = require("googleapis"); // Sigue por si usas la descarga de Excel

const app = express();
const PORT = process.env.PORT || 10000;

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

// ==========================================
// ENDPOINT: DESCARGAR EXCEL (Mantiene su funcionamiento)
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
// ENDPOINT: COMPARAR PLANILLAS (Ahora usa Apps Script)
// ==========================================

app.post("/api/comparar", async (_req, res) => {
  if (comparacionEnCurso) {
    return res.status(409).json({
      error: "Ya hay una comparación en curso. Esperá a que termine."
    });
  }

  comparacionEnCurso = true;

  try {
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
// INICIAR SERVIDOR
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
