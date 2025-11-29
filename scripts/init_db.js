import fs from 'fs';
import path from 'path';
import { query } from '../db/index.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDb() {
    try {
        const schemaPath = path.join(__dirname, '../db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        console.log("Running schema...");
        await query(schema);
        console.log("Database initialized successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Failed to initialize database:", err);
        process.exit(1);
    }
}

initDb();
