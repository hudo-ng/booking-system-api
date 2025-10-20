import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER!;

const client = twilio(accountSid, authToken);

// ✅ Function to send SMS
export const sendSMS = async (to: string, body: string) => {
  try {
    await client.messages.create({
      body,
      from: twilioPhone,
      to,
    });
    console.log(`SMS sent to ${to}`);
  } catch (error) {
    console.error("Failed to send SMS:", error);
  }
};
