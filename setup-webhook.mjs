#!/usr/bin/env node
// Chạy script này 1 lần sau khi deploy để đăng ký webhook với Telegram
// Usage: node setup-webhook.mjs <BOT_TOKEN> <VERCEL_URL>
// Example: node setup-webhook.mjs 123456:ABC... https://my-bot.vercel.app

const [,, token, vercelUrl] = process.argv;

if (!token || !vercelUrl) {
  console.error('Usage: node setup-webhook.mjs <BOT_TOKEN> <VERCEL_URL>');
  process.exit(1);
}

const webhookUrl = `${vercelUrl.replace(/\/$/, '')}/webhook`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }),
});

const data = await res.json();
if (data.ok) {
  console.log(`✅ Webhook đã được đăng ký thành công!`);
  console.log(`   URL: ${webhookUrl}`);
} else {
  console.error('❌ Lỗi:', data.description);
}
