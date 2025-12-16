
import onedrive from './utils/OneDriveStorage.js';

async function debug() {
    console.log("Initializing...");
    await onedrive.initialize();

    const ids = await onedrive.getSharedFolderId();
    console.log(`Checking folder: ${ids.driveId} / ${ids.id}`);

    console.log("\nListing Children...");
    const children = await onedrive.listChildren(ids.id, ids.driveId);

    console.log(`Found ${children.length} items:`);
    children.forEach(c => console.log(`- ${c.name} (${c.id})`));

    console.log("\nChecking specific file 'kimthi.json'...");
    const file = await onedrive.getFileByName("kimthi.json", ids.id, ids.driveId);

    if (file) {
        console.log("✅ File FOUND by getFileByName:", file.id);
    } else {
        console.log("❌ File NOT FOUND by getFileByName");
    }
}

debug();
