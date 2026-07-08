const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function protect(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      const error = new Error("Not authorized: token missing");
      error.statusCode = 401;
      throw error;
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      const error = new Error("Not authorized: user not found");
      error.statusCode = 401;
      throw error;
    }

    req.user = user;
    next();
  } catch (error) {
    error.statusCode = error.statusCode || 401;
    next(error);
  }
}

module.exports = { protect };
