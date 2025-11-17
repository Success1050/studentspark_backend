FROM node:18-slim

# Install pdf2pic dependencies (GraphicsMagick + Ghostscript) and Poppler
RUN apt-get update && apt-get install -y \
    ghostscript \
    graphicsmagick \
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

# Verify installations
RUN pdftoppm -v && gm version && gs --version

EXPOSE 3000

CMD ["node", "server.js"]