
const express = require("express");
const path = require("node:path");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// CONFIGURACIÓN DE GOOGLE SHEETS
// ==========================================

const SHEETS = {
  primera: {
    id: "1clYtPQD-t1S6tz-YElflzAOBuxuw5HK-BBV3BziFqEI",
    gid: 480002311,
    nombreEsperado: "Landing General Grado"
  },

  segunda: {
    id: "1HSOHAruguaAmGx9Qsd6Uhh0hyreZrYOo8zzCYu5ztPk",
    gid: 1245137776,
    nombreDocumento: "Formularios LeadFunnel"
  },

  resultados: {
    id: "1yLD1V-YUzunPezmQvXbAubWdHir9K_B4PVBP-JjZpKE",
    gid: 0
  }
};

const FECHA_CORTE = new Date(2026, 9, 21, 0, 0, 0);

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
// OBTENER NOMBRE DE UNA PESTAÑA POR SU GID
// ==========================================

async function obtenerNombrePestana(sheets, spreadsheetId, gid) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties"
  });

  const pestaña = response.data.sheets.find(
    sheet => sheet.properties.sheetId === gid
  );

  if (!pestaña) {
    throw new Error(
      `No se encontró la pestaña con gid ${gid} en la planilla ${spreadsheetId}.`
    );
  }

  return pestaña.properties.title;
}

// ==========================================
// LEER REGISTROS DE GOOGLE SHEETS
// ==========================================

