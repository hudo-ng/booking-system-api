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
import devicesRouter from "./routes/devices";
import cronRouter from "./routes/cron";
import cardPaymentsRouter from "./routes/cardPayments.routes";
import googleRoutes from "./routes/google.routes";
import laserRoutes from "./routes/laser.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();

  // Listen for the 'finish' event which fires when the response has been sent
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;

    // Apply ANSI colors based on status code groups for fast monitoring
    let color = "\x1b[32m"; // Green for 200 OK
    if (status >= 500) {
      color = "\x1b[31m"; // Red for 500 Server Errors
    } else if (status >= 400) {
      color = "\x1b[33m"; // Yellow for 400 Bad Requests / 404 Not Found
    } else if (status >= 300) {
      color = "\x1b[36m"; // Cyan for 300 Redirects
    }
    const resetColor = "\x1b[0m";

    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${color}${status}${resetColor} (${duration}ms)`,
    );
  });

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
app.use("/devices", devicesRouter);
app.use("/cron", cronRouter);
app.use("/card-payments", cardPaymentsRouter);
app.use("/google", googleRoutes);
app.use("/laser", laserRoutes);
app.get("/", (req: Request, res: Response) => {
  res.send("Hello from express");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
