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

const app = express();
app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);

app.use("/appointments", appointmentRoutes);

app.use("/working-hours", workingHoursRoutes);

app.use("/availability", availabilityRoutes);

app.use("/time-off", timeOffRoutes);

app.use("/employee", bookingRoutes);

app.use("/employees", employeesRoutes);

app.get("/", (req: Request, res: Response) => {
  res.send("Hello from express");
});

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
