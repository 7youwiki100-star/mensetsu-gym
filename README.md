# 面接対策ツール

深掘り耐性と言語化スピードを鍛える練習ツール。「的中させるツール」ではなく、答案の甘さを突く想定質問を生成して回答練習するためのもの。

## 構成

- `面接想定問答ジム.html` — フロントエンド(単一HTML)。太鼓の達人風のモード選択 → 一次情報フォーム → 想定質問+回答添削
- `server/server.js` — Node + Express + Anthropic API (claude-opus-4-8)
  - `POST /api/generate/grad` — 大学院モード。web_searchなし。アドミッションポリシー×研究計画の整合性チェックを軸にした推論ベース
  - `POST /api/generate/shukatsu` — 就活モード。web_searchツールでONE CAREER・unistyle等の体験談を検索。見つかった場合のみ出典付き(`basis: testimonial`)、なければ「一般的な想定」と明示(捏造禁止のプロンプト制約あり)
  - `POST /api/feedback` — 回答添削。良い点/弱い点/次に来る深掘り/改善提案(1つ)を返す

## セットアップ

```bash
cd server
npm install
# server/.env に有効なAPIキーを設定
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm start
# → http://localhost:3100
```

## ⚠ APIキーについて

`server/.env` には kakomon-tool のキーをコピーしてあるが、**このキーは現在無効**(Anthropic APIが `invalid x-api-key` を返す。失効または削除済み)。
https://console.anthropic.com/settings/keys で新しいキーを発行して `server/.env` を書き換えること。kakomon-tool 側も同じキーなので、あちらも同様に更新が必要。

## 質問データの形式

```json
{
  "questions": [
    {
      "category": "ES深掘り",
      "question": "...",
      "intent": "この質問が答案のどこを突いているか",
      "basis": "testimonial | inference | general",
      "source": {"title": "...", "url": "..."} or null
    }
  ]
}
```
