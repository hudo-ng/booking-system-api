import {ExpoPushMessage, Expo} from "expo-server-sdk";

const expo = new Expo();

export async function sendPushAsync(
  tokens: string[],
  message: { title: string; body: string; data?: Record<string, any> }
) {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) return [];

  const msgs: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    priority: "default",
  }));

  const chunks = expo.chunkPushNotifications(msgs);
  const results: any[] = [];

  for (const chunk of chunks) {
    try {
      const r = await expo.sendPushNotificationsAsync(chunk);
      results.push(...r);
    } catch (err) {
      console.error("Expo push send error:", err);
      results.push({ error: String(err) });
    }
  }
  return results;
}
