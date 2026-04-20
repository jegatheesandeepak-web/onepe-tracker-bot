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

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

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

function normalizeStage(text) {
  const value = clean(text);

  const map = {
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
    '🚀 Go Live': '🚀 Go Live'
  };

  return map[value] || value;
}

async function unlockWithKeypad(page, pin) {
  await page.goto(TRACKER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Try direct input first
  const input = page.locator('input[type="password"], input').first();
  if (await input.count()) {
    try {
      await input.fill(pin);
      const submitButton = page.getByRole('button', { name: /submit|unlock|enter|continue|login|✓/i }).first();
      if (await submitButton.count()) {
        await submitButton.click();
      } else {
        await input.press('Enter');
      }
    } catch (_) {
      // If direct input fails, continue to keypad method
    }
  }

  // If still on PIN screen, use keypad buttons
  const pinPrompt = page.getByText(/Enter Admin PIN/i).first();
  if (await pinPrompt.count()) {
    for (const digit of pin.split('')) {
      const btn = page.getByRole('button', { name: digit }).first();
      if (await btn.count()) {
        await btn.click();
      } else {
        await page.getByText(new RegExp(`^${digit}$`)).first().click();
      }
    }

    const okBtn = page.getByRole('button', { name: /✓|enter|submit|unlock|continue/i }).first();
    if (await okBtn.count()) {
      await okBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function extractMerchantData(page) {
  return await page.evaluate((stages) => {
    const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();

    // 1. Table-based extraction if table exists
    const table = document.querySelector('table');
    if (table) {
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.innerText));
      const rows = Array.from(table.querySelectorAll('tbody tr'));

      const items = rows.map(row => {
        const cols = Array.from(row.querySelectorAll('td')).map(td => clean(td.innerText));
        const obj = {};
        headers.forEach((h, i) => obj[h] = cols[i] || '');

        const merchant =
          obj['Merchant Name'] ||
          obj['Shop / Store Name'] ||
          obj['Shop Name'] ||
          obj['Name'] ||
          cols[1] ||
          cols[0] ||
          '';

        let stage =
          obj['Current Stage'] ||
          obj['Stage'] ||
          obj['Status'] ||
          obj['Onboarding Stage'] ||
          '';

        if (!stage) {
          stage = cols.find(c => stages.includes(c)) || '';
        }

        return { merchant, stage };
      });

      return items.filter(x => x.merchant && x.stage);
    }

    // 2. Card/list/text-based extraction fallback
    const allText = clean(document.body.innerText);
    const lines = allText
      .split('\n')
      .map(x => clean(x))
      .filter(Boolean);

    const results = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (stages.includes(line)) {
        const prev = lines[i - 1] || '';
        const next = lines[i + 1] || '';

        // Merchant name is usually near the stage text; avoid UI labels
        const ignore = [
          'Add New Merchant',
          'Settings & Configuration',
          'Merchant Onboarding Tracker',
          'Admin Dashboard',
          'Live Onboarding Status',
          'Select a merchant to manage',
          'Update stages and share live tracker with merchant'
        ];

        const candidate = [prev, next].find(
          x => x && !stages.includes(x) && !ignore.includes(x) && x.length > 2
        );

        if (candidate) {
          results.push({ merchant: candidate, stage: line });
        }
      }
    }

    // Deduplicate
    const seen = new Set();
    return results.filter(item => {
      const key = `${item.merchant}__${item.stage}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, STAGES);
}

function buildMessage(data) {
  const grouped = {};
  STAGES.forEach(stage => grouped[stage] = []);

  for (const item of data) {
    const stage = normalizeStage(item.stage);
    if (STAGES.includes(stage) && !grouped[stage].includes(item.merchant)) {
      grouped[stage].push(item.merchant);
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

  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  message += `Total Merchants: ${total}`;

  return message;
}

async function sendWhatsApp(message) {
  const url = `${API_URL}/waInstance${INSTANCE}/sendMessage/${TOKEN}`;

  await axios.post(
    url,
    {
      chatId: `${PHONE}@c.us`,
      message
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    }
  );
}

(async () => {
  validateEnv();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await unlockWithKeypad(page, PIN);

    const rawData = await extractMerchantData(page);

    if (!rawData.length) {
      console.log(await page.content());
      throw new Error('No merchant rows were parsed. Tracker UI is not in the expected format.');
    }

    const normalized = rawData
      .map(item => ({
        merchant: clean(item.merchant),
        stage: normalizeStage(item.stage)
      }))
      .filter(item => item.merchant && STAGES.includes(item.stage));

    if (!normalized.length) {
      throw new Error('Merchants were found, but no valid stages matched the configured stage list.');
    }

    const message = buildMessage(normalized);
    console.log(message);

    await sendWhatsApp(message);
    console.log('WhatsApp message sent successfully.');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('Automation failed:', err);
  process.exit(1);
});
