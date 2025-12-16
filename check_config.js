
import onedrive from './utils/OneDriveStorage.js';

async function check() {
    console.log("Initializing...");
    const success = await onedrive.initialize();
    if (!success) return;

    // Get Folder ID
    const ids = await onedrive.getSharedFolderId();
    if (!ids) { console.log("Failed to get folder"); return; }

    // Look for kimthi.json
    console.log("Looking for kimthi.json...");
    const file = await onedrive.getFileByName("kimthi.json", ids.id, ids.driveId);

    if (file && file.url) {
        console.log("Found! Downloading content...");
        const res = await fetch(file.url);
        const text = await res.text();
        console.log("--- CONTENT ---");
        console.log(text);
        console.log("---------------");
    } else {
        console.log("kimthi.json not found.");
        // List children to see what is there
        const children = await onedrive.listChildren(ids.id, ids.driveId);
        console.log("Files found: " + children.map(c => c.name).join(", "));
    }
}

check();
