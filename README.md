# OnePe Tracker Bot

This project:
1. Opens the Netlify tracker
2. Enters the PIN
3. Reads merchant stage details
4. Groups merchants by onboarding stage
5. Sends a WhatsApp message through Green API

## GitHub setup

### 1. Create a repository
Create a new GitHub repository and upload these files.

### 2. Add GitHub Secrets
In GitHub:
- Open your repository
- Go to **Settings** → **Secrets and variables** → **Actions**
- Click **New repository secret**
- Add these secrets:

- `TRACKER_URL` = `https://onepe-onboarding.netlify.app/`
- `TRACKER_PIN` = `2026`
- `GREEN_API_URL` = `https://7107.api.greenapi.com`
- `GREEN_INSTANCE_ID` = `7107580286`
- `GREEN_API_TOKEN` = your latest Green API token
- `WHATSAPP_NUMBER` = `919994496672`

### 3. Workflow file location
The workflow must be saved exactly here:

`.github/workflows/scheduler.yml`

### 4. First test
Go to **Actions** tab in GitHub and run the workflow manually using **workflow_dispatch**.

## Important
Since your Green API token was shared in chat, regenerate it before using this bot.
