const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-opus-4-8';

app.get('/', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '..', '面接想定問答ジム.html'));
});

app.use('/assets', express.static(path.resolve(__dirname, '..', 'assets')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// pause_turn(サーバーツールの反復上限)を再送で継続しつつ最終メッセージを得る
async function runMessage({ system, userText, tools, maxTokens = 10000 }) {
  let messages = [{ role: 'user', content: userText }];
  for (let attempt = 0; attempt < 4; attempt++) {
    const params = {
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      messages,
    };
    if (tools) params.tools = tools;
    const stream = client.messages.stream(params);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: msg.content }];
      continue;
    }
    return msg;
  }
  throw new Error('検索処理が時間内に完了しませんでした。もう一度お試しください。');
}

function extractText(msg) {
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function parseJson(text) {
  const cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AIの応答をJSONとして解析できませんでした');
  }
}

function episodesText(episodes) {
  return (episodes || [])
    .filter((e) => e && (e.title || e.summary))
    .map((e, i) => `【エピソード${i + 1}】${e.title || '(無題)'}\n概要: ${e.summary || '(未記入)'}\n見せたい強み: ${e.strength || '(未記入)'}`)
    .join('\n\n') || '(エピソード未入力)';
}

function commonProfileText(p) {
  return [
    `志望先: ${p.target || '(未記入)'}`,
    `志望専攻・職種: ${p.position || '(未記入)'}`,
    `自己PR軸: ${p.axis || '(未記入)'}`,
    `併願状況・スケジュール: ${p.schedule || '(未記入)'}`,
    '',
    '--- ES・志望理由書本文 ---',
    p.es || '(未記入)',
    '',
    '--- 主要エピソード ---',
    episodesText(p.episodes),
  ].join('\n');
}

const QUESTION_JSON_SPEC = `出力は以下のJSONオブジェクトのみ。説明文やMarkdownコードブロックは一切付けないこと。
{
  "questions": [
    {
      "category": "カテゴリ名",
      "question": "想定質問文",
      "intent": "この質問が答案のどの甘さを突いているか(1〜2文)",
      "basis": "testimonial または inference または general",
      "source": {"title": "出典名", "url": "URL"} もしくは null
    }
  ]
}
basisの意味: testimonial=実際の面接体験談に基づく / inference=公開情報(アドミッションポリシー・募集要項等)からの推論 / general=一般的な面接定番。
sourceは根拠となる具体的なWebページがある場合のみ。捏造は厳禁。ない場合はnull。`;

