import { Request, Response } from "express";
import express from "express";
import cors from "cors";
import { config } from "./config";
import authRoutes from "./routes/auth.routes";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Hello from express");
});

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
