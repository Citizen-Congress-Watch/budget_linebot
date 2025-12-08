# syntax=docker/dockerfile:1
FROM node:18-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
