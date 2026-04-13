
import express from "express";
import multer from "multer";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { fileURLToPath } from "url";

ffmpeg.setFfmpegPath(ffmpegPath);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function detectCommandsFallback(text = "") {
  const lines = text
    .split(/[\.\!\?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pats = [
    /\b(abram|abra|fechem|feche|copiem|copie|anotem|anote|fa[cç]am|fa[cç]a|respondam|responda|entreguem|entregue|leiam|leia|observem|observe|resolvam|resolva|formem|forme|guardem|guarde|tragam|traga|levantem|escutem)\b/i,
    /\b(voc[eê]s precisam|precisam|vamos|deixem|organizem|separem)\b/i,
  ];

  return [...new Set(lines.filter((l) => pats.some((p) => p.test(l))))].slice(
    0,
    8
  );
}

function detectPendingsFallback(text = "") {
  const lines = text
    .split(/[\.\!\?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const pats = [
    /\b(na proxima aula|para a proxima aula|vou trazer|vou fazer|vou enviar|vou entregar|precisam entregar|trazer|entregar|fazer|revisar|lembrar)\b/i,
  ];

  return [...new Set(lines.filter((l) => pats.some((p) => p.test(l))))].slice(
    0,
    8
  );
}

function buildFallbackGagne() {
  const etapas = [
    "Atenção",
    "Objetivo",
    "Conhecimento prévio",
    "Conteúdo",
    "Orientação",
    "Prática",
    "Feedback",
    "Avaliação",
    "Retenção",
  ];

  return etapas.map((etapa) => ({
    etapa,
    evidencia: "",
    avaliacao: "Ausente",
    observacao: "",
  }));
}

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Ouvidor.IA Premium" });
});

app.post("/analyze", upload.single("audio"), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY não configurada.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "Áudio não recebido.",
    });
  }

  const inputPath = req.file.path;
  const wavPath = `${req.file.path}.wav`;

  try {
    await convertToWav(inputPath, wavPath);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: "whisper-1",
      language: "pt",
    });

    const transcript = (transcription.text || "").trim();

    if (!transcript) {
      return res.json({
        transcript: "",
        tldr: "Nenhum conteúdo textual foi captado na aula.",
        alerts: ["Transcrição vazia."],
        gagne: buildFallbackGagne(),
        commands: [],
        pendings: [],
        debug: "Transcrição vazia.",
      });
    }

    const prompt = `
Você é um especialista em análise pedagógica de aulas baseado no modelo de Gagné (9 etapas).

Considere, quando existirem, os metadados fornecidos pelo professor:
- Instituição
- Turma
- Disciplina
- Tema da aula
- Aluno específico
- Data

Analise a transcrição da aula abaixo e responda EXCLUSIVAMENTE em JSON válido.

Formato obrigatório:
{
  "tldr": "resumo curto em 1 frase",
  "alerts": ["lista de 1 a 5 alertas relevantes"],
  "gagne": [
    {
      "etapa": "Atenção",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Objetivo",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Conhecimento prévio",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Conteúdo",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Orientação",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Prática",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Feedback",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Avaliação",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    },
    {
      "etapa": "Retenção",
      "evidencia": "",
      "avaliacao": "Adequado | Parcial | Ausente",
      "observacao": ""
    }
  ],
  "commands": [],
  "pendings": []
}

Regras:
- Não invente fatos.
- Use somente a transcrição real.
- Se algo não existir, marque como "Ausente".
- Seja direto, técnico e pedagógico.
- Responda somente com JSON válido, sem markdown.

Metadados:
${JSON.stringify(req.body || {}, null, 2)}

Transcrição:
${transcript}
`;

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const text = (resp.output_text || "").trim();

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        tldr: transcript.slice(0, 220) || "Sem resumo disponível.",
        alerts: [],
        gagne: buildFallbackGagne(),
        commands: detectCommandsFallback(transcript),
        pendings: detectPendingsFallback(transcript),
      };
    }

    res.json({
      transcript,
      tldr: parsed.tldr || "Sem resumo disponível.",
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      gagne: Array.isArray(parsed.gagne) ? parsed.gagne : buildFallbackGagne(),
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      pendings: Array.isArray(parsed.pendings) ? parsed.pendings : [],
      debug: "OK",
    });
  } catch (err) {
    res.status(500).json({
      error: "Falha ao analisar o áudio.",
      detail: String(err?.message || err),
    });
  } finally {
    fs.unlink(inputPath, () => {});
    fs.unlink(wavPath, () => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Ouvidor.IA Premium on port ${port}`);
});
