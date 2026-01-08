import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const indexHtmlPath = path.join(rootDir, 'public/index.html');
const listenHtmlPath = path.join(rootDir, 'public/listen.html');

// Helper to read JSON
function readPackageJson() {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

// Helper to Bump Version
function bumpVersion(currentVersion, type = 'patch') {
    let [major, minor, patch] = currentVersion.split('.').map(Number);

    if (type === 'major') {
        major++;
        minor = 0;
        patch = 0;
    } else if (type === 'minor') {
        minor++;
        patch = 0;
    } else {
        patch++;
    }

    return `${major}.${minor}.${patch}`;
}

// Update File Content Helper
function updateFile(filePath, regex, replacement) {
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ File not found: ${filePath}`);
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!regex.test(content)) {
        console.warn(`⚠️ Version pattern not found in: ${filePath}`);
        return;
    }
    const newContent = content.replace(regex, replacement);
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
}

// Main
try {
    const pkg = readPackageJson();
    const oldVersion = pkg.version;
    const type = process.argv[2] || 'patch'; // 'patch', 'minor', 'major'

    const newVersion = bumpVersion(oldVersion, type);
    console.log(`🚀 Bumping version: ${oldVersion} -> ${newVersion} (${type})`);

    // 1. Update package.json
    pkg.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Updated: package.json`);

    // 2. Update public/index.html (Matches "vX.Y.Z")
    updateFile(indexHtmlPath, /v\d+\.\d+\.\d+/g, `v${newVersion}`);

    // 3. Update public/listen.html (Matches "version X.Y.Z")
    updateFile(listenHtmlPath, /version \d+\.\d+\.\d+/g, `version ${newVersion}`);

} catch (err) {
    console.error('❌ Error bumping version:', err);
    process.exit(1);
}
