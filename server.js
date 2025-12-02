import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

dotenv.config();

// Configure ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();

// CORS + body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend from /public (so you can host index.html via same server later)
app.use(express.static("public"));

// Temporary upload folder
const upload = multer({ dest: "uploads/" });

// OpenAI client
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Convert ANY audio → 16kHz mono WAV (OpenAI-safe)
function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions(["-ac 1", "-ar 16000"]) // mono, 16kHz PCM
            .toFormat("wav")
            .save(outputPath)
            .on("end", resolve)
            .on("error", reject);
    });
}

// Map UI language selection → OpenAI transcription language codes
function mapLanguage(uiLang) {
    // uiLang is like "kn-en", "en", "hi-en", "auto"
    switch (uiLang) {
        case "kn-en":
            return "kn"; // Kannada
        case "hi-en":
            return "hi"; // Hindi
        case "ta-en":
            return "ta"; // Tamil
        case "te-en":
            return "te"; // Telugu
        case "en":
            return "en"; // English
        case "auto":
        default:
            return null; // Let model auto-detect
    }
}

app.post("/transcribe", upload.single("audio"), async (req, res) => {
    let inputPath;
    let wavPath;

    try {
        inputPath = req.file?.path;
        if (!inputPath) {
            return res.json({
                raw: "",
                doctorSummary: "No audio received."
            });
        }

        wavPath = inputPath + ".wav";

        // 1) Convert browser audio to clean WAV
        await convertToWav(inputPath, wavPath);
        console.log("Converted WAV size:", fs.statSync(wavPath).size);

        // 2) Build transcription request
        const uiLanguage = (req.body.language || "kn-en").trim(); // default Kannada/English
        const langCode = mapLanguage(uiLanguage);

        const transcriptionPayload = {
            file: fs.createReadStream(wavPath),
            model: "gpt-4o-transcribe"
        };

        if (langCode) {
            transcriptionPayload.language = langCode;
        }

        const transcription = await client.audio.transcriptions.create(
            transcriptionPayload
        );

        const rawText = transcription.text || "";

        // 3) Build safe, professional medical summary
        const medicalPrompt = `
You are a clinical assistant. Convert the doctor's spoken instructions (which may be in a mix of Kannada + English or other Indian language + English) into a clean, professional medical summary suitable for a patient's record.

CONSTRAINTS:
- OUTPUT MUST BE IN CLEAR ENGLISH ONLY.
- DO NOT copy slang or raw phonetic Kannada/English like "togo", "ಸ್ಟ್ರಾಂಗರ ಪೇಂಕಿಲರ್ಸ್", etc.
- DO NOT output Chinese, Tamil, Hindi, or any other script in the final summary. English only.
- Convert all spoken content into polished, grammatically correct medical English.
- If a medicine name is clearly and correctly heard (e.g. "Dolo 650", "Amoxicillin"), you may include it.
- If the medicine name is unclear or distorted, DO NOT guess it. Instead write:
  "⚠️ A medicine was prescribed; name not clearly captured from audio — please verify."
- You may generalize clearly implied medicines as "a stronger painkiller", "an antibiotic", etc., but only if the doctor clearly implies it.
- DO NOT invent new medicines, doses, diagnoses, or causes.
- Only mention causes/suspicions the doctor clearly referred to (e.g. "likely due to street food", "possibly gastritis").
- This tool is for drafting; the doctor will always review and edit before use.

Produce output EXACTLY in this structure (in English):

### Assessment & Plan

**Chief Complaint:**  
- (One or two bullet points summarizing the main problem.)

**Probable Cause:**  
- (Only if the doctor clearly suggested a likely cause. If not mentioned, omit this entire section.)

**Medication:**  
- (List each medicine and dosing instructions as understood. If any medicine name is unclear, use the verification warning.)

**Diet Advice:**  
- (Summarize any food / fluid instructions the doctor mentioned. If none, you may omit this section.)

**Follow-up:**  
- (Summarize follow-up/review plan only if mentioned.)

Now rewrite the following raw doctor speech into that structure, respecting all rules above:

"${rawText}"
        `;

        const summaryResponse = await client.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: medicalPrompt }],
            temperature: 0
        });

        const doctorSummary = summaryResponse.choices[0].message.content;

        // 4) Clean up temp files — no audio retained
        try {
            if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (wavPath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
        } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr.message);
        }

        // 5) Return safe response
        res.json({
            raw: rawText,
            doctorSummary: doctorSummary
        });

    } catch (err) {
        console.error("SERVER ERROR:", err);

        // Attempt cleanup even on error
        try {
            if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (wavPath && fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
        } catch (cleanupErr) {
            console.error("Cleanup error (in catch):", cleanupErr.message);
        }

        res.json({
            raw: "",
            doctorSummary: "Processing failed."
        });
    }
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
