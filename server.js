const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// JSONやURLエンコードされたデータのパース設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Google Colab（Ngrok）上で実行されているFastAPIサーバーのURL
const COLAB_API_URL = "https://dumpling-fancy-gestation.ngrok-free.dev/transcribe";

/**
 * 簡易的なファイル受信用エンドポイント（例: /api/upload-audio）
 * クライアント側から送信された音声ファイルを受け取り、Colabへ転送します
 */
app.post('/api/upload-audio', async (req, res) => {
    try {
        // ※ multerなどのミドルウェアを使用している場合、req.file にアップロードされたファイルが格納されます
        // 例として、サーバー上のローカルファイル "uploads/input.mp3" を読み込んで転送する場合の処理を記述します。
        const filePath = path.join(__dirname, 'uploads', 'input.mp3');

        if (!fs.existsSync(filePath)) {
            return res.status(400).json({ 
                success: false, 
                message: '処理対象の音声ファイルが見つかりません。' 
            });
        }

        console.log("--- Google Colabへ音声ファイルを転送し、自動採譜を開始します ---");

        // FormDataを使ってファイルを包む
        const form = new FormData();
        form.append('audioFile', fs.createReadStream(filePath));

        // ColabのFastAPIサーバーへリクエストを送信
        // ngrokの仕様上、ブラウザ判定を回避する為のヘッダー 'ngrok-skip-browser-warning': 'true' を付与します
        const response = await axios.post(COLAB_API_URL, form, {
            headers: {
                ...form.getHeaders(),
                'ngrok-skip-browser-warning': 'true'
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        console.log("Colabからのレスポンス:", response.data);

        return res.status(200).json({
            success: true,
            message: 'Colabでの自動採譜処理が正常に完了しました！',
            colabResponse: response.data
        });

    } catch (error) {
        console.error("Colab通信エラー:", error.message);
        if (error.response) {
            console.error("ステータスコード:", error.response.status);
            console.error("レスポンスデータ:", error.response.data);
        }
        return res.status(500).json({
            success: false,
            message: '自動採譜サーバー（Colab）との通信に失敗しました。',
            error: error.message
        });
    }
});

// サーバーの起動
app.listen(PORT, () => {
    console.log(`Otomo server is running on port ${PORT}`);
    console.log(`連携先 Colab API URL: ${COLAB_API_URL}`);
});