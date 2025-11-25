import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '../public/listen.html');

try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Regex to find version X.Y.Z
    const versionRegex = /version (\d+)\.(\d+)\.(\d+)/;
    const match = content.match(versionRegex);

    if (match) {
        let major = parseInt(match[1]);
        let minor = parseInt(match[2]);
        let patch = parseInt(match[3]);

        console.log(`Current version: ${major}.${minor}.${patch}`);

        // Increment logic
        patch++;
        if (patch > 9) {
            patch = 0;
            minor++;
            if (minor > 9) {
                minor = 0;
                major++;
            }
        }

        const newVersion = `${major}.${minor}.${patch}`;
        console.log(`New version: ${newVersion}`);

        const newContent = content.replace(versionRegex, `version ${newVersion}`);
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Version updated successfully.');
    } else {
        console.error('Version string not found in listen.html');
        process.exit(1);
    }
} catch (err) {
    console.error('Error updating version:', err);
    process.exit(1);
}
