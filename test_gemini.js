import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = "AIzaSyCGEsgAdYoK1fx9ng3avx66-DZxid4JXZo";
const genAI = new GoogleGenerativeAI(apiKey);

async function testModel() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = "Hello, are you working?";

        console.log("Testing model: gemini-2.0-flash");
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("Response:", text);
    } catch (error) {
        console.error("Error:", error.message);
    }
}

testModel();
