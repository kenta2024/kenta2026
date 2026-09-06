// Vercel Cron から毎日呼ばれ、保存済みの全購読者にプッシュ通知を送る
import webpush from 'web-push';

export default async function handler(req, res) {
  const {
    UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT
  } = process.env;

  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:nobisuke@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  const hgetall = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([['HGETALL', 'subscriptions']])
  });

  const hgetallJson = await hgetall.json();
  const flat = (hgetallJson && hgetallJson[0] && hgetallJson[0].result) || [];

  const entries = [];
  for (let i = 0; i < flat.length; i += 2) {
    entries.push({ endpoint: flat[i], subscription: JSON.parse(flat[i + 1]) });
  }

  const payload = JSON.stringify({
    title: 'のびすけ',
    body: '今日、何から目をそらしてる?',
    url: '/'
  });

  const toDelete = [];
  let sent = 0;

  await Promise.all(
    entries.map(async ({ endpoint, subscription }) => {
      try {
        await webpush.sendNotification(subscription, payload);
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          toDelete.push(endpoint);
        }
      }
    })
  );

  if (toDelete.length > 0) {
    const deleteCommands = toDelete.map((endpoint) => ['HDEL', 'subscriptions', endpoint]);
    await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(deleteCommands)
    });
  }

  res.status(200).json({ sent, removed: toDelete.length, total: entries.length });
}