// ── 大学院受験モード(web_searchなし・推論ベース) ─────────────────
app.post('/api/generate/grad', async (req, res) => {
  const p = req.body || {};
  try {
    const system = `あなたは大学院入試の面接対策コーチです。
このツールは「的中させるツール」ではなく「深掘り耐性と言語化スピードを鍛える練習ツール」です。
生成する質問は「実際に聞かれる質問の予想」ではなく「聞かれてもおかしくない、答案の甘さを突く質問」として作ってください。
体験談データは少ない前提なので、アドミッションポリシー・研究科の特色と、受験者の研究計画・志望理由の整合性チェックを質問生成の主エンジンにしてください。
「研究計画のここは、この研究科が重視する観点と噛み合っていない可能性がある」という角度の質問を重視すること。
根拠のない「過去にこう聞かれた」という体験談の捏造は厳禁です。`;

    const userText = `以下の受験者情報をもとに、大学院面接の想定質問を12問前後生成してください。

${commonProfileText(p)}

--- 大学院固有情報 ---
研究テーマ(卒論など): ${p.researchTheme || '(未記入)'}
志望する研究室・指導教員: ${p.lab || '(未記入)'}
研究科の特色・アドミッションポリシーの要点: ${p.admissionPolicy || '(未記入)'}

--- 研究計画書本文 ---
${p.researchPlan || '(未記入)'}

質問カテゴリは次の4つに分類すること:
1. 「研究計画の妥当性」— 先行研究との差別化、手法の限界を突く
2. 「志望動機との一貫性」— 志望動機と研究テーマのつながりの甘さを突く
3. 「指導教員とのマッチング」— 指導教員の専門分野との適合を問う
4. 「定番質問」— 大学院で何をしたいか、修了後の展望など

各カテゴリ最低2問。アドミッションポリシーが入力されている場合はそれとの整合性を積極的に突くこと(basis: "inference")。
入力された文章の具体的な記述(語句・主張)を引用しながら突く質問を優先すること。

${QUESTION_JSON_SPEC}`;

    const msg = await runMessage({ system, userText });
    res.json(parseJson(extractText(msg)));
  } catch (e) {
    console.error('[generate/grad]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 就活モード(web_searchあり・体験談ベース) ─────────────────────
app.post('/api/generate/shukatsu', async (req, res) => {
  const p = req.body || {};
  try {
    const system = `あなたは新卒就活の面接対策コーチです。
このツールは「的中させるツール」ではなく「深掘り耐性と言語化スピードを鍛える練習ツール」です。
web_searchツールで実際の面接体験談を検索し、見つかった場合のみそれを根拠として質問を作ってください。

検索方針:
- 「${p.target || '企業名'} ${p.position || '職種'} 面接 内容」のように企業別・職種別に絞って検索する
- 優先ソース: ONE CAREER、unistyle、みんなの就職活動日記(みん就)、OpenWork、企業公式の採用ページ・求める人物像
- 検索は4回程度まで

ハルシネーション防止(最重要):
- 体験談が実際に検索で見つかった質問のみ basis を "testimonial" とし、source に実際のページのタイトルとURLを入れる
- 見つからなかった場合、体験談を絶対に捏造せず basis を "general"(または募集要項・求める人物像ベースなら "inference")とし、source は null にする
- 検索結果にない出典URLを作り出すことは厳禁`;

    const userText = `以下の就活生の情報をもとに、まず「${p.target || ''} ${p.position || ''}」の面接体験談・採用情報をweb_searchで検索し、その上で想定質問を12問前後生成してください。

${commonProfileText(p)}

--- 就活固有情報 ---
企業名・職種: ${p.target || '(未記入)'} / ${p.position || '(未記入)'}
募集要項の要点: ${p.jobDetail || '(未記入。検索で補完してよい)'}
逆質問で聞きたいこと: ${p.reverseQuestions || '(未記入)'}
圧迫・意地悪系の練習: ${p.pressureMode ? 'ON' : 'OFF'}

質問カテゴリは次のとおり:
1. 「ES深掘り」— エピソードの動機・葛藤・再現性を突く(入力されたES・エピソードの具体的な記述を引用して突く)
2. 「企業研究」— 求める人物像とのマッチング、企業理解の深さを問う(検索結果を根拠に)
3. 「逆質問対策」— 面接官に刺さる逆質問の例と、逆質問への切り返しで問われること
${p.pressureMode ? '4. 「圧迫・意地悪」— 意地悪な角度からの切り返し練習用の質問(3問程度)' : ''}

各カテゴリ最低2問。体験談が見つかった場合は、その体験談に登場する質問傾向を反映すること。

${QUESTION_JSON_SPEC}`;

    const msg = await runMessage({
      system,
      userText,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      maxTokens: 12000,
    });
    res.json(parseJson(extractText(msg)));
  } catch (e) {
    console.error('[generate/shukatsu]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 回答フィードバック(共通) ──────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { mode, question, answer, profile } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
  try {
    const p = profile || {};
    const system = `あなたは面接回答の添削コーチです。トーンは「優しすぎず、詰めすぎない」。
「ここが弱い」を明確に指摘した上で、改善の方向性を1つだけ提案してください。
文体の例:
「このエピソードは強みが伝わりますが、"なぜその技術を選んだのか"の理由が曖昧です。ここを聞かれると詰まる可能性があります」
「数字や固有名詞が入っていて説得力があります。次に聞かれるとしたら、この成果の再現性についてです」`;

    const userText = `${mode === 'grad' ? '大学院面接' : '就活面接'}の回答練習です。以下を添削してください。

--- 本人の自己PR軸 ---
${p.axis || '(未記入)'}

--- 主要エピソード ---
${episodesText(p.episodes)}

--- 想定質問 ---
${question.question || question}
${question.intent ? `(この質問の狙い: ${question.intent})` : ''}

--- 本人の回答 ---
${answer}

評価観点:
1. 自己PR軸との一貫性
2. エピソードの具体性(数字・固有名詞があるか)
3. 深掘り耐性(この回答だとどこを突かれるか)

出力は以下のJSONオブジェクトのみ。説明文やコードブロックは付けないこと。
{
  "good": "良い点(1〜2文。なければ率直にその旨)",
  "weak": "弱い点の明確な指摘(1〜3文)",
  "followups": ["この回答の次に飛んでくる深掘り質問", "もう1つ"],
  "improvement": "改善の方向性の提案(1つだけ、具体的に)"
}`;

    const msg = await runMessage({ system, userText, maxTokens: 4000 });
    res.json(parseJson(extractText(msg)));
  } catch (e) {
    console.error('[feedback]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ 面接ジム サーバー起動: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠ ANTHROPIC_API_KEY が未設定です。server/.env を確認してください。');
  }
});
