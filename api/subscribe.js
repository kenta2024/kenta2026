// 通知の購読情報(サブスクリプション)を Upstash Redis に保存する

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }

  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = process.env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  try {
    const command = ['HSET', 'subscriptions', subscription.endpoint, JSON.stringify(subscription)];
    const result = await fetch(`${UPSTASH_REDIS_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([command])
    });

    if (!result.ok) {
      const text = await result.text();
      res.status(502).json({ error: 'Upstash error', detail: text });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
