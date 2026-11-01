FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY dashboard/ /app/dashboard/
EXPOSE 4000
CMD ["node", "src/server.js"]