async function obtenerFilas(sheets, spreadsheetId, nombrePestana) {
  const nombreSeguro = nombrePestana.replace(/'/g, "''");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${nombreSeguro}'!A:Z`
  });

  const filas = response.data.values || [];

  if (filas.length < 2) {
    return [];
  }

  const encabezados = filas[0].map(valor => String(valor).trim());

  return filas.slice(1).map(fila => {
    const objeto = {};

    encabezados.forEach((encabezado, index) => {
      if (encabezado) {
        objeto[encabezado] = fila[index] ?? "";
      }
    });

    return objeto;
  });
}

// ==========================================
// LIMPIAR Y NORMALIZAR DATOS
// ==========================================

function getFieldValue(row, possibleNames) {
  for (const name of possibleNames) {
    if (
      row[name] !== undefined &&
      row[name] !== null &&
      String(row[name]).trim() !== ""
    ) {
      return String(row[name]).trim();
    }
  }

  return "";
}

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// PARSEAR FECHAS
// ==========================================

function parseFecha(raw) {
  if (!raw) return null;

  const s = String(raw).trim();

  // Formato: 2026-10-21 o 2026-10-21 13:30:00
  let m = s.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );

  if (m) {
    return new Date(
      +m[1],
      +m[2] - 1,
      +m[3],
      +(m[4] || 0),
      +(m[5] || 0),
      +(m[6] || 0)
    );
  }

  // Formato: 21/10/2026 o 21/10/2026 13:30
  m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (m) {
    const a = +m[1];
    const b = +m[2];

    let dia = a;
    let mes = b;

    // Si el primer número no puede ser un mes, es el día.
    if (a > 12 && b <= 12) {
      dia = a;
      mes = b;
    } else if (b > 12 && a <= 12) {
      dia = b;
      mes = a;
    }

    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return null;
    }

    const fecha = new Date(
      +m[3],
      mes - 1,
      dia,
      +(m[4] || 0),
      +(m[5] || 0),
      +(m[6] || 0)
    );

    // Evita fechas imposibles como 31/02.
    if (
      fecha.getFullYear() !== +m[3] ||
      fecha.getMonth() !== mes - 1 ||
      fecha.getDate() !== dia
    ) {
      return null;
    }

    return fecha;
  }

  // Otros formatos reconocidos por JavaScript.
  const fecha = new Date(s);

  return isNaN(fecha.getTime()) ? null : fecha;
}

// ==========================================
// CONVERTIR FILAS EN PERSONAS
// ==========================================

function parsePersona(row) {
  const dni = getFieldValue(row, [
    "DNI",
    "dni",
    "Documento"
  ]).replace(/\D/g, "");

  const nombre = getFieldValue(row, [
    "Nombre",
    "nombre"
  ]);

  const apellido = getFieldValue(row, [
    "Apellido",
    "apellido"
  ]);

  const carrera = getFieldValue(row, [
    "Carrera",
    "Carreras de Interes",
    "Campañas",
    "Programa(s) de interés"
  ]);

  const fechaStr = getFieldValue(row, [
    "Date",
    "date",
    "Fecha de creación (UTC)",
    "Fecha"
  ]);

  return {
    dni,
    nombre,
    apellido,
    carrera,
    fechaStr,
    fechaObj: parseFecha(fechaStr),
    nameKey: norm(nombre) + "|" + norm(apellido)
  };
}

// ==========================================
// COMPARAR PERSONAS
// ==========================================

function indices(list) {
  return {
    dnis: new Set(
      list.filter(p => p.dni).map(p => p.dni)
    ),
    names: new Set(
      list.map(p => p.nameKey)
    )
  };
}

function existe(persona, indice) {
  return (
    (persona.dni && indice.dnis.has(persona.dni)) ||
    indice.names.has(persona.nameKey)
  );
}

function compararPersonas(hoja1, hoja2) {
  const p1 = hoja1
    .map(parsePersona)
    .filter(p =>
      p.fechaObj &&
      p.fechaObj >= FECHA_CORTE &&
      (p.nombre || p.apellido)
    );

  const p2 = hoja2
    .map(parsePersona)
    .filter(p =>
      p.fechaObj &&
      p.fechaObj >= FECHA_CORTE &&
      (p.nombre || p.apellido)
    );

  const idx1 = indices(p1);
  const idx2 = indices(p2);

  const salida = [];
  const vistos = new Set();

  function agregar(persona, hojaFaltante) {
    const clave = persona.dni || persona.nameKey;

    if (vistos.has(clave)) return;

    vistos.add(clave);

    salida.push([
      persona.nombre,
      persona.apellido,
      persona.carrera,
      persona.fechaStr,
      hojaFaltante
    ]);
  }

  // Personas de Landing General Grado que faltan
  // en Formularios LeadFunnel.
  for (const p of p1) {
    if (!existe(p, idx2)) {
      agregar(p, "Formularios LeadFunnel");
    }
  }

  // Personas de Formularios LeadFunnel que faltan
  // en Landing General Grado.
  for (const p of p2) {
    if (!existe(p, idx1)) {
      agregar(p, "Landing General Grado");
    }
  }

  return salida;
}

// ==========================================
// ACTUALIZAR TERCERA GOOGLE SHEET
// ==========================================

async function actualizarResultados(sheets, resultados) {
  const nombrePestana = await obtenerNombrePestana(
    sheets,
    SHEETS.resultados.id,
    SHEETS.resultados.gid
  );

  const nombreSeguro = nombrePestana.replace(/'/g, "''");

  // Limpiar los resultados anteriores desde la fila 2.
  // Los encabezados y el formato se conservan.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEETS.resultados.id,
    range: `'${nombreSeguro}'!A2:E`
  });

  // Escribir los resultados nuevos.
  if (resultados.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEETS.resultados.id,
      range: `'${nombreSeguro}'!A2:E${resultados.length + 1}`,
      valueInputOption: "RAW",
      requestBody: {
        values: resultados
      }
    });
  }

  return {
    pestaña: nombrePestana,
    cantidad: resultados.length
  };
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
      error:
        "No se pudo exportar la planilla. Revisá las credenciales y los permisos."
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
    console.log("Iniciando comparación de Google Sheets...");

    const auth = obtenerGoogleAuth();
    const sheets = google.sheets({
      version: "v4",
      auth
    });

    // Obtener los nombres reales de las pestañas.
    const nombre1 = await obtenerNombrePestana(
      sheets,
      SHEETS.primera.id,
      SHEETS.primera.gid
    );

    if (nombre1 !== SHEETS.primera.nombreEsperado) {
      throw new Error(
        `La pestaña esperada era "${SHEETS.primera.nombreEsperado}", pero se encontró "${nombre1}".`
      );
    }

    const nombre2 = await obtenerNombrePestana(
      sheets,
      SHEETS.segunda.id,
      SHEETS.segunda.gid
    );

    // Leer las dos planillas.
    console.log("Leyendo primera planilla:", nombre1);

    const hoja1 = await obtenerFilas(
      sheets,
      SHEETS.primera.id,
      nombre1
    );

    console.log("Leyendo segunda planilla:", nombre2);

    const hoja2 = await obtenerFilas(
      sheets,
      SHEETS.segunda.id,
      nombre2
    );

    console.log("Registros primera planilla:", hoja1.length);
    console.log("Registros segunda planilla:", hoja2.length);

    // Comparar.
    const resultados = compararPersonas(hoja1, hoja2);

    console.log("Personas faltantes:", resultados.length);

    // Actualizar tercera planilla.
    const actualizacion = await actualizarResultados(
      sheets,
      resultados
    );

    console.log("Comparación finalizada correctamente.");

    return res.status(200).json({
      success: true,
      message: "Comparación finalizada correctamente.",
      totalPrimera: hoja1.length,
      totalSegunda: hoja2.length,
      faltantes: resultados.length,
      pestañaResultados: actualizacion.pestaña
    });

  } catch (error) {
    console.error("Error al comparar planillas:", error);

    return res.status(500).json({
      error: error.message ||
        "No se pudo completar la comparación."
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
