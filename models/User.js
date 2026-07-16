const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 40,
      match: [/^[a-z0-9_]+$/, "Username can contain only a-z, 0-9 and _"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    avatar: {
      type: String,
      default: "",
      trim: true,
    },
    bio: {
      type: String,
      default: "",
      trim: true,
      maxlength: 150,
    },
    recoveryPhrase: {
      type: String,
      default: "",
      trim: true,
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    publicKey: {
      type: String,
      default: "",
      trim: true,
    },
    contacts: {
      type: [String],
      default: [],
    },
    contactRequests: {
      type: [String],
      default: [],
    },
    pendingMessages: {
      type: [
        {
          from: { type: String, required: true, trim: true },
          to: { type: String, required: true, trim: true },
          message: { type: String, required: true, trim: true },
          messageId: { type: String, required: true, trim: true },
          timestamp: { type: Date, default: Date.now },
          type: {
            type: String,
            enum: ["private"],
            default: "private",
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

userSchema.pre("save", async function hashSensitiveFields(next) {
  const salt = await bcrypt.genSalt(10);

  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (this.isModified("recoveryPhrase") && this.recoveryPhrase && this.recoveryPhrase.length > 0) {
    this.recoveryPhrase = await bcrypt.hash(this.recoveryPhrase, salt);
  }

  next();
});

userSchema.methods.comparePassword = async function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

userSchema.methods.compareRecoveryPhrase = async function compareRecoveryPhrase(plainPhrase) {
  if (!this.recoveryPhrase) return false;
  return bcrypt.compare(plainPhrase, this.recoveryPhrase);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    username: this.username || "",
    avatar: this.avatar,
    bio: this.bio,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.index({ name: "text", email: "text", username: "text" });

module.exports = mongoose.model("User", userSchema);
