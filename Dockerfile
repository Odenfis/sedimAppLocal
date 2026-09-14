FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY --chown=node:node . .

# Expose the application port
EXPOSE 3000

# Start the application
USER node
CMD ["npm", "start"]
