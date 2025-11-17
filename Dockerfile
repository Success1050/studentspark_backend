FROM node:18

# Install poppler-utils (required by pdf-poppler)
RUN apt-get update && apt-get install -y poppler-utils && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "server.js"]
