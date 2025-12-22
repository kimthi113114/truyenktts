import fs from "fs";

const apiKey = "AIzaSyCGEsgAdYoK1fx9ng3avx66-DZxid4JXZo";

async function listModels() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            fs.writeFileSync("models.json", JSON.stringify(data.models.map(i => i.name).filter(i => i.includes("gemini")), null, 2));
            console.log("Models written to models.json");
        } else {
            console.log("No models found or error:", data);
        }

    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
