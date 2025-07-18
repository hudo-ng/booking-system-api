import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function seed() {
  const appt = await prisma.appointment.create({
    data: {
      employeeId: "04e20cba-aa91-4f90-b8e3-c70d0022578a",
      customerName: "Test User",
      email: "test@user.com",
      phone: "333-555-0100",
      detail: "Test booking",
    },
  });
  console.log("Created:", appt);
  await prisma.$disconnect();
}

seed();
