import sharp from 'sharp';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const GRADIENTS = [
  { name: 'Purple Dream', colors: ['#667eea', '#764ba2'] },
  { name: 'Pink Flamingo', colors: ['#f093fb', '#f5576c'] },
  { name: 'Ocean Blue', colors: ['#5eeff1', '#3598fb'] },
  { name: 'Lavender', colors: ['#a18cd1', '#fbc2eb'] },
  { name: 'Peach', colors: ['#ffecd2', '#fcb69f'] },
  { name: 'Dark Slate', colors: ['#0f172a', '#334155'] },
  { name: 'Cyber', colors: ['#00dbde', '#fc00ff'] },
  { name: 'Sunset', colors: ['#f6d365', '#fda085'] },
  { name: 'Mint', colors: ['#84fab0', '#8fd3f4'] },
  { name: 'Soft Sky', colors: ['#e0c3fc', '#8ec5fc'] },
];

const userSettings = new Map();

function getSettings(userId) {
  return userSettings.get(userId) || {
    padding: 60,
    borderRadius: 20,
    backgroundType: 'gradient',
    gradientIndex: 0,
    solidColor: '#ffffff',
    showWindowBar: false,
  };
}

function setSettings(userId, patch) {
  userSettings.set(userId, { ...getSettings(userId), ...patch });
}

