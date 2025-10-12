import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";
import slugify from "slugify";
import { customAlphabet } from "nanoid";

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response) => {
  const { email, password, name, role, colour, start_price } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);
  const base = slugify(name || "user", { lower: true, strict: true }) || "user";
  const slug = `${base}-${nano()}`;
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      role,
      colour,
      start_price,
      isAdmin: false,
      phone_number: "6471234567",
      slug,
      isOwner: false,
      show_on_calendar_booking: false,
    },
  });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
};

export const login = async (req: Request, res: Response) => {
  const { email, password, deviceId } = req.body as {
    email: string;
    password: string;
    deviceId?: string;
  };
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isEmployee = (user.role as any) === "employee";
  if (isEmployee && deviceId && !user.currentDeviceId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { currentDeviceId: deviceId },
    });
  }

  if (
    isEmployee &&
    deviceId &&
    user.currentDeviceId &&
    user.currentDeviceId !== deviceId
  ) {
    return res.status(423).json({
      error: "DEVICE_LOCKED",
      message: "This device is not authorized.",
    });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      role: user.role,
      isAdmin: user.isAdmin,
      name: user.name,
      isOwner: user.isOwner,
      is_reception: user.is_reception,
      deviceId: deviceId ?? null,
    },
    config.jwtSecret,
    { expiresIn: "1y" }
  );

  const safeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    slug: user.slug,
  };

  res.json({ token: token, ...safeUser });
};

export const logInByIdToken = async (req: Request, res: Response) => {
  try {
    const { idToken, deviceId } = req.body as {
      idToken: string;
      deviceId?: string;
    };
    console.log("Received idToken:", idToken);
    if (!idToken) {
      return res.status(400).json({ message: "idToken is required" });
    }

    // 1️⃣ Verify the incoming token (the token should be signed with your server's secret)
    let decoded: any;
    try {
      decoded = jwt.verify(idToken, config.jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    // 2️⃣ Check if user exists in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isEmployee = (user.role as any) === "employee";
    if (user.role === "employee") {
      if (deviceId && !user.currentDeviceId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { currentDeviceId: deviceId },
        });
      }
      if (
        deviceId &&
        user.currentDeviceId &&
        user.currentDeviceId !== deviceId
      ) {
        return res.status(423).json({
          error: "DEVICE_LOCKED",
          message: "This device is not authorized.",
        });
      }
    }

    // 3️⃣ Generate a new access token for continued use
    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        isAdmin: user.isAdmin,
        name: user.name,
        isOwner: user.isOwner,
        is_reception: user.is_reception,
        deviceId: deviceId ?? null,
      },
      config.jwtSecret,
      { expiresIn: "1y" }
    );

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      slug: user.slug,
    };

    return res.json({ token, ...safeUser });
  } catch (error) {
    console.error("logInByIdToken error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
