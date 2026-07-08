module.exports = {
  apps: [
    {
      name: "cyberlink-backend",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
      },
    },
  ],
};
