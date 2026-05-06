import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateAIReply = async (
  reviewerName: string,
  starRating: number,
  comment: string,
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

export const generateBadReviewOptions = async (
  reviewerName: string,
  starRating: number,
  comment: string,
) => {
  const prompt = `
    You are a professional studio manager. Generate TWO response options for a ${starRating}-star review from ${reviewerName}: "${comment}".
    Return ONLY a JSON object: {"option1": "...", "option2": "..."}
  `;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const responseText = result.text?.trim() ?? "";

    const cleanedJson = responseText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanedJson);

    return {
      option1: parsed.option1 ?? null,
      option2: parsed.option2 ?? null,
    };
  } catch (error: any) {
    console.error("Gemini AI Error:", error.message);
    return null;
  }
};
