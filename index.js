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
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function normalizeStage(value) {
  if (value === undefined || value === null || value === '') return '';

  const num = Number(value);

  if (!Number.isNaN(num)) {
    if (num >= 1 && num <= STAGES.length) {
      return STAGES[num - 1];
    }

    if (num >= 0 && num < STAGES.length) {
      return STAGES[num];
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
    'Agreement Sent': '✍️ Agreement Sent & Signed',
    'Signed': '✍️ Agreement Sent & Signed',
    '✍️ Agreement Sent & Signed': '✍️ Agreement Sent & Signed',

    'Approved by Payswiff': '📤 Approved by Payswiff',
    'Payswiff Approved': '📤 Approved by Payswiff',
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
    'Live': '🚀 Go Live',
    '🚀 Go Live': '🚀 Go Live',

    'Deinstalled': '🔌 Deinstalled',
    'De-Installed': '🔌 Deinstalled',
    'De Installed': '🔌 Deinstalled',
    '🔌 Deinstalled': '🔌 Deinstalled',

    'On Hold': '⏸️ On Hold',
    'OnHold': '⏸️ On Hold',
    'Hold': '⏸️ On Hold',
    '⏸️ On Hold': '⏸️ On Hold',

    'Closed Lost': '❌ Closed Lost',
    'Close Lost': '❌ Closed Lost',
    'Lost': '❌ Closed Lost',
    '❌ Closed Lost': '❌ Closed Lost'
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

    return merchantsData.map(item => {
      const merchant = pick(item, nameCandidates);
      const stage = pick(item, stageCandidates);
      const updatedAt =
        pick(item, ['updated_at', 'updatedAt', 'lastUpdated', 'modifiedAt', 'modified_at']) || '';

      return { merchant, stage, updatedAt, raw: item };
    });
  });

  console.log('DEBUG_MERCHANT_RESULT:', JSON.stringify({
    count: result.length,
    sample: result.slice(0, 5)
  }, null, 2));

  return result || [];
}

function loadPreviousSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSnapshot(data) {
  const snapshot = {};
  data.forEach(item => {
    snapshot[item.merchant] = {
      stage: normalizeStage(item.stage),
      updatedAt: item.updatedAt || ''
    };
  });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function getStageCounts(data) {
  const counts = {};
  STAGES.forEach(stage => {
    counts[stage] = 0;
  });

  for (const item of data) {
    const stage = normalizeStage(item.stage);
    if (counts[stage] !== undefined) {
      counts[stage]++;
    }
  }

  return counts;
}

function getMovements(data, previousSnapshot) {
  const moved = [];

  for (const item of data) {
    const merchant = clean(item.merchant);
    const newStage = normalizeStage(item.stage);
    const previous = previousSnapshot[merchant];

    if (previous && previous.stage && previous.stage !== newStage) {
      moved.push({
        merchant,
        oldStage: previous.stage,
        newStage
      });
    }
  }

  return moved;
}

function getStageWiseGroups(data) {
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

  return grouped;
}

function buildMessage(data, previousSnapshot = {}) {
  const grouped = getStageWiseGroups(data);
  const counts = getStageCounts(data);
  const movements = getMovements(data, previousSnapshot);

  const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  const liveCount = grouped[LIVE_STAGE] ? grouped[LIVE_STAGE].length : 0;
  const deinstalledCount = grouped['🔌 Deinstalled'] ? grouped['🔌 Deinstalled'].length : 0;
  const onHoldCount = grouped['⏸️ On Hold'] ? grouped['⏸️ On Hold'].length : 0;
  const closedLostCount = grouped['❌ Closed Lost'] ? grouped['❌ Closed Lost'].length : 0;

  const activePipelineCount = total - liveCount - deinstalledCount - closedLostCount;
  const conversionBase = total - closedLostCount;
  const conversion = conversionBase > 0 ? ((liveCount / conversionBase) * 100).toFixed(1) : '0.0';

  let message = '📊 *OnePe Tracker – Sales Performance Update*\n\n';

  message += `*Total Merchants:* ${total}\n`;
  message += `*🚀 Go Live:* ${liveCount}\n`;
  message += `*⏳ Active Pipeline:* ${activePipelineCount}\n`;
  if (onHoldCount > 0) message += `*⏸️ On Hold:* ${onHoldCount}\n`;
  if (deinstalledCount > 0) message += `*🔌 Deinstalled:* ${deinstalledCount}\n`;
  if (closedLostCount > 0) message += `*❌ Closed Lost:* ${closedLostCount}\n`;
  message += `*📈 Conversion:* ${conversion}%\n\n`;

  message += '📌 *Stage Summary*\n';
  for (const stage of STAGES) {
    const count = counts[stage] || 0;
    if (count > 0) {
      message += `${stage}: ${count}\n`;
    }
  }

  message += '\n🔄 *Movement Since Last Run*\n';
  if (!movements.length) {
    message += '• No movement. Team needs push on pending pipeline.\n';
  } else {
    movements.slice(0, 20).forEach(item => {
      message += `• ${item.merchant}: ${item.oldStage} → ${item.newStage}\n`;
    });
  }

  message += '\n🔥 *Immediate Action Required*\n\n';

  let hasPriorityData = false;

  for (const stage of PRIORITY_STAGES) {
    const merchants = grouped[stage] || [];
    if (!merchants.length) continue;

    hasPriorityData = true;
    message += `*${stage} (${merchants.length})*\n`;
    merchants.forEach(name => {
      message += `• ${name}\n`;
    });
    message += '\n';
  }

  if (!hasPriorityData) {
    message += '• No pending action buckets.\n\n';
  }

  const earlyAccounts = EARLY_PIPELINE_STAGES.flatMap(stage => grouped[stage] || []);

  if (earlyAccounts.length) {
    message += '🧩 *Early Stage Pipeline*\n';
    EARLY_PIPELINE_STAGES.forEach(stage => {
      const merchants = grouped[stage] || [];
      if (!merchants.length) return;

      message += `*${stage} (${merchants.length})*\n`;
      merchants.forEach(name => {
        message += `• ${name}\n`;
      });
      message += '\n';
    });
  }

  const exceptionAccounts = EXCEPTION_STAGES.flatMap(stage => grouped[stage] || []);

  if (exceptionAccounts.length) {
    message += '⚠️ *Exception / Attention Buckets*\n';
    EXCEPTION_STAGES.forEach(stage => {
      const merchants = grouped[stage] || [];
      if (!merchants.length) return;

      message += `*${stage} (${merchants.length})*\n`;
      merchants.forEach(name => {
        message += `• ${name}\n`;
      });
      message += '\n';
    });
  }

  const liveList = grouped[LIVE_STAGE] || [];
  message += `🚀 *Go Live Accounts (${liveList.length})*\n`;
  if (!liveList.length) {
    message += '• No live accounts yet\n';
  } else {
    liveList.forEach(name => {
      message += `• ${name}\n`;
    });
  }

  message += '\n\n🎯 *Sales Focus:* Push active pipeline to next stage, revive on-hold accounts, and protect Go Live conversion.';

  return message.trim();
}

async function sendWhatsApp(message) {
  const url = `${API_URL}/waInstance${INSTANCE}/sendMessage/${TOKEN}`;
  const groupId = normalizeGroupId(GROUP_ID_RAW);

  const chatIds = [];
  if (PHONE) chatIds.push(`${PHONE}@c.us`);
  if (groupId) chatIds.push(groupId);

  for (const chatId of chatIds) {
    const response = await axios.post(
      url,
      {
        chatId,
        message
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );

    console.log(`WhatsApp sent to ${chatId}:`, response.data);
  }
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
        stage: normalizeStage(item.stage),
        updatedAt: item.updatedAt || ''
      }))
      .filter(item => item.merchant && item.stage && STAGES.includes(item.stage));

    if (!normalized.length) {
      throw new Error('Merchant data extracted, but merchant name or stage mapping did not match.');
    }

    const previousSnapshot = loadPreviousSnapshot();
    const message = buildMessage(normalized, previousSnapshot);

    console.log(message);

    await sendWhatsApp(message);
    saveSnapshot(normalized);

    console.log('WhatsApp message sent successfully.');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('Automation failed:', err);
  process.exit(1);
});
