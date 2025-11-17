FROM node:18

# Install poppler-utils (Linux version of Poppler)
RUN apt-get update && apt-get install -y poppler-utils && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "server.js"]
