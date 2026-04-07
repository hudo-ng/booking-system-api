import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateAIReply = async (
  reviewerName: string,
  starRating: number,
  comment: string
) => {
  const prompt = `
    You are the manager of a professional tattoo and piercing studio. 
    Write a short, human-sounding response to a Google review.
    
    Customer: ${reviewerName}
    Rating: ${starRating}/5
    Review: "${comment}"
    
    TONE GUIDELINES:
    - 5 Stars: Enthusiastic and friendly.
    - 4 Stars: Warm and appreciative.
    - 1-3 Stars: Professional, calm, and apologetic. Ask them to contact the shop privately.

    RULES: Max 2 sentences. No emojis. Mention specific details if provided.
  `;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    return result.text?.trim() ?? null;
  } catch (error: any) {
    console.error("Gemini AI Error:", error.message);

    if (error.status === 404) {
      console.log("Attempting fallback to Gemini 3 Flash...");
      const fallback = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      return fallback.text?.trim() ?? null;
    }
    return null;
  }
};