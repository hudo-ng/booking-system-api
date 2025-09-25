import { Request, Response } from "express";
import express from "express";
import cors from "cors";
import { config } from "./config";
import authRoutes from "./routes/auth.routes";
import appointmentRoutes from "./routes/appointment.routes";
import workingHoursRoutes from "./routes/workingHours.routes";
import timeOffRoutes from "./routes/timeOff.routes";
import availabilityRoutes from "./routes/availability.routes";
import bookingRoutes from "./routes/booking.routes";
import employeesRoutes from "./routes/employees.routes";
import managementRoutes from "./routes/management.routes";
import workshiftRoutes from "./routes/workShift.routes";

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://hk-booking-system-api.onrender.com",
  "https://hk-booking.vercel.app/",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

app.options("*", cors());
app.use(cors());
app.use(express.json());

app.use((req: Request, res: Response, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use("/auth", authRoutes);
app.use("/appointments", appointmentRoutes);
app.use("/working-hours", workingHoursRoutes);
app.use("/availability", availabilityRoutes);
app.use("/time-off", timeOffRoutes);
app.use("/employee", bookingRoutes);
app.use("/employees", employeesRoutes);
app.use("/management", managementRoutes);
app.use("/work-shifts", workshiftRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Hello from express");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
