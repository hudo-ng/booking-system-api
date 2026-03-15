import { PrismaClient } from "@prisma/client";
import { syncAllArtistReviews } from "../controllers/sync.controller";

const prisma = new PrismaClient();

export async function testSync() {
  console.log("🔍 Checking for Owner in Database...");
  const owner = await prisma.user.findFirst({ where: { isOwner: true } });

  if (!owner) {
    console.error(
      "❌ No Owner found. Make sure you logged in via /auth/google on this laptop first!",
    );
    return;
  }

  console.log(`🚀 Starting sync for Owner: ${owner.email}`);
  try {
    await syncAllArtistReviews(owner.id);

    const count = await prisma.review.count();
    console.log(`✅ Success! Total reviews now in local DB: ${count}`);
  } catch (error) {
    console.error("❌ Sync failed during test:", error);
  } finally {
    await prisma.$disconnect();
  }
}
