
const express = require("express");
const path = require("node:path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/descargar", async (_req, res) => {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!spreadsheetId || !rawCredentials) {
    return res.status(500).json({
      error: "Falta configurar el acceso a Google en Render."
    });
  }

  try {
    const credentials = JSON.parse(rawCredentials);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly"
      ]
    });

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
      error:
        "No se pudo exportar la planilla. Revisá las credenciales y los permisos."
    });
  }
});

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
