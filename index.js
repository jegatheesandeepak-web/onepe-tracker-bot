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
  return (text || '').toString().replace(/\s+/g, ' ').trim();
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

function normalizeStage(value) {
  if (value === undefined || value === null || value === '') return '';

  // Numeric stage support
  const num = Number(value);
  if (!Number.isNaN(num)) {
    // If app uses 0-based stage index: 0..9
    if (num >= 0 && num < STAGES.length) {
      return STAGES[num];
    }

    // If app uses 1-based stage index: 1..10
    if (num >= 1 && num <= STAGES.length) {
      return STAGES[num - 1];
    }
  }

  const text = clean(value);

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

  return stageMap[text] || '';
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
  const result = await page.evaluate(() => {
    const pick = (obj, keys) => {
      for (const key of keys) {
        if (
          obj &&
          obj[key] !== undefined &&
          obj[key] !== null &&
          String(obj[key]).trim() !== ''
        ) {
          return String(obj[key]).replace(/\s+/g, ' ').trim();
        }
      }
      return '';
    };

    const stageCandidates = [
      'currentStage',
      'stage',
      'status',
      'onboardingStage',
      'step',
      'current_status',
      'current_stage'
    ];

    const nameCandidates = [
      'merchantName',
      'merchant_name',
      'name',
      'shopName',
      'shop_name',
      'storeName',
      'store_name',
      'merchant',
      'accountName',
      'account_name',
      'businessName',
      'business_name',
      'outletName',
      'outlet_name',
      'companyName',
      'company_name',
      'brandName',
      'brand_name',
      'customerName',
      'customer_name',
      'clientName',
      'client_name',
      'title'
    ];

    let merchantsData = [];

    try {
      if (typeof merchants !== 'undefined' && Array.isArray(merchants)) {
        merchantsData = merchants;
      }
    } catch (e) {}

    try {
      if (!merchantsData.length && typeof merchantList !== 'undefined' && Array.isArray(merchantList)) {
        merchantsData = merchantList;
      }
    } catch (e) {}

    try {
      if (!merchantsData.length && typeof data !== 'undefined' && Array.isArray(data)) {
        merchantsData = data;
      }
    } catch (e) {}

    if (!merchantsData.length && Array.isArray(window.merchants)) {
      merchantsData = window.merchants;
    }
    if (!merchantsData.length && Array.isArray(window.merchantList)) {
      merchantsData = window.merchantList;
    }
    if (!merchantsData.length && window.appState && Array.isArray(window.appState.merchants)) {
      merchantsData = window.appState.merchants;
    }
    if (!merchantsData.length && window.state && Array.isArray(window.state.merchants)) {
      merchantsData = window.state.merchants;
    }

    const storages = [localStorage, sessionStorage];
    for (const store of storages) {
      if (merchantsData.length) break;

      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const value = store.getItem(key);
        if (!value) continue;

        try {
          const parsed = JSON.parse(value);

          if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
            merchantsData = parsed;
            break;
          }

          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.merchants)) {
            merchantsData = parsed.merchants;
            break;
          }
        } catch (e) {}
      }
    }

    if (!merchantsData.length) {
      const scripts = Array.from(document.scripts)
        .map(s => s.textContent || '')
        .join('\n');

      const patterns = [
        /(?:const|let|var)\s+merchants\s*=\s*(\[[\s\S]*?\]);/,
        /(?:const|let|var)\s+merchantList\s*=\s*(\[[\s\S]*?\]);/,
        /"merchants"\s*:\s*(\[[\s\S]*?\])/,
      ];

      for (const pattern of patterns) {
        const match = scripts.match(pattern);
        if (match && match[1]) {
          try {
            merchantsData = JSON.parse(match[1]);
            break;
          } catch (e) {}
        }
      }
    }

    const normalized = merchantsData.map(item => {
      const merchant = pick(item, nameCandidates);
      const stage = pick(item, stageCandidates);
      return { merchant, stage, raw: item };
    });

    return {
      extracted: normalized,
      debug: {
        count: normalized.length,
        sample: normalized.slice(0, 5)
      }
    };
  });

  console.log('DEBUG_MERCHANT_RESULT:', JSON.stringify(result, null, 2));
  return result.extracted || [];
}

function buildMessage(data) {
  const grouped = {};
  STAGES.forEach(stage => {
    grouped[stage] = [];
  });

  for (const item of data) {
    const merchant = clean(item.merchant);
    const stage = normalizeStage(item.stage);

    if (merchant && stage && STAGES.includes(stage) && !grouped[stage].includes(merchant)) {
      grouped[stage].push(merchant);
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

    const normalized = rawData
      .map(item => ({
        merchant: clean(item.merchant),
        stage: normalizeStage(item.stage)
      }))
      .filter(item => item.merchant && item.stage && STAGES.includes(item.stage));

    if (!normalized.length) {
      throw new Error('Merchant data extracted, but merchant name or stage mapping still did not match.');
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
