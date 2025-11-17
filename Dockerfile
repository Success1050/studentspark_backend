FROM node:18

# Install Poppler utilities and data
RUN apt-get update && apt-get install -y poppler-utils poppler-data && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "server.js"]
