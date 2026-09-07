// api/chat.js
// Vercel Serverless Function: フロントからのメッセージを受け取り、
// Redis(Upstash)に会話履歴を保存しながらClaudeに応答してもらう

import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";

// 環境変数はVercelのプロジェクト設定 > Environment Variables で登録する
// - ANTHROPIC_API_KEY
// - UPSTASH_REDIS_REST_URL
// - UPSTASH_REDIS_REST_TOKEN  (Vercelの「Storage」からUpstash Redisを追加すると自動で入る)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SYSTEM_PROMPT = `あなたは「のびすけ」という名前の、癒しの相棒キャラクターです。
穏やかで優しく、相手の話にじっくり耳を傾け、否定せずに寄り添います。
説教くさくならず、短めの自然な会話文で応答してください。`;

const HISTORY_LIMIT = 20; // 直近20往復程度まで保持
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30日で自動失効

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POSTのみ対応しています" });
  }

  try {
    const { message, sessionId } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message は必須です" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId は必須です" });
    }

    const historyKey = `nobisuke:history:${sessionId}`;

    // 1. これまでの会話履歴をRedisから取得
    const rawHistory = await redis.get(historyKey);
    const history = Array.isArray(rawHistory) ? rawHistory : [];

    // 2. 今回のユーザー発言を追加
    const messages = [
      ...history,
      { role: "user", content: message },
    ];

    // 3. Claudeに問い合わせ
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
    });

    const replyText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // 4. 履歴を更新して保存(直近分だけ残す)
    const updatedHistory = [
      ...messages,
      { role: "assistant", content: replyText },
    ].slice(-HISTORY_LIMIT * 2);

    await redis.set(historyKey, updatedHistory, { ex: HISTORY_TTL_SECONDS });

    return res.status(200).json({ reply: replyText });
  } catch (err) {
    console.error("chat api error:", err);
    return res.status(500).json({ error: "サーバーエラーが発生しました" });
  }
}
