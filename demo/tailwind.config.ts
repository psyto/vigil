import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vigil: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          accent: "#6366f1",
          green: "#22c55e",
          red: "#ef4444",
          yellow: "#eab308",
          muted: "#64748b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
