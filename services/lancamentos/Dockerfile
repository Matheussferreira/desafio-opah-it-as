FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --prefer-offline

COPY tsconfig.json ./
COPY jest.config.ts ./
COPY src ./src
COPY tests ./tests

RUN npm run build

CMD ["node", "dist/server.js"]
