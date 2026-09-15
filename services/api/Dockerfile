FROM node:20-alpine

# Install dumb-init and openssl for proper PID1 signal handling and Prisma engine support
RUN apk add --no-cache dumb-init openssl

# Set working directory
WORKDIR /app

# Install dependencies first (layer cache optimization)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and Prisma schema
COPY . .

# Generate Prisma Client (does NOT need a database connection)
RUN npx prisma generate

# Create uploads directory for local storage fallback
RUN mkdir -p /app/uploads/temp_chunks

# Expose API port
EXPOSE 8000

# Use dumb-init as PID1 to handle signals properly
# Run migrate deploy then start server in entrypoint
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
