
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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function detectCommandsFallback(text = "") {
  const lines = text.split(/[\.\!\?\n]+/).map(s => s.trim()).filter(Boolean);
  const pats = [
    /\b(abram|abra|fechem|feche|copiem|copie|anotem|anote|fa[cç]am|fa[cç]a|respondam|responda|entreguem|entregue|leiam|leia|observem|observe|resolvam|resolva|formem|forme|guardem|guarde|tragam|traga|levantem|escutem)\b/i,
    /\b(voc[eê]s precisam|precisam|vamos|deixem|organizem|separem)\b/i
  ];
  return [...new Set(lines.filter(l => pats.some(p => p.test(l))))].slice(0, 8);
}

function detectPendingsFallback(text = "") {
  const lines = text.split(/[\.\!\?\n]+/).map(s => s.trim()).filter(Boolean);
  const pats = [/\b(na proxima aula|para a proxima aula|vou trazer|vou fazer|vou enviar|vou entregar|precisam entregar|trazer|entregar|fazer|revisar|lembrar)\b/i];
  return [...new Set(lines.filter(l => pats.some(p => p.test(l))))].slice(0, 8);
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
  res.json({ ok: true, app: "Ouvidor.IA Real v2" });
});

app.post("/analyze", upload.single("audio"), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY não configurada." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Áudio não recebido." });
  }

  const inputPath = req.file.path;
  const wavPath = `${req.file.path}.wav`;

  try {
    await convertToWav(inputPath, wavPath);

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: "whisper-1",
      language: "pt"
    });

    const transcript = (transcription.text || "").trim();

    if (!transcript) {
      return res.json({
        transcript: "",
        summary: "Nenhum conteúdo textual foi captado na aula.",
        commands: [],
        pendings: [],
        highlights: [],
        debug: "Transcrição vazia."
      });
    }

    const prompt = `
Você é um assistente especializado em resumir aulas em português do Brasil.
Receberá a transcrição de uma aula. Responda SOMENTE em JSON válido no formato:
{
  "summary": "resumo curto e objetivo da aula em 3 a 5 linhas",
  "commands": ["lista de comandos dados pelo professor"],
  "pendings": ["lista de pendências e combinados futuros"],
  "highlights": ["até 5 destaques do que aconteceu"]
}

Regras:
- Não invente.
- Se algo não existir, use lista vazia.
- Foque em contexto de sala de aula.
- Seja literal e claro.
- Resuma em português do Brasil.

Transcrição:
${transcript}
`;

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    const text = resp.output_text || "";
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        summary: transcript.slice(0, 500) || "Sem resumo disponível.",
        commands: detectCommandsFallback(transcript),
        pendings: detectPendingsFallback(transcript),
        highlights: []
      };
    }

    res.json({
      transcript,
      summary: parsed.summary || "Sem resumo disponível.",
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
      pendings: Array.isArray(parsed.pendings) ? parsed.pendings : [],
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      debug: "OK"
    });
  } catch (err) {
    res.status(500).json({
      error: "Falha ao analisar o áudio.",
      detail: String(err?.message || err)
    });
  } finally {
    fs.unlink(inputPath, () => {});
    fs.unlink(wavPath, () => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Ouvidor.IA Real v2 on port", port);
});
