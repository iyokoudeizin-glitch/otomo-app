require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const { marked } = require('marked');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Firebase Admin 初期化（環境変数またはサービスアカウントキー）
admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const app = express();
const upload = multer({ dest: 'uploads/' });
const ai = new GoogleGenAI();

app.use(express.json());
app.use(express.static('public'));

const chatSessions = {};

// 認証＆有料プラン/コード確認ミドルウェア
async function requireActiveSubscription(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "ログインが必要です。" });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        
        // Firestore等でユーザーの課金状態やアクセス権を確認するロジック
        // 例: const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        // if (!userDoc.data()?.hasAccess) { return res.status(403).json({ error: "有料プランまたはコード認証が必要です。" }); }
        
        next();
    } catch (error) {
        return res.status(401).json({ error: "認証トークンが無効です。" });
    }
}

// 指定コードの検証エンドポイント
app.post('/api/verify-code', requireActiveSubscription, async (req, res) => {
    const { code } = req.body;
    const VALID_SECRET_CODE = process.env.VALID_ACCESS_CODE || "OTOMO2026"; // 任意の指定コード

    if (code === VALID_SECRET_CODE) {
        // TODO: Firestore等にユーザーの権限を保存
        // await db.collection('users').doc(req.user.uid).set({ hasAccess: true }, { merge: true });
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false, error: "指定コードが違います。" });
    }
});

// Stripe 月額500円決済セッション作成エンドポイント
app.post('/api/create-checkout-session', requireActiveSubscription, async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'jpy',
                    product_data: { name: 'otomo 有料プラン (月額)' },
                    unit_amount: 500,
                    recurring: { interval: 'month' },
                },
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${req.protocol}://${req.get('host')}/?success=true`,
            cancel_url: `${req.protocol}://${req.get('host')}/?canceled=true`,
            client_reference_id: req.user.uid
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).json({ error: "決済の初期化に失敗しました。" });
    }
});

// チャットAPI（認証・課金必須）
app.post('/api/chat', requireActiveSubscription, upload.single('media'), async (req, res) => {
    try {
        const { message, sessionId = req.user.uid } = req.body;
        const file = req.file;

        if (!chatSessions[sessionId]) {
            chatSessions[sessionId] = ai.chats.create({
                model: 'gemini-3.6-flash',
                config: {
                    systemInstruction: `あなたは音楽学習プラットフォーム「otomo」の優秀なAIアシスタントです。`
                }
            });
        }

        const chat = chatSessions[sessionId];
        let response;

        if (file) {
            const fileBuffer = fs.readFileSync(file.path);
            const base64Data = fileBuffer.toString('base64');
            response = await chat.sendMessage({
                message: [
                    message || "このファイルについて解説してください。",
                    { inlineData: { data: base64Data, mimeType: file.mimetype } }
                ]
            });
            fs.unlinkSync(file.path);
        } else {
            response = await chat.sendMessage({ message });
        }

        const rawText = response.text || "";
        res.json({ reply: marked.parse(rawText) });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "AIの応答取得に失敗しました。" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`otomo 有料版サーバー起動完了: http://localhost:3000`);
});