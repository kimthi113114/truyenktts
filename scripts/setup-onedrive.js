
import 'isomorphic-fetch';
import { Client } from '@microsoft/microsoft-graph-client';
import input from 'input'; // We installed this handling inputs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

// --- CONFIGURATION ---
// We will use a "Public Client" flow (Device Code or just Code with generic client)
// For personal accounts, we can use a standard client ID or ask user to register one.
// To make it easy, we really need the user to register an App in Azure.
// Redirect URI: http://localhost

console.log("\n🚀 OneDrive Setup Wizard 🚀\n");
console.log("To allow this server to Read/Write your OneDrive, you need to register a generic App.");
console.log("1. Go to https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade");
console.log("2. Click 'New registration'.");
console.log("3. Name: 'TruyenScanner' (or anything).");
console.log("4. Account type: 'Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)'.");
console.log("5. Redirect URI: select 'Web' and enter 'http://localhost'.");
console.log("6. Click Register.");
console.log("7. Copy the 'Application (client) ID'.\n");

async function run() {
    let clientId = process.env.ONEDRIVE_CLIENT_ID;
    let clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;

    if (!clientId) {
        clientId = await input.text('👉 Enter Application (client) ID:');
    }

    // For public clients (Personal Auth), secret is usually not needed if using implicit flow, 
    // but for 'Web' flow with 'code', we might need secret OR use PKCE.
    // Let's assume 'Web' app with secret for simplicity in Node, or 'Mobile/Desktop' without secret.
    // Recommendation: Use 'Mobile and desktop applications' platform in Azure for Node CLI.
    // BUT user selected WEB. Let's ask for secret just in case they made a Confidential Client.

    console.log("\nIf you created a 'Web' platform app, you need a Client Secret.");
    console.log("If you chose 'Mobile/Desktop' (Native), leave Secret blank.");
    if (!clientSecret) {
        clientSecret = await input.text('👉 Enter Client Secret (leave blank if Native app):');
    }

    // Scopes
    const scopes = ['Files.ReadWrite.All', 'offline_access', 'User.Read'];

    // Generate Auth URL
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=http://localhost&response_mode=query&scope=${scopes.join('%20')}`;

    console.log(`\n\n🔗 OPEN THIS LINK IN YOUR BROWSER:\n\n${authUrl}\n`);
    console.log("❗ Log in, accept permissions. You will be redirected to 'http://localhost/?code=...'");
    console.log("❗ It might show 'Site can't be reached' that is OKAY. Copy the 'code' parameter from the URL bar.");

    const code = await input.text('\n👉 Paste the CODE here:');

    // Exchange Code for Token
    console.log("\n🔄 Exchanging code for tokens...");

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('scope', scopes.join(' '));
    params.append('code', code);
    params.append('redirect_uri', 'http://localhost');
    params.append('grant_type', 'authorization_code');
    if (clientSecret) {
        params.append('client_secret', clientSecret);
    }

    try {
        const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            body: params
        });

        const json = await response.json();

        if (json.error) {
            console.error("❌ Error:", json.error, json.error_description);
            return;
        }

        console.log("✅ Success! Got Refresh Token.");
        const refresh_token = json.refresh_token;

        // Save to .env
        let envContent = "";
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }

        // Update variables
        const updates = {
            'ONEDRIVE_CLIENT_ID': clientId,
            'ONEDRIVE_CLIENT_SECRET': clientSecret,
            'ONEDRIVE_REFRESH_TOKEN': refresh_token
        };

        Object.keys(updates).forEach(key => {
            const regex = new RegExp(`^${key}=.*`, 'm');
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${key}=${updates[key]}`);
            } else {
                envContent += `\n${key}=${updates[key]}`;
            }
        });

        fs.writeFileSync(envPath, envContent);
        console.log("💾 Saved credentials to .env");
        console.log("\n🎉 You are ready! Restart your server.");

    } catch (e) {
        console.error("CRITICAL ERROR:", e);
    }
}

run();
