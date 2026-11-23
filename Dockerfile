FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# openssl genera la CA local y el certificado HTTPS (Fase 81, generar-certificado.bat)
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Copy the rest of the application code
COPY --chown=node:node . .

# Expose the application port
EXPOSE 3000 3443

# Start the application
USER node
CMD ["npm", "start"]
