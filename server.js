const http = require("http");
const express = require("express");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { Server } = require("socket.io");

const connectDB = require("./config/db");
const initializeFirebase = require("./config/firebase");
const setupSocket = require("./sockets/socket");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

dotenv.config();

connectDB();
initializeFirebase();

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchesAllowedOrigin = (origin) => {
  if (corsOrigins.length === 0) {
    return true;
  }
  return corsOrigins.some((allowed) => {
    if (allowed === origin) {
      return true;
    }
    if (!allowed.includes("*")) {
      return false;
    }
    const pattern = `^${escapeRegex(allowed).replace(/\\\*/g, ".*")}$`;
    return new RegExp(pattern).test(origin);
  });
};

const corsOptions = {
  origin(origin, callback) {
    // Allow mobile apps / non-browser clients (no Origin header).
    if (!origin) {
      return callback(null, true);
    }

    if (matchesAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS policy: origin not allowed"));
  },
  credentials: true,
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "cyberlink-backend" });
});

// Legacy mobile-compatible endpoints.
app.use("/auth", require("./routes/authRoutes"));
app.use("/", require("./routes/legacyRoutes"));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/chats", require("./routes/chatRoutes"));

app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || matchesAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy: origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  },
  pingTimeout: 60000,
});

setupSocket(io);
app.set("io", io);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  // Keep startup logs explicit for PM2/Nginx deploys.
  console.log(`Cyberlink backend listening on port ${PORT}`);
});
