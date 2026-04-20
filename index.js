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

  const stageMap = {
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

  return stageMap[value] || value;
}

async function unlockTracker(page, pin) {
  await page.goto(TRACKER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const pinPrompt = page.getByText(/Enter Admin PIN/i).first();

  if (await pinPrompt.count()) {
    for (const digit of pin.split('')) {
      const buttonByRole = page.getByRole('button', { name: digit }).first();
      if (await buttonByRole.count()) {
        await buttonByRole.click();
        continue;
      }

      const buttonByText = page.locator(`button:has-text("${digit}")`).first();
      if (await buttonByText.count()) {
        await buttonByText.click();
      }
    }

    const submitButton = page.getByRole('button', { name: /enter|submit|unlock|continue|ok|✓/i }).first();
    if (await submitButton.count()) {
      await submitButton.click();
    } else {
      await page.keyboard.press('Enter');
    }
  } else {
    const input = page.locator('input[type="password"], input').first();
    if (await input.count()) {
      await input.fill(pin);

      const submitButton = page.getByRole('button', { name: /enter|submit|unlock|continue|ok|✓/i }).first();
      if (await submitButton.count()) {
        await submitButton.click();
      } else {
        await input.press('Enter');
      }
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function extractMerchantData(page) {
  const debug = await page.evaluate(() => {
    const localStorageDump = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      localStorageDump[key] = localStorage.getItem(key);
    }

    const sessionStorageDump = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      sessionStorageDump[key] = sessionStorage.getItem(key);
    }

    const allWindowKeys = Object.keys(window);
    const interestingWindowKeys = allWindowKeys.filter((k) => {
      const x = k.toLowerCase();
      return (
        x.includes('merchant') ||
        x.includes('store') ||
        x.includes('stage') ||
        x.includes('data') ||
        x.includes('state') ||
        x.includes('admin') ||
        x.includes('tracker')
      );
    });

    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 4000),
      localStorageKeys: Object.keys(localStorageDump),
      sessionStorageKeys: Object.keys(sessionStorageDump),
      localStorageDump,
      sessionStorageDump,
      windowKeys: interestingWindowKeys
    };
  });

  console.log('DEBUG_PAGE_STATE:', JSON.stringify(debug, null, 2));

  return [];
}

function buildMessage(data) {
  const grouped = {};
  STAGES.forEach((stage) => {
    grouped[stage] = [];
  });

  for (const item of data) {
    const merchant = clean(item.merchant);
    const stage = normalizeStage(item.stage);

    if (merchant && STAGES.includes(stage) && !grouped[stage].includes(merchant)) {
      grouped[stage].push(merchant);
    }
  }

  let message = '📊 OnePe Onboarding Tracker – Stage Wise\n\n';

  for (const stage of STAGES) {
    message += `${stage}\n`;

    if (!grouped[stage].length) {
      message += '• -\n\n';
    } else {
      grouped[stage].forEach((name) => {
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

  const response = await axios.post(
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

  console.log('WhatsApp sent:', response.data);
}

(async () => {
  validateEnv();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await unlockTracker(page, PIN);

    const rawData = await extractMerchantData(page);
    console.log('Extracted merchant objects:', JSON.stringify(rawData, null, 2));

    const normalized = rawData
      .map((item) => ({
        merchant: clean(item.merchant),
        stage: normalizeStage(item.stage)
      }))
      .filter((item) => item.merchant && STAGES.includes(item.stage));

    if (!normalized.length) {
      throw new Error('No usable merchant data found. Check DEBUG_PAGE_STATE in the logs.');
    }

    const message = buildMessage(normalized);
    console.log(message);

    await sendWhatsApp(message);
    console.log('WhatsApp message sent successfully.');
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('Automation failed:', err);
  process.exit(1);
});
