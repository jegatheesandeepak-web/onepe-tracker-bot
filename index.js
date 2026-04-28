const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const TRACKER_URL = process.env.TRACKER_URL || 'https://onepe-onboarding.netlify.app/';
const PIN = process.env.TRACKER_PIN || '2026';

const API_URL = process.env.GREEN_API_URL || '';
const INSTANCE = process.env.GREEN_INSTANCE_ID || '';
const TOKEN = process.env.GREEN_API_TOKEN || '';
const PHONE = process.env.WHATSAPP_NUMBER || '';
const GROUP_ID_RAW = process.env.WHATSAPP_GROUP_ID || '';

const SNAPSHOT_FILE = 'tracker-snapshot.json';

// ✅ UPDATED STAGES (1–13)
const STAGES = [
  '📋 Documents Collected',
  '🔍 Documents Verified',
  '⚙️ Onboarding Processed',
  '✍️ Agreement Sent & Signed',
  '📤 Approved by Payswiff',
  '✅ Device Configured',
  '🧾 Sample Bill Collected',
  '📲 Installed',
  '💰 Payment Collected',
  '🚀 Go Live',
  '🔌 Deinstalled',
  '⏸️ On Hold',
  '❌ Closed Lost'
];

const LIVE_STAGE = '🚀 Go Live';

const PRIORITY_STAGES = [
  '⚙️ Onboarding Processed',
  '✍️ Agreement Sent & Signed',
  '📤 Approved by Payswiff',
  '✅ Device Configured',
  '🧾 Sample Bill Collected',
  '📲 Installed',
  '💰 Payment Collected'
];

const EARLY_PIPELINE_STAGES = [
  '📋 Documents Collected',
  '🔍 Documents Verified'
];

const EXCEPTION_STAGES = [
  '⏸️ On Hold',
  '🔌 Deinstalled',
  '❌ Closed Lost'
];

function clean(text) {
  return (text || '').toString().replace(/\s+/g, ' ').trim();
}

function normalizeGroupId(groupId) {
  const value = clean(groupId);
  if (!value) return '';
  return value.endsWith('@g.us') ? value : `${value}@g.us`;
}

function validateEnv() {
  const missing = [];
  if (!API_URL) missing.push('GREEN_API_URL');
  if (!INSTANCE) missing.push('GREEN_INSTANCE_ID');
  if (!TOKEN) missing.push('GREEN_API_TOKEN');
  if (!PHONE && !GROUP_ID_RAW) missing.push('WHATSAPP_NUMBER or WHATSAPP_GROUP_ID');

  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(', ')}`);
  }
}

function normalizeStage(value) {
  if (!value && value !== 0) return '';

  const num = Number(value);

  // ✅ IMPORTANT: 1-based mapping
  if (!Number.isNaN(num)) {
    if (num >= 1 && num <= STAGES.length) {
      return STAGES[num - 1];
    }
  }

  const text = clean(value);

  const map = {
    'On Hold': '⏸️ On Hold',
    'Closed Lost': '❌ Closed Lost',
    'Deinstalled': '🔌 Deinstalled'
  };

  return map[text] || '';
}

async function unlockTracker(page, pin) {
  await page.goto(TRACKER_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const input = page.locator('input').first();
  if (await input.count()) {
    await input.fill(pin);
    await input.press('Enter');
  }

  await page.waitForTimeout(3000);
}

async function extractMerchantData(page) {
  return await page.evaluate(() => {
    if (window.merchants) {
      return window.merchants.map(m => ({
        merchant: m.name || m.merchantName,
        stage: m.stage
      }));
    }
    return [];
  });
}

function loadPreviousSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSnapshot(data) {
  const snap = {};
  data.forEach(d => {
    snap[d.merchant] = d.stage;
  });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap));
}

function groupData(data) {
  const grouped = {};
  STAGES.forEach(s => grouped[s] = []);

  data.forEach(d => {
    if (STAGES.includes(d.stage)) {
      grouped[d.stage].push(d.merchant);
    }
  });

  return grouped;
}

function buildMessage(data, prev = {}) {
  const grouped = groupData(data);

  const total = data.length;
  const live = grouped[LIVE_STAGE].length;
  const deinstalled = grouped['🔌 Deinstalled'].length;
  const closed = grouped['❌ Closed Lost'].length;

  const active = total - live - deinstalled - closed;
  const conversion = total ? ((live / (total - closed)) * 100).toFixed(1) : 0;

  let msg = `📊 *OnePe Tracker – Sales Performance Update*\n\n`;

  msg += `*Total Merchants:* ${total}\n`;
  msg += `*🚀 Go Live:* ${live}\n`;
  msg += `*⏳ Active Pipeline:* ${active}\n`;

  if (grouped['⏸️ On Hold'].length)
    msg += `*⏸️ On Hold:* ${grouped['⏸️ On Hold'].length}\n`;

  if (deinstalled)
    msg += `*🔌 Deinstalled:* ${deinstalled}\n`;

  if (closed)
    msg += `*❌ Closed Lost:* ${closed}\n`;

  msg += `*📈 Conversion:* ${conversion}%\n\n`;

  msg += `🔥 *Immediate Action Required*\n\n`;

  PRIORITY_STAGES.forEach(stage => {
    if (!grouped[stage].length) return;

    msg += `*${stage} (${grouped[stage].length})*\n`;
    grouped[stage].forEach(m => msg += `• ${m}\n`);
    msg += `\n`;
  });

  if (grouped['⏸️ On Hold'].length) {
    msg += `⚠️ *On Hold (Revive Immediately)*\n`;
    grouped['⏸️ On Hold'].forEach(m => msg += `• ${m}\n`);
    msg += `\n`;
  }

  msg += `🚀 *Go Live Accounts (${live})*\n`;
  grouped[LIVE_STAGE].forEach(m => msg += `• ${m}\n`);

  msg += `\n\n🎯 *Sales Focus:* Push pipeline aggressively. No stagnation.`;

  return msg;
}

async function sendWhatsApp(message) {
  const url = `${API_URL}/waInstance${INSTANCE}/sendMessage/${TOKEN}`;
  const groupId = normalizeGroupId(GROUP_ID_RAW);

  const targets = [];
  if (PHONE) targets.push(`${PHONE}@c.us`);
  if (groupId) targets.push(groupId);

  for (const chatId of targets) {
    await axios.post(url, { chatId, message });
  }
}

(async () => {
  validateEnv();

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await unlockTracker(page, PIN);

    const raw = await extractMerchantData(page);

    const data = raw.map(r => ({
      merchant: clean(r.merchant),
      stage: normalizeStage(r.stage)
    })).filter(d => d.merchant && d.stage);

    const prev = loadPreviousSnapshot();

    const msg = buildMessage(data, prev);

    console.log(msg);

    await sendWhatsApp(msg);

    saveSnapshot(data);

  } finally {
    await browser.close();
  }
})();
