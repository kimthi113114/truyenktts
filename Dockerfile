# Use Node.js 20 official image
FROM node:20

# Set working directory to project root
WORKDIR /app

# Copy package definition files
COPY package.json yarn.lock ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Copy patches folder (IMPORTANT: Must be before yarn install)
COPY patches ./patches

# Install dependencies (including devDependencies for build)
# This will automatically run patch-package via postinstall script
RUN yarn install

# Copy all source code
COPY . .

# Build the client application
RUN yarn build

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3002

# Expose the port the server listens on
EXPOSE 3002

# Change working directory to server for correct process.cwd() resolution
WORKDIR /app/server

# Start the server
CMD ["node", "index.js"]