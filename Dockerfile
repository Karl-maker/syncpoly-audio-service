# Multi-stage Dockerfile for audio-service

# Stage 1: Build stage
FROM node:20-slim AS builder

# Install pnpm
RUN npm install -g pnpm@10.15.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including devDependencies for building)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript to JavaScript
RUN pnpm run build

# Stage 2: Runtime stage
FROM node:20-slim AS runtime

# Install ffmpeg and other required system dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm for production
RUN npm install -g pnpm@10.15.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy any other necessary files (e.g., if you have static files, configs, etc.)
# COPY --from=builder /app/.env.example ./.env.example  # Uncomment if needed

# Create a non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose the port (adjust if your app uses a different port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]




## install yt-dlp


