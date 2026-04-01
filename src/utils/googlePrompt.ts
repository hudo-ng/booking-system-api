import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const generateAIReply = async (reviewerName: string, starRating: number, comment: string) => {
  const prompt = `
    You are the manager of a professional tattoo and piercing studio. 
    Write a short, human-sounding response to a Google review.
    
    Customer: ${reviewerName}
    Rating: ${starRating}/5
    Review: "${comment}"
    
    TONE GUIDELINES BASED ON RATING:
    - 5 Stars: Be enthusiastic, grateful, and friendly.
    - 4 Stars: Be warm and appreciative.
    - 3 Stars: Be professional. Thank them for the feedback and ask how you could have made it a 5-star experience.
    - 1-2 Stars: Be deeply professional, calm, and apologetic. Do not be defensive. Ask them to contact the shop via email/phone to resolve the issue privately.

    GENERAL RULES:
    - Max 2 sentences.
    - No emojis. 
    - Mention specific details from their comment (e.g., if they mentioned a tattoo or a specific artist).
    - Avoid corporate jargon.
    
    Response:`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};