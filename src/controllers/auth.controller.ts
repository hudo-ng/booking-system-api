import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config";

const prisma = new PrismaClient();

export const register = async (req: Request, res: Response) => {
  const { email, password, name, role, colour, start_price } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      name,
      role,
      colour,
      start_price,
      isAdmin: true,
      phone_number: "6471234567",
    },
  });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      userId: user.id,
      role: user.role,
      isAdmin: user.isAdmin,
      name: user.name,
      isOwner: user.isOwner,
    },
    config.jwtSecret,
    { expiresIn: "1y" }
  );

  res.json({ token: token, role: user.role, name: user.name });
};
