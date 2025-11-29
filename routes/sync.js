import express from 'express';
import { query } from '../db/index.js';

const router = express.Router();

// Save progress
router.post('/sync/save', async (req, res) => {
    const { key, data } = req.body;

    if (!key || !data) {
        return res.status(400).json({ error: "Key and data are required" });
    }

    try {
        const text = `
            INSERT INTO reading_progress (sync_key, data, last_updated)
            VALUES ($1, $2, NOW())
            ON CONFLICT (sync_key) 
            DO UPDATE SET data = $2, last_updated = NOW();
        `;
        await query(text, [key, data]);
        res.json({ success: true, message: "Saved successfully" });
    } catch (err) {
        console.error("Error saving progress:", err);
        res.status(500).json({ error: "Failed to save progress" });
    }
});

// Load progress
router.get('/sync/load/:key', async (req, res) => {
    const { key } = req.params;

    if (!key) {
        return res.status(400).json({ error: "Key is required" });
    }

    try {
        const text = 'SELECT data FROM reading_progress WHERE sync_key = $1';
        const result = await query(text, [key]);

        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0].data });
        } else {
            res.status(404).json({ error: "Key not found" });
        }
    } catch (err) {
        console.error("Error loading progress:", err);
        res.status(500).json({ error: "Failed to load progress" });
    }
});

export default router;
