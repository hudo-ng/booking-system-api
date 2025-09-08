import { Request, Response, NextFunction } from "express";
import ipRangeCheck from "ip-range-check";

// Allowed WiFi ranges
const allowedIps = ["192.168.1.0/24", "10.0.0.0/16"];

export function validateIp(req: Request, res: Response, next: NextFunction) {
  const userIp = req.ip || req.connection.remoteAddress || "";

  if (ipRangeCheck(userIp, allowedIps)) {
    return next();
  }

  return res
    .status(403)
    .json({ message: "Not allowed to clock in from this location" });
}
