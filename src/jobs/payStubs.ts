import {
  sendWeeklyReceptionPaystub,
  sendZoePaystub,
  sendArtistPaystub,
  sendAllArtistPaystubs,
  sendPaystubArtistNicole,
} from "../controllers/auth.controller";

const createMockRes = () =>
  ({
    status: (code?: number) => ({
      json: (body?: unknown) => body,
      send: (body?: unknown) => body,
    }),
    json: (body?: unknown) => body,
    send: (body?: unknown) => body,
  }) as any;

const createMockReq = (query: Record<string, any> = {}) => ({ query }) as any;

export async function sendWeeklyReceptionPaystubJob() {
  try {
    const req = createMockReq();
    const res = createMockRes();

    await sendWeeklyReceptionPaystub(req, res);
    console.log("✅ Weekly reception paystub job completed successfully.");
  } catch (error) {
    console.error("❌ Error in weekly reception paystub job:", error);
  }
}

export async function sendZoePaystubJob() {
  try {
    const req = createMockReq();
    const res = createMockRes();

    await sendZoePaystub(req, res);
    console.log("✅ Zoe paystub job completed successfully.");
  } catch (error) {
    console.error("❌ Error in Zoe paystub job:", error);
  }
}

export async function sendArtistPaystubJob() {
  try {
    const req = createMockReq({
      artist_name: "Zoe",
      is_hourly_paid: "false",
      hourly_rate: "35",
      email: "canhducc@gmail.com",
    });
    const res = createMockRes();

    await sendArtistPaystub(req, res);
    console.log("✅ Artist paystub job completed successfully.");
  } catch (error) {
    console.error("❌ Error in artist paystub job:", error);
  }
}

export async function sendAllArtistPaystubsJob() {
  try {
    const req = createMockReq();
    const res = createMockRes();

    await sendAllArtistPaystubs(req, res);
    console.log("✅ All artist paystubs job completed successfully.");
  } catch (error) {
    console.error("❌ Error in all artist paystubs job:", error);
  }
}

export async function sendPaystubArtistNicoleJob() {
  try {
    const req = createMockReq({
      email: "nicole@example.com",
    });
    const res = createMockRes();

    await sendPaystubArtistNicole(req, res);
    console.log("✅ Nicole paystub job completed successfully.");
  } catch (error) {
    console.error("❌ Error in Nicole paystub job:", error);
  }
}


