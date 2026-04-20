const { chromium } = require('playwright');
const axios = require('axios');

const TRACKER_URL = process.env.TRACKER_URL || 'https://onepe-onboarding.netlify.app/';
const PIN = process.env.TRACKER_PIN || '2026';

const API_URL = process.env.GREEN_API_URL || '';
const INSTANCE = process.env.GREEN_INSTANCE_ID || '';
const TOKEN = process.env.GREEN_API_TOKEN || '';
const PHONE = process.env.WHATSAPP_NUMBER || '';

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
  '🚀 Go Live'
];

function validateEnv() {
  const missing = [];
  if (!API_URL) missing.push('GREEN_API_URL');
  if (!INSTANCE) missing.push('GREEN_INSTANCE_ID');
  if (!TOKEN) missing.push('GREEN_API_TOKEN');
  if (!PHONE) missing.push('WHATSAPP_NUMBER');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeStage(text) {
  const value = clean(text);
  const byEmojiOrText = {
    'Documents Collected': '📋 Documents Collected',
    '📋 Documents Collected': '📋 Documents Collected',
    'Documents Verified': '🔍 Documents Verified',
    '🔍 Documents Verified': '🔍 Documents Verified',
    'Onboarding Processed': '⚙️ Onboarding Processed',
    '⚙️ Onboarding Processed': '⚙️ Onboarding Processed',
    'Agreement Sent & Signed': '✍️ Agreement Sent & Signed',
    '✍️ Agreement Sent & Signed': '✍️ Agreement Sent & Signed',
    'Approved by Payswiff': '📤 Approved by Payswiff',
    '📤 Approved by Payswiff': '📤 Approved by Payswiff',
    'Device Configured': '✅ Device Configured',
    '✅ Device Configured': '✅ Device Configured',
    'Sample Bill Collected': '🧾 Sample Bill Collected',
    '🧾 Sample Bill Collected': '🧾 Sample Bill Collected',
    'Installed': '📲 Installed',
    '📲 Installed': '📲 Installed',
    'Payment Collected': '💰 Payment Collected',
    '💰 Payment Collected': '💰 Payment Collected',
    'Go Live': '🚀 Go Live',
    '🚀 Go Live': '🚀 Go Live',
  };
  return byEmojiOrText[value] || value;
}

async function unlockTracker(page) {
  await page.goto(TRACKER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const passwordInput = page.locator('input[type="password"], input[placeholder*="PIN" i]').first();
  if (await passwordInput.count()) {
    await passwordInput.fill(PIN);
    const submitButton = page.getByRole('button').filter({ hasText: /submit|unlock|enter|login|continue/i }).first();
    if (await submitButton.count()) {
      await submitButton.click();
    } else {
      await passwordInput.press('Enter');
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function readRows(page) {
  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    if (!tables.length) return [];

    const table = tables[0];
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    return rows.map((row) => {
      const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || '');
      return { cols, obj };
    });
  });
}

function mapMerchantStage(rows) {
  const results = [];

  for (const row of rows) {
    const obj = row.obj || {};
    const cols = row.cols || [];

    const merchant =
      clean(obj['Merchant Name']) ||
      clean(obj['Account Name']) ||
      clean(obj['Name']) ||
      clean(cols[1]) ||
      clean(cols[0]);

    if (!merchant) continue;

    let stage =
      clean(obj['Current Stage']) ||
      clean(obj['Stage']) ||
      clean(obj['Status']) ||
      clean(obj['Onboarding Stage']);

    if (!stage) {
      // Fallback: choose the last non-empty cell that looks like a stage value
      const possible = cols
        .map(clean)
        .filter(Boolean)
        .map(normalizeStage)
        .find(v => STAGES.includes(v));
      stage = possible || '';
    } else {
      stage = normalizeStage(stage);
    }

    if (!stage || !STAGES.includes(stage)) continue;
    results.push({ merchant, stage });
  }

  return results;
}

function buildMessage(data) {
  const grouped = {};
  STAGES.forEach(stage => grouped[stage] = []);

  for (const item of data) {
    if (!grouped[item.stage].includes(item.merchant)) {
      grouped[item.stage].push(item.merchant);
    }
  }

  let message = '📊 OnePe Onboarding Tracker – Stage Wise\n\n';

  for (const stage of STAGES) {
    message += `${stage}\n`;
    if (!grouped[stage].length) {
      message += '• -\n\n';
    } else {
      grouped[stage].forEach(name => {
        message += `• ${name}\n`;
      });
      message += '\n';
    }
  }

  message += `Total Merchants: ${data.length}`;
  return message;
}

async function sendWhatsApp(message) {
  const url = `${API_URL}/waInstance${INSTANCE}/sendMessage/${TOKEN}`;
  const payload = {
    chatId: `${PHONE}@c.us`,
    message
  };

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000
  });

  console.log('WhatsApp message sent:', response.data);
}

(async () => {
  validateEnv();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await unlockTracker(page);
    const rawRows = await readRows(page);
    const mapped = mapMerchantStage(rawRows);

    if (!mapped.length) {
      throw new Error('No merchant rows were parsed. Check the tracker table structure and selectors.');
    }

    const message = buildMessage(mapped);
    console.log(message);
    await sendWhatsApp(message);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('Automation failed:', err);
  process.exit(1);
});
