FROM node:18-slim

# Install Poppler and required dependencies
RUN apt-get update && apt-get install -y \
    poppler-utils \
    poppler-data \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Verify Poppler installation
RUN pdftoppm -v

EXPOSE 3000

CMD ["node", "server.js"]