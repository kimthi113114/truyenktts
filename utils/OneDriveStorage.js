
import 'isomorphic-fetch';
import { Client } from '@microsoft/microsoft-graph-client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

class OneDriveStorage {
    constructor() {
        this.client = null;
        this.clientId = process.env.ONEDRIVE_CLIENT_ID;
        this.clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
        this.refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;

        this.accessToken = null;
        this.tokenExpiresAt = 0; // Timestamp when token expires

        // This is the link user provided. 
        // We can use it to find the Drive Item ID if we haven't stored it.
        // Or we can just search "root". 
        // Ideally, we search for the specific folder name or use the Sharing Link API.
        this.sharedFolderUrl = "https://1drv.ms/f/c/fc469f50946755f3/IgCyCYpG99RgSZsvx2WXAtb4AUicA22aXOpFBkBkGeQmeCQ?e=hi1kZo";
    }

    async initialize() {
        if (!this.refreshToken) {
            console.warn("⚠️ No Refresh Token found. API Sync disabled.");
            return false;
        }

        try {
            await this.refreshAccessToken();
            this.client = Client.init({
                authProvider: async (done) => {
                    // AUTO REFRESH TOKEN IF EXPIRED
                    if (Date.now() >= this.tokenExpiresAt) {
                        console.log("🔄 Access Token expired or missing. Refreshing...");
                        try {
                            await this.refreshAccessToken();
                        } catch (err) {
                            return done(err, null);
                        }
                    }
                    done(null, this.accessToken);
                }
            });
            console.log("✅ OneDrive Client Initialized");
            return true;
        } catch (e) {
            console.error("❌ Failed to init OneDrive:", e.message);
            return false;
        }
    }

    async refreshAccessToken() {
        console.log("🔄 Requesting new Access Token via Refresh Token...");

        if (!this.refreshToken) {
            throw new Error("No refresh token available");
        }

        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('grant_type', 'refresh_token');
        params.append('scope', 'Files.ReadWrite.All offline_access');
        params.append('refresh_token', this.refreshToken);
        if (this.clientSecret) {
            params.append('client_secret', this.clientSecret);
        }
        params.append('redirect_uri', 'http://localhost');

        try {
            const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                method: 'POST',
                body: params
            });

            const json = await response.json();

            if (json.error || !response.ok) {
                const errorMsg = json.error_description || json.error || JSON.stringify(json);
                console.error("❌ Token Refresh Error Response:", errorMsg);
                throw new Error(errorMsg);
            }

            if (!json.access_token) {
                console.error("❌ Token response missing access_token:", json);
                throw new Error("Token response missing access_token");
            }

            this.accessToken = json.access_token;

            // Calculate expiration (expires_in is usually in seconds)
            // Default to 1 hour if missing
            const expiresIn = json.expires_in ? parseInt(json.expires_in) : 3600;
            this.tokenExpiresAt = Date.now() + (expiresIn * 1000) - 60000; // Buffer 60s

            console.log(`✅ Access Token Refreshed! Expires in ${expiresIn}s.`);

            if (json.refresh_token) {
                // Optionally update local env with new refresh token if it rotates
                this.refreshToken = json.refresh_token;
            }
        } catch (err) {
            console.error("❌ Fatal Error refreshing token:", err.message);
            throw err;
        }
    }

    /**
     * Get the DriveItem ID for the Shared Folder using the encoded URL approach.
     * This allows us to access the specific folder user shared.
     */
    async getSharedFolderId() {
        // ENCODING RULE:
        // base64 -> replace / with _ and + with - -> remove trailing = -> prepend u!
        const buffer = Buffer.from(this.sharedFolderUrl);
        let base64 = buffer.toString('base64');
        base64 = base64.replace(/\//g, '_').replace(/\+/g, '-');
        while (base64.endsWith('=')) base64 = base64.slice(0, -1);
        const encoded = 'u!' + base64;

        try {
            const res = await this.client.api(`/shares/${encoded}/driveItem`).get();
            return {
                driveId: res.parentReference.driveId,
                id: res.id
            };
        } catch (e) {
            console.error("Error finding shared folder:");
            if (e.body) {
                // If it's a Graph Error object
                e.body.then(b => console.error(JSON.stringify(b, null, 2))).catch(() => console.error(e));
            } else {
                console.error(e);
            }
            return null;
        }
    }

    /**
     * List children of a folder
     */
    async listChildren(folderId, driveId) {
        if (!this.client) return [];
        try {
            // If driveId is provided, we must use /drives/{id}/items/{id}
            // If it's pure logic, we might use /me/drive... but this is a SHARED folder.
            // Best pattern for Shared: /drives/{remoteDriveId}/items/{itemId}/children

            let query = "";
            if (driveId) {
                query = `/drives/${driveId}/items/${folderId}/children`;
            } else {
                // Fallback to me/root if no shared info
                query = `/me/drive/root/children`;
            }

            const res = await this.client.api(query).get();
            return res.value; // Array of items
        } catch (e) {
            console.error("List children failed:", e.message);
            return [];
        }
    }

    /**
     * Get Direct Download URL for a specific file by name
     */
    async getFileByName(filename, parentId, driveId) {
        if (!this.client) return null;
        try {
            // We can list and find, or search. Listing is safer for precise match.
            const children = await this.listChildren(parentId, driveId);
            const file = children.find(c => c.name === filename);
            if (file) {
                return {
                    url: file['@microsoft.graph.downloadUrl'],
                    id: file.id
                };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Write content to a file (Overwrite)
     */
    async saveFile(filename, content, parentId, driveId) {
        if (!this.client) return { success: false };
        try {
            // To upload to a shared folder, we need the correct endpoint.
            // /drives/{driveId}/items/{parentId}:/filename:/content

            let endpoint = "";
            if (driveId && parentId) {
                endpoint = `/drives/${driveId}/items/${parentId}:/${filename}:/content`;
            } else {
                endpoint = `/me/drive/root:/${filename}:/content`;
            }

            await this.client.api(endpoint).put(content);
            console.log(`Saved ${filename} to OneDrive.`);
            return { success: true };
        } catch (e) {
            console.error("Save failed:", e.message);
            return { success: false, error: e.message };
        }
    }
}

export default new OneDriveStorage();
