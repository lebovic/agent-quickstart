# Setting Up GitHub Integration

This guide explains how to configure GitHub integration for self-hosted deployments. The integration allows Claude Code instances to clone and push to GitHub repositories without exposing credentials inside the sandbox.

## Overview

The system uses a **GitHub App** for authentication:

1. You create a GitHub App for your deployment
2. Users install the app on their repositories
3. The git proxy generates short-lived tokens for each operation

## Step 1: Create a GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**

2. Fill in the basic info:
   - **GitHub App name**: Something unique like "YourOrg Agent Quickstart"
   - **Homepage URL**: Your deployment URL (e.g., `https://code.yourcompany.com`)

3. Configure callbacks:
   - **Callback URL**: `{YOUR_SERVER_URL}/api/auth/github/callback`
   - **Setup URL** (optional): Same as callback URL
   - **Webhook URL**: Leave blank (not used currently)
   - Uncheck **"Active"** under Webhooks

4. Set permissions (under "Repository permissions"):
   - **Contents**: Read & write
   - **Metadata**: Read-only (auto-selected)

5. Under "Where can this GitHub App be installed?":
   - **Only on this account** for testing
   - **Any account** for production multi-tenant deployments

6. Click **Create GitHub App**

## Step 2: Generate Credentials

After creating the app:

1. Note the **App ID** (displayed at the top)
2. Note the **Client ID** (under "About")
3. Generate a **Client Secret** (copy immediately - only shown once)
4. Generate a **Private Key** (downloads as `.pem` file)

## Step 3: Configure Environment Variables

Add to your `.env` file:

```bash
# Generate a random encryption secret (at least 32 characters)
ENCRYPTION_SECRET=$(openssl rand -base64 32)

# From GitHub App settings
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123def456
GITHUB_APP_CLIENT_SECRET=your-client-secret-here

# Private key - paste the contents of the .pem file
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...your key...
-----END RSA PRIVATE KEY-----"
```

**Tip**: Convert the `.pem` file to a single line with:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.private-key.pem
```

## Step 4: Seed the Database

```bash
npm run db:seed
```

## Step 5: Install the App on Repositories

1. Go to your GitHub App's public page (`https://github.com/apps/your-app-name`)
2. Click **Install**
3. Choose which repositories to grant access
4. You'll be redirected to the callback URL, which stores the installation ID

## Security Notes

- Private keys and client secrets are encrypted at rest using AES-256-GCM
- Installation tokens are short-lived (1 hour) and cached
- Sessions can only access repositories declared in their configuration
- Push operations are restricted to branches explicitly listed in outcomes