async function callAPI(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text, extra = {}) {
  return callAPI('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function sendTyping(chatId) {
  return callAPI('sendChatAction', { chat_id: chatId, action: 'upload_photo' });
}

async function downloadImage(fileId) {
  const res = await fetch(`${API}/getFile?file_id=${fileId}`);
  const { result } = await res.json();
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${result.file_path}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

// Tạo shadow thực sự bằng sharp native blur (librsvg không support feGaussianBlur)
async function makeShadow(canvasW, canvasH, imgX, imgY, imgW, imgH, borderRadius, blurSigma, opacity) {
  const shapeSvg = Buffer.from(
    `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}"
            rx="${borderRadius}" ry="${borderRadius}"
            fill="rgba(0,0,0,${opacity})"/>
    </svg>`
  );

  return sharp(shapeSvg)
    .blur(blurSigma)
    .png()
    .toBuffer();
}

async function processImage(buffer, settings) {
  const { padding, borderRadius, backgroundType, gradientIndex, solidColor, showWindowBar } = settings;
  const gradient = GRADIENTS[gradientIndex % GRADIENTS.length];

  const meta = await sharp(buffer).metadata();
  let { width, height } = meta;

  const MAX_SIZE = 2000;
  let resizeOpts = {};
  if (width > MAX_SIZE || height > MAX_SIZE) {
    resizeOpts = { width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true };
  }

  const imgBuffer = Object.keys(resizeOpts).length
    ? await sharp(buffer).resize(resizeOpts).png().toBuffer()
    : await sharp(buffer).png().toBuffer();

  const imgMeta = await sharp(imgBuffer).metadata();
  width = imgMeta.width;
  height = imgMeta.height;

  const barHeight = showWindowBar ? 36 : 0;
  const innerHeight = height + barHeight;

  // Rounded mask
  const mask = Buffer.from(
    `<svg width="${width}" height="${innerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${innerHeight}" rx="${borderRadius}" ry="${borderRadius}" fill="white"/>
    </svg>`
  );

  // Window bar
  const windowBarSvg = showWindowBar
    ? Buffer.from(
        `<svg width="${width}" height="${barHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${width}" height="${barHeight}" fill="#f5f5f5"/>
          <rect x="0" y="${barHeight - 1}" width="${width}" height="1" fill="#e4e4e7"/>
          <circle cx="16" cy="${barHeight / 2}" r="5.5" fill="#ff5f57"/>
          <circle cx="32" cy="${barHeight / 2}" r="5.5" fill="#febc2e"/>
          <circle cx="48" cy="${barHeight / 2}" r="5.5" fill="#28c840"/>
        </svg>`
      )
    : null;

  const composites = [];
  if (windowBarSvg) composites.push({ input: windowBarSvg, top: 0, left: 0 });
  composites.push({ input: imgBuffer, top: barHeight, left: 0 });

  const framedContent = await sharp({
    create: { width, height: innerHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Apply rounded corners
  const roundedContent = await sharp(framedContent)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const canvasW = width + padding * 2;
  const canvasH = innerHeight + padding * 2;
  const shadowOffset = Math.round(padding * 0.12);

  // ─── Shadow layer 1: ambient (rộng, mờ) ─────────────────────────────────────
  const ambientBlur = Math.max(4, Math.round(padding * 0.45));
  const ambientShadow = await makeShadow(
    canvasW, canvasH,
    padding, padding + shadowOffset,
    width, innerHeight,
    borderRadius,
    ambientBlur,
    0.5
  );

  // ─── Shadow layer 2: key (hẹp, sắc, dịch thêm xuống) ──────────────────────
  const keyBlur = Math.max(2, Math.round(padding * 0.12));
  const keyShadow = await makeShadow(
    canvasW, canvasH,
    padding + 2, padding + shadowOffset + 6,
    width, innerHeight,
    borderRadius,
    keyBlur,
    0.35
  );

  // ─── Background ──────────────────────────────────────────────────────────────
  let bgSvg;
  if (backgroundType === 'gradient') {
    const [c1, c2] = gradient.colors;
    bgSvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </linearGradient>
        <radialGradient id="hl" cx="30%" cy="15%" r="60%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="${canvasW}" height="${canvasH}" fill="url(#g)"/>
      <rect width="${canvasW}" height="${canvasH}" fill="url(#hl)"/>
    </svg>`;
  } else {
    bgSvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${canvasW}" height="${canvasH}" fill="${solidColor}"/>
    </svg>`;
  }

  // ─── Thin white border overlay (tạo cảm giác "lift") ────────────────────────
  const borderSvg = Buffer.from(
    `<svg width="${width}" height="${innerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="0.5" width="${width - 1}" height="${innerHeight - 1}"
            rx="${borderRadius}" ry="${borderRadius}"
            fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>
    </svg>`
  );

  // ─── Composite: bg → ambient shadow → key shadow → ảnh → border ────────────
  const result = await sharp(Buffer.from(bgSvg))
    .composite([
      { input: ambientShadow, blend: 'over' },
      { input: keyShadow, blend: 'over' },
      { input: roundedContent, left: padding, top: padding },
      { input: borderSvg, left: padding, top: padding },
    ])
    .png()
    .toBuffer();

  return result;
}

async function sendPhoto(chatId, buffer, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'snapframe.png');
  if (caption) form.append('caption', caption);
  await fetch(`${API}/sendPhoto`, { method: 'POST', body: form });
}

function buildSettingsKeyboard(userId) {
  const s = getSettings(userId);
  const grad = GRADIENTS[s.gradientIndex % GRADIENTS.length];

  return {
    inline_keyboard: [
      [
        { text: s.backgroundType === 'gradient' ? '🎨 Gradient ✓' : '🎨 Gradient', callback_data: 'bg:gradient' },
        { text: s.backgroundType === 'solid' ? '🟦 Solid ✓' : '🟦 Solid', callback_data: 'bg:solid' },
      ],
      [
        { text: '◀ Gradient', callback_data: 'grad:prev' },
        { text: `${grad.name}`, callback_data: 'grad:info' },
        { text: 'Gradient ▶', callback_data: 'grad:next' },
      ],
      [
        { text: `Padding: ${s.padding}px`, callback_data: 'pad:info' },
        { text: '➖', callback_data: 'pad:down' },
        { text: '➕', callback_data: 'pad:up' },
      ],
      [
        { text: `Radius: ${s.borderRadius}px`, callback_data: 'rad:info' },
        { text: '➖', callback_data: 'rad:down' },
        { text: '➕', callback_data: 'rad:up' },
      ],
      [
        {
          text: s.showWindowBar ? '🪟 Window Bar: ON' : '🪟 Window Bar: OFF',
          callback_data: 'win:toggle',
        },
      ],
      [{ text: '✅ Done', callback_data: 'settings:close' }],
    ],
  };
}

const ALLOWED_IDS = [
  1400175163,
  -1001578007378,
  -1002109878033,
];

function isAllowed(id) {
  return ALLOWED_IDS.includes(id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const update = req.body;

  const incomingId = update.message?.chat.id
    || update.callback_query?.message.chat.id
    || update.channel_post?.chat.id;

  if (!incomingId || !isAllowed(incomingId)) {
    return res.status(200).json({ ok: true });
  }

  if (update.callback_query) {
    const { id, from, message, data } = update.callback_query;
    const userId = from.id;
    const chatId = message.chat.id;
    const msgId = message.message_id;
    const s = getSettings(userId);

    let answered = false;

    if (data === 'bg:gradient') setSettings(userId, { backgroundType: 'gradient' });
    else if (data === 'bg:solid') setSettings(userId, { backgroundType: 'solid' });
    else if (data === 'grad:next') setSettings(userId, { gradientIndex: (s.gradientIndex + 1) % GRADIENTS.length });
    else if (data === 'grad:prev') setSettings(userId, { gradientIndex: (s.gradientIndex - 1 + GRADIENTS.length) % GRADIENTS.length });
    else if (data === 'pad:up') setSettings(userId, { padding: Math.min(s.padding + 10, 120) });
    else if (data === 'pad:down') setSettings(userId, { padding: Math.max(s.padding - 10, 10) });
    else if (data === 'rad:up') setSettings(userId, { borderRadius: Math.min(s.borderRadius + 4, 48) });
    else if (data === 'rad:down') setSettings(userId, { borderRadius: Math.max(s.borderRadius - 4, 0) });
    else if (data === 'win:toggle') setSettings(userId, { showWindowBar: !s.showWindowBar });
    else if (data === 'settings:close') {
      await callAPI('answerCallbackQuery', { callback_query_id: id });
      await callAPI('editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: '✅ Đã lưu cài đặt! Gửi ảnh để áp dụng.',
      });
      return res.status(200).json({ ok: true });
    }

    if (!answered) {
      await callAPI('answerCallbackQuery', { callback_query_id: id });
      await callAPI('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: buildSettingsKeyboard(userId),
      });
    }

    return res.status(200).json({ ok: true });
  }

  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return res.status(200).json({ ok: true });
  }

  const message = update.message;
  if (!message) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text?.trim();

  if (text === '/start') {
    await sendMessage(
      chatId,
      `👋 Xin chào! Mình là <b>SnapFrame Bot</b> 🖼

Gửi cho mình một ảnh bất kỳ, mình sẽ tự động:
• Bo tròn góc ảnh
• Thêm nền màu/gradient đẹp
• Thêm shadow

<b>Lệnh:</b>
/settings — Chỉnh style (gradient, padding, radius...)
/help — Hướng dẫn chi tiết`
    );
    return res.status(200).json({ ok: true });
  }

  if (text === '/settings') {
    const s = getSettings(userId);
    const grad = GRADIENTS[s.gradientIndex % GRADIENTS.length];
    await callAPI('sendMessage', {
      chat_id: chatId,
      text: `⚙️ <b>Cài đặt hiện tại:</b>\n\nNền: ${s.backgroundType === 'gradient' ? `Gradient - ${grad.name}` : `Solid - ${s.solidColor}`}\nPadding: ${s.padding}px\nRadius: ${s.borderRadius}px\nWindow Bar: ${s.showWindowBar ? 'Bật' : 'Tắt'}`,
      parse_mode: 'HTML',
      reply_markup: buildSettingsKeyboard(userId),
    });
    return res.status(200).json({ ok: true });
  }

  if (text === '/help') {
    await sendMessage(
      chatId,
      `📖 <b>Hướng dẫn dùng SnapFrame Bot</b>

1. Gửi ảnh bất kỳ → bot trả về ảnh đã được framed
2. Dùng /settings để tùy chỉnh style trước khi gửi ảnh

<b>Tùy chỉnh có:</b>
• <b>Background:</b> Gradient (10 màu) hoặc Solid
• <b>Padding:</b> Khoảng cách viền (10–120px)
• <b>Radius:</b> Bo tròn góc (0–48px)
• <b>Window Bar:</b> Thêm thanh macOS giả

<i>Mẹo: Gửi ảnh screenshot sẽ trông rất đẹp! 🎨</i>`
    );
    return res.status(200).json({ ok: true });
  }

  if (message.photo || message.document?.mime_type?.startsWith('image/')) {
    await sendTyping(chatId);

    try {
      let fileId;
      if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
      } else {
        fileId = message.document.file_id;
      }

      const imgBuffer = await downloadImage(fileId);
      const settings = getSettings(userId);
      const processed = await processImage(imgBuffer, settings);

      const grad = GRADIENTS[settings.gradientIndex % GRADIENTS.length];
      const bgLabel = settings.backgroundType === 'gradient' ? grad.name : 'Solid';

      await sendPhoto(chatId, processed, `✨ Framed! — ${bgLabel} • ${settings.padding}px padding • r${settings.borderRadius}`);
    } catch (err) {
      console.error('Processing error:', err);
      await sendMessage(chatId, '❌ Có lỗi xử lý ảnh. Thử lại nhé!\n\n<code>' + err.message + '</code>');
    }

    return res.status(200).json({ ok: true });
  }

  if (text && !text.startsWith('/')) {
    await sendMessage(chatId, '📸 Gửi ảnh cho mình nhé! Dùng /settings để tùy chỉnh style.');
  }

  return res.status(200).json({ ok: true });
}

async function handleChannelPost(post) {
  if (!post.photo && !post.document?.mime_type?.startsWith('image/')) return;

  const chatId = post.chat.id;
  const msgId = post.message_id;

  try {
    let fileId;
    if (post.photo) {
      fileId = post.photo[post.photo.length - 1].file_id;
    } else {
      fileId = post.document.file_id;
    }

    const imgBuffer = await downloadImage(fileId);
    const processed = await processImage(imgBuffer, {
      padding: 40,
      borderRadius: 24,
      backgroundType: 'solid',
      gradientIndex: 0,
      solidColor: '#181818',
      showWindowBar: false,
    });

    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('message_id', String(msgId));
    const mediaJson = { type: "photo", media: "attach://photo" };
    if (post.caption) {
      mediaJson.caption = post.caption;
      if (post.caption_entities) mediaJson.caption_entities = post.caption_entities;
    }
    form.append("media", JSON.stringify(mediaJson));
    form.append('photo', new Blob([processed], { type: 'image/png' }), 'framed.png');

    await fetch(`${API}/editMessageMedia`, { method: 'POST', body: form });
  } catch (err) {
    console.error('Channel post error:', err);
  }
}
