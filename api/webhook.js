import sharp from 'sharp';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Whitelist ────────────────────────────────────────────────────────────────
const ALLOWED_IDS = [
  123456789,        // ← thay bằng ID cá nhân của bạn
  -1001578007378,   // ← ID kênh 1
  -1002109878033,   // ← ID kênh 2
];

function isAllowed(id) {
  return ALLOWED_IDS.includes(id);
}

// ─── Gradient presets ─────────────────────────────────────────────────────────
const GRADIENTS = [
  { name: 'Purple Dream', colors: ['#667eea', '#764ba2'] },
  { name: 'Pink Flamingo', colors: ['#f093fb', '#f5576c'] },
  { name: 'Ocean Blue',   colors: ['#5eeff1', '#3598fb'] },
  { name: 'Lavender',     colors: ['#a18cd1', '#fbc2eb'] },
  { name: 'Peach',        colors: ['#ffecd2', '#fcb69f'] },
  { name: 'Dark Slate',   colors: ['#0f172a', '#334155'] },
  { name: 'Cyber',        colors: ['#00dbde', '#fc00ff'] },
  { name: 'Sunset',       colors: ['#f6d365', '#fda085'] },
  { name: 'Mint',         colors: ['#84fab0', '#8fd3f4'] },
  { name: 'Soft Sky',     colors: ['#e0c3fc', '#8ec5fc'] },
];

// ─── User settings (in-memory, chat riêng với bot) ────────────────────────────
const userSettings = new Map();

function getSettings(userId) {
  return userSettings.get(userId) || {
    padding: 50,
    borderRadius: 20,
    backgroundType: 'solid',
    gradientIndex: 0,
    solidColor: '#64748b',
    showWindowBar: false,
  };
}

function setSettings(userId, patch) {
  userSettings.set(userId, { ...getSettings(userId), ...patch });
}

// ─── Smart ratio tối ưu cho Telegram ─────────────────────────────────────────
function getTargetRatio(imgW, imgH) {
  const r = imgW / imgH;
  if (r > 1.5) return { w: 16,  h: 9   }; // Rất ngang  → 16:9
  if (r > 1.0) return { w: 191, h: 100 }; // Ngang vừa  → 1.91:1
  if (r > 0.8) return { w: 1,   h: 1   }; // Gần vuông  → 1:1
  return             { w: 4,   h: 5   }; // Dọc        → 4:5
}

function calcPadding(imgW, imgH, targetW, targetH, minPad) {
  const targetRatio = targetW / targetH;
  const imgRatio    = imgW / imgH;

  let canvasW, canvasH;
  if (imgRatio > targetRatio) {
    canvasW = imgW + minPad * 2;
    canvasH = Math.round(canvasW / targetRatio);
  } else {
    canvasH = imgH + minPad * 2;
    canvasW = Math.round(canvasH * targetRatio);
  }

  const padX = Math.max(Math.round((canvasW - imgW) / 2), minPad);
  const padY = Math.max(Math.round((canvasH - imgH) / 2), minPad);

  return {
    padX,
    padY,
    canvasW: imgW + padX * 2,
    canvasH: imgH + padY * 2,
  };
}

