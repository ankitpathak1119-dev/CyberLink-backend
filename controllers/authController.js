const jwt = require("jsonwebtoken");
const User = require("../models/User");

function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function usernameToEmail(username) {
  return `${username}@cyberlink.local`;
}

async function register(req, res, next) {
  try {
    let { name, email, password, username } = req.body;

    // Legacy app sends username+password; map to modern schema.
    if (username && !email) {
      username = normalizeUsername(username);
      email = usernameToEmail(username);
      if (!name) {
        name = username;
      }
    }

    if (!name || !email || !password) {
      const error = new Error("name, email and password are required");
      error.statusCode = 400;
      throw error;
    }

    if (!process.env.JWT_SECRET) {
      const error = new Error("JWT_SECRET is not configured");
      error.statusCode = 500;
      throw error;
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedUsername = username ? normalizeUsername(username) : null;
    const existingByEmail = await User.findOne({ email: normalizedEmail }).select("_id");
    if (existingByEmail) {
      const error = new Error("Email already registered");
      error.statusCode = 409;
      throw error;
    }

    if (normalizedUsername) {
      const existingByUsername = await User.findOne({
        $or: [{ username: normalizedUsername }, { email: usernameToEmail(normalizedUsername) }],
      }).select("_id");
      if (existingByUsername) {
        const error = new Error("User ID already present. Choose a new User ID.");
        error.statusCode = 409;
        throw error;
      }
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      ...(normalizedUsername ? { username: normalizedUsername } : {}),
      password: String(password),
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const dupField = Object.keys(error.keyPattern || {})[0] || "";
      const mapped = new Error(
        dupField === "username"
          ? "User ID already present. Choose a new User ID."
          : "Email already registered"
      );
      mapped.statusCode = 409;
      return next(mapped);
    }
    next(error);
  }
}

async function login(req, res, next) {
  try {
    let { email, password, username } = req.body;

    if (username && !email) {
      username = normalizeUsername(username);
      email = usernameToEmail(username);
    }

    if (!email || !password) {
      const error = new Error("email and password are required");
      error.statusCode = 400;
      throw error;
    }

    if (!process.env.JWT_SECRET) {
      const error = new Error("JWT_SECRET is not configured");
      error.statusCode = 500;
      throw error;
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user =
      (await User.findOne({ email: normalizedEmail }).select("+password")) ||
      (username
        ? await User.findOne({ username: normalizeUsername(username) }).select("+password")
        : null);

    if (!user) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    const isPasswordValid = await user.comparePassword(String(password));
    if (!isPasswordValid) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      token,
      user: user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    res.status(200).json({
      success: true,
      user: req.user.toSafeObject(),
    });
  } catch (error) {
    next(error);
  }
}

async function checkUser(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    if (!username) {
      return res.status(400).json({ exists: false, error: "username is required" });
    }

    const user = await User.findOne({
      $or: [{ username }, { email: usernameToEmail(username) }],
    }).select("_id");

    res.status(200).json({ exists: Boolean(user) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
  me,
  checkUser,
};
