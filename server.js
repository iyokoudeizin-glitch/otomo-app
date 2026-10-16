require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const upload = multer({ dest: 'uploads/' });
const ai = new GoogleGenAI();

app.use(express.json());
app.use(express.static('public'));

const chatSessions = {};

// 503エラーなどのリトライ処理
async function retryOperation(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (error.status === 503 && i < retries - 1) {
                console.log(`APIが混雑しています（503）。${delay / 1000}秒後に再試行します... (${i + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                throw error;
            }
        }
    }
}

app.post('/api/chat', upload.single('media'), async (req, res) => {
    try {
        const { message, sessionId = 'default' } = req.body;
        const file = req.file;

        if (!chatSessions[sessionId]) {
            chatSessions[sessionId] = ai.chats.create({
                model: 'gemini-2.5-flash', // またはご利用のモデル名
                config: {
                    systemInstruction: `あなたは音楽学習プラットフォーム「otomo」の優秀なAIアシスタントです。音楽理論、楽譜の読み方、楽器の練習方法などを分かりやすく教えてください。
                    
【出力のルール】
- 前置きの挨拶や不要な相槌（「〜ですね」「お答えします」など）は省き、結論から簡潔に答えてください。
- 長文の段落は避け、要点は箇条書き（「- 」など）を使って分かりやすくまとめてください。
- HTMLタグ（<p>, <ul>, <li> など）やMarkdownの特殊な装飾は一切使用せず、通常のテキストと改行のみで出力してください。`
                }
            });
        }

        const chat = chatSessions[sessionId];
        let response;

        await retryOperation(async () => {
            if (file) {
                const fileBuffer = fs.readFileSync(file.path);
                const base64Data = fileBuffer.toString('base64');

                response = await chat.sendMessage({
                    message: [
                        message || "このファイルについて解説してください。",
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: file.mimetype
                            }
                        }
                    ]
                });
                fs.unlinkSync(file.path);
            } else {
                response = await chat.sendMessage({ message });
            }
        });

        const rawText = response.text || "";
        
        // タグの混入を防ぐためのサニタイズ（念のためHTMLタグを除去）
        const cleanText = rawText.replace(/<[^>]*>/g, '');

        res.json({ reply: cleanText });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "AIの応答取得に失敗しました。しばらく待ってから再度お試しください。" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`otomo サーバー起動完了: http://localhost:3000`);
});