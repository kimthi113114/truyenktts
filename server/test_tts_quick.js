import { EdgeTTS } from "node-edge-tts";
import fs from "fs";
import path from "path";
import os from "os";

async function testTTS() {
    console.log("Testing Edge TTS with updated tokens...");

    const tempFile = path.join(os.tmpdir(), `test_tts_${Date.now()}.mp3`);

    try {
        const tts = new EdgeTTS({
            voice: "vi-VN-NamMinhNeural",
            rate: "+0%",
            volume: "+0%"
        });

        await tts.ttsPromise("Xin chào, đây là bài test", tempFile);

        console.log("✅ SUCCESS! TTS generated successfully");
        console.log(`File saved to: ${tempFile}`);

        // Clean up
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
            console.log("Test file cleaned up");
        }

    } catch (err) {
        console.error("❌ FAILED:", err.message);
        if (err.message.includes("403")) {
            console.error("Still getting 403 error - tokens may need further update");
        }
    }
}

testTTS();
