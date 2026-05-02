import { PrismaClient } from "@prisma/client";
import { syncAllArtistReviews, syncAllArtistReviews1 } from "../controllers/sync.controller";

const prisma = new PrismaClient();

export async function testSync() {
  console.log("🔍 Checking for Owner in Database...");
  const owner = await prisma.user.findFirst({
    where: { isOwner: true, id: "0ca37281-3084-4c3b-b9b2-fc0185c28108" },
  });

  if (!owner) {
    console.error(
      "❌ No Owner found. Make sure you logged in via /auth/google on this laptop first!",
    );
    return;
  }

  console.log(`🚀 Starting sync for Owner: ${owner.email}`);
  try {
    await syncAllArtistReviews1("0ca37281-3084-4c3b-b9b2-fc0185c28108");

    const count = await prisma.review.count();
    console.log(`✅ Success! Total reviews now in local DB: ${count}`);
  } catch (error) {
    console.error("❌ Sync failed during test:", error);
  } finally {
    await prisma.$disconnect();
  }
}
