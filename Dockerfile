# Use official Node.js LTS image (bây giờ là Node 20)
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package definition files and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --production

# Copy application source code
COPY . .

# Expose the port the app runs on (cổng 3001 được khai báo trong Dockerfile)
EXPOSE 3001

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["yarn", "start"]