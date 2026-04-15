
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

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  res.json({ ok: true, app: "Orelho V3" });
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
        tldr: "Nenhum conteúdo textual foi captado na gravação.",
        gagne: buildFallbackGagne(),
        debug: "Transcrição vazia.",
      });
    }

    const prompt = `
Você é um especialista em análise pedagógica de aulas baseado no modelo de Robert Gagné (9 etapas).

Seu papel é analisar uma aula real com equilíbrio, rigor pedagógico e prudência.
Não seja punitivo nem excessivamente positivo.
Use somente evidências reais da transcrição.
Se houver pouca evidência, marque como "Parcial" ou "Ausente", sem inventar.

Considere, quando existirem, os metadados fornecidos:
- Local/Instituição: ${req.body.localInstitution || ""}
- Ano/Semestre Letivo; Ciclo; Módulo: ${req.body.yearLevel || ""}
- Identificação do Curso: ${req.body.courseId || ""}
- Identificação da Turma: ${req.body.classId || ""}
- Disciplina: ${req.body.subject || ""}
- Tema/Objetivo do Encontro: ${req.body.topicObjective || ""}
- Aluno(s) Específico(s): ${req.body.specificStudents || ""}
- Duração prevista do encontro (minutos): ${req.body.durationMinutes || ""}
- Data do sistema: ${req.body.systemDate || ""}

Regras:
- Não invente fatos.
- Use somente a transcrição real.
- Seja técnico, direto e pedagógico.
- Se algo não aparecer, não force interpretação.
- Se houver indício fraco, prefira "Parcial".
- Se não houver indício, marque "Ausente".
- A duração prevista deve ajudar a contextualizar a análise. Uma aula curta não precisa apresentar a mesma profundidade de uma aula longa.
- Responda somente em JSON válido, sem markdown e sem comentários.

Formato obrigatório:
{
  "tldr": "resumo curto em 1 frase, em português do Brasil",
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
  ]
}

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
        gagne: buildFallbackGagne(),
      };
    }

    res.json({
      transcript,
      tldr: parsed.tldr || "Sem resumo disponível.",
      gagne: Array.isArray(parsed.gagne) ? parsed.gagne : buildFallbackGagne(),
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

app.post("/analyze-special", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY não configurada." });
  }

  try {
    const transcript = String(req.body.transcript || "").trim();
    const specialPrompt = String(req.body.specialPrompt || "").trim();

    if (!transcript) {
      return res.status(400).json({ error: "Transcrição não recebida." });
    }

    if (!specialPrompt) {
      return res.status(400).json({ error: "Solicitação especial não recebida." });
    }

    const prompt = `
Você recebeu a transcrição de uma gravação e um pedido especial do usuário.

Regras:
- Responda em português do Brasil.
- Seja direto, claro e útil.
- Não invente informação que não esteja na transcrição.
- Se o pedido envolver contagem, conte com o máximo de precisão possível com base no texto transcrito.
- Se houver limitação por causa da transcrição, explique de forma breve.
- Responda somente em JSON válido.

Formato obrigatório:
{
  "result": "resposta final em texto corrido"
}

Pedido especial:
${specialPrompt}

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
        result: text || "Não foi possível gerar a análise especial.",
      };
    }

    res.json({
      result: parsed.result || "Não foi possível gerar a análise especial.",
    });
  } catch (err) {
    res.status(500).json({
      error: "Falha ao gerar análise especial.",
      detail: String(err?.message || err),
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Orelho V3 on port ${port}`);
});