// ─── Core image processing ────────────────────────────────────────────────────
async function processImage(buffer, settings) {
  const { padding, borderRadius, backgroundType, gradientIndex, solidColor, showWindowBar } = settings;
  const gradient = GRADIENTS[gradientIndex % GRADIENTS.length];

  // Cap ảnh lớn tránh timeout Vercel
  const MAX_SIZE = 2000;
  const meta = await sharp(buffer).metadata();
  const needsResize = meta.width > MAX_SIZE || meta.height > MAX_SIZE;

  const imgBuffer = needsResize
    ? await sharp(buffer).resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    : await sharp(buffer).png().toBuffer();

  const { width, height } = await sharp(imgBuffer).metadata();

  // Window bar
  const barHeight = showWindowBar ? 36 : 0;
  const innerH    = height + barHeight;

  // Rounded mask
  const mask = Buffer.from(
    `<svg width="${width}" height="${innerH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${innerH}" rx="${borderRadius}" ry="${borderRadius}" fill="white"/>
    </svg>`
  );

  // Window bar SVG
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

  // Composite bar + ảnh
  const composites = [];
  if (windowBarSvg) composites.push({ input: windowBarSvg, top: 0, left: 0 });
  composites.push({ input: imgBuffer, top: barHeight, left: 0 });

  const framedContent = await sharp({
    create: { width, height: innerH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).composite(composites).png().toBuffer();

  // Bo tròn góc
  const roundedContent = await sharp(framedContent)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Tính canvas theo tỷ lệ Telegram tối ưu
  const target = getTargetRatio(width, innerH);
  const { padX, padY, canvasW, canvasH } = calcPadding(width, innerH, target.w, target.h, padding);

  // Background
  let bgSvg;
  if (backgroundType === 'gradient') {
    const [c1, c2] = gradient.colors;
    bgSvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </linearGradient>
      </defs>
      <rect width="${canvasW}" height="${canvasH}" fill="url(#g)"/>
    </svg>`;
  } else {
    bgSvg = `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${canvasW}" height="${canvasH}" fill="${solidColor}"/>
    </svg>`;
  }

  // Shadow
  const shadowBlur   = Math.round(Math.min(padX, padY) * 0.3);
  const shadowOffset = Math.round(Math.min(padX, padY) * 0.08);

  const shadowSvg = Buffer.from(
    `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="s">
          <feGaussianBlur stdDeviation="${shadowBlur}"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0"/>
        </filter>
      </defs>
      <rect x="${padX}" y="${padY + shadowOffset}" width="${width}" height="${innerH}"
            rx="${borderRadius}" ry="${borderRadius}" fill="black" filter="url(#s)"/>
    </svg>`
  );

  return sharp(Buffer.from(bgSvg))
    .composite([
      { input: shadowSvg, blend: 'over' },
      { input: roundedContent, left: padX, top: padY },
    ])
    .png()
    .toBuffer();
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
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
  const { result } = await (await fetch(`${API}/getFile?file_id=${fileId}`)).json();
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${result.file_path}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

async function sendPhoto(chatId, buffer, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'snapframe.png');
  if (caption) form.append('caption', caption);
  await fetch(`${API}/sendPhoto`, { method: 'POST', body: form });
}

// ─── Settings keyboard ────────────────────────────────────────────────────────
function buildSettingsKeyboard(userId) {
  const s    = getSettings(userId);
  const grad = GRADIENTS[s.gradientIndex % GRADIENTS.length];

  return {
    inline_keyboard: [
      [
        { text: s.backgroundType === 'gradient' ? '🎨 Gradient ✓' : '🎨 Gradient', callback_data: 'bg:gradient' },
        { text: s.backgroundType === 'solid'    ? '🟦 Solid ✓'    : '🟦 Solid',    callback_data: 'bg:solid'    },
      ],
      [
        { text: '◀',       callback_data: 'grad:prev' },
        { text: grad.name, callback_data: 'grad:info' },
        { text: '▶',       callback_data: 'grad:next' },
      ],
      [
        { text: `Padding: ${s.padding}px`,     callback_data: 'pad:info' },
        { text: '➖', callback_data: 'pad:down' },
        { text: '➕', callback_data: 'pad:up'   },
      ],
      [
        { text: `Radius: ${s.borderRadius}px`, callback_data: 'rad:info' },
        { text: '➖', callback_data: 'rad:down' },
        { text: '➕', callback_data: 'rad:up'   },
      ],
      [
        { text: s.showWindowBar ? '🪟 Window Bar: ON' : '🪟 Window Bar: OFF', callback_data: 'win:toggle' },
      ],
      [{ text: '✅ Done', callback_data: 'settings:close' }],
    ],
  };
}

// ─── Channel post handler ─────────────────────────────────────────────────────
async function handleChannelPost(post) {
  if (!post.photo && !post.document?.mime_type?.startsWith('image/')) return;

  const chatId = post.chat.id;
  const msgId  = post.message_id;

  try {
    const fileId = post.photo
      ? post.photo[post.photo.length - 1].file_id
      : post.document.file_id;

    const imgBuffer = await downloadImage(fileId);
    const processed = await processImage(imgBuffer, {
      padding:        50,
      borderRadius:   20,
      backgroundType: 'solid',
      gradientIndex:  0,
      solidColor:     '#64748b',
      showWindowBar:  false,
    });

    const form = new FormData();
    form.append('chat_id',    String(chatId));
    form.append('message_id', String(msgId));

    const mediaJson = { type: 'photo', media: 'attach://photo' };
    if (post.caption)          mediaJson.caption          = post.caption;
    if (post.caption_entities) mediaJson.caption_entities = post.caption_entities;
    form.append('media', JSON.stringify(mediaJson));
    form.append('photo', new Blob([processed], { type: 'image/png' }), 'framed.png');

    await fetch(`${API}/editMessageMedia`, { method: 'POST', body: form });
  } catch (err) {
    console.error('Channel post error:', err);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const update = req.body;

  // Whitelist check
  const incomingId = update.message?.chat.id
    || update.callback_query?.message.chat.id
    || update.channel_post?.chat.id;

  if (!incomingId || !isAllowed(incomingId)) {
    return res.status(200).json({ ok: true });
  }

  // Channel post
  if (update.channel_post) {
    await handleChannelPost(update.channel_post);
    return res.status(200).json({ ok: true });
  }

  // Callback query (inline keyboard)
  if (update.callback_query) {
    const { id, from, message, data } = update.callback_query;
    const userId = from.id;
    const chatId = message.chat.id;
    const msgId  = message.message_id;
    const s      = getSettings(userId);

    if      (data === 'bg:gradient') setSettings(userId, { backgroundType: 'gradient' });
    else if (data === 'bg:solid')    setSettings(userId, { backgroundType: 'solid' });
    else if (data === 'grad:next')   setSettings(userId, { gradientIndex: (s.gradientIndex + 1) % GRADIENTS.length });
    else if (data === 'grad:prev')   setSettings(userId, { gradientIndex: (s.gradientIndex - 1 + GRADIENTS.length) % GRADIENTS.length });
    else if (data === 'pad:up')      setSettings(userId, { padding: Math.min(s.padding + 10, 120) });
    else if (data === 'pad:down')    setSettings(userId, { padding: Math.max(s.padding - 10, 10) });
    else if (data === 'rad:up')      setSettings(userId, { borderRadius: Math.min(s.borderRadius + 4, 48) });
    else if (data === 'rad:down')    setSettings(userId, { borderRadius: Math.max(s.borderRadius - 4, 0) });
    else if (data === 'win:toggle')  setSettings(userId, { showWindowBar: !s.showWindowBar });
    else if (data === 'settings:close') {
      await callAPI('answerCallbackQuery', { callback_query_id: id });
      await callAPI('editMessageText', {
        chat_id: chatId, message_id: msgId,
        text: '✅ Đã lưu cài đặt! Gửi ảnh để áp dụng.',
      });
      return res.status(200).json({ ok: true });
    }

    await callAPI('answerCallbackQuery', { callback_query_id: id });
    await callAPI('editMessageReplyMarkup', {
      chat_id: chatId, message_id: msgId,
      reply_markup: buildSettingsKeyboard(userId),
    });
    return res.status(200).json({ ok: true });
  }

  // Direct message
  const message = update.message;
  if (!message) return res.status(200).json({ ok: true });

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text   = message.text?.trim();

  if (text === '/start') {
    await sendMessage(chatId,
      `👋 Xin chào! Mình là <b>SnapFrame Bot</b> 🖼\n\n` +
      `Gửi cho mình một ảnh bất kỳ, mình sẽ tự động:\n` +
      `• Bo tròn góc ảnh\n• Thêm nền đẹp\n• Tự căn tỷ lệ chuẩn Telegram\n• Thêm shadow\n\n` +
      `<b>Lệnh:</b>\n/settings — Chỉnh style\n/help — Hướng dẫn`
    );
    return res.status(200).json({ ok: true });
  }

  if (text === '/settings') {
    const s    = getSettings(userId);
    const grad = GRADIENTS[s.gradientIndex % GRADIENTS.length];
    await callAPI('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `⚙️ <b>Cài đặt hiện tại:</b>\n\n` +
            `Nền: ${s.backgroundType === 'gradient' ? `Gradient — ${grad.name}` : `Solid — ${s.solidColor}`}\n` +
            `Padding: ${s.padding}px\nRadius: ${s.borderRadius}px\nWindow Bar: ${s.showWindowBar ? 'Bật' : 'Tắt'}`,
      reply_markup: buildSettingsKeyboard(userId),
    });
    return res.status(200).json({ ok: true });
  }

  if (text === '/help') {
    await sendMessage(chatId,
      `📖 <b>Hướng dẫn SnapFrame Bot</b>\n\n` +
      `1. Gửi ảnh → bot trả về ảnh đã framed\n` +
      `2. Bot tự chọn tỷ lệ tối ưu cho Telegram:\n` +
      `   • Rất ngang → 16:9\n   • Ngang vừa → 1.91:1\n` +
      `   • Gần vuông → 1:1\n   • Dọc → 4:5\n\n` +
      `3. Dùng /settings để tùy chỉnh style\n\n` +
      `<i>Mẹo: Gửi ảnh dưới dạng File để giữ chất lượng gốc 🎨</i>`
    );
    return res.status(200).json({ ok: true });
  }

  if (message.photo || message.document?.mime_type?.startsWith('image/')) {
    await sendTyping(chatId);
    try {
      const fileId = message.photo
        ? message.photo[message.photo.length - 1].file_id
        : message.document.file_id;

      const imgBuffer = await downloadImage(fileId);
      const settings  = getSettings(userId);
      const processed = await processImage(imgBuffer, settings);

      const grad    = GRADIENTS[settings.gradientIndex % GRADIENTS.length];
      const bgLabel = settings.backgroundType === 'gradient' ? grad.name : settings.solidColor;
      await sendPhoto(chatId, processed,
        `✨ Framed! — ${bgLabel} • pad ${settings.padding}px • r${settings.borderRadius}`
      );
    } catch (err) {
      console.error('Processing error:', err);
      await sendMessage(chatId, `❌ Lỗi xử lý ảnh.\n\n<code>${err.message}</code>`);
    }
    return res.status(200).json({ ok: true });
  }

  if (text && !text.startsWith('/')) {
    await sendMessage(chatId, '📸 Gửi ảnh cho mình nhé! Dùng /settings để tùy chỉnh style.');
  }

  return res.status(200).json({ ok: true });
}
