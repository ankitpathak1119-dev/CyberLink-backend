const mongoose = require("mongoose");

async function connectDB() {
  const { MONGO_URI } = process.env;

  if (!MONGO_URI) {
    console.error("MONGO_URI is missing in environment variables.");
    process.exit(1);
  }

  try {
    mongoose.set("strictQuery", true);
    const conn = await mongoose.connect(MONGO_URI);
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
