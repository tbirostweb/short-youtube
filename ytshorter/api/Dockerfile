# --- api : Fastify sur Node LTS ---
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations

# Le volume média est monté ici, partagé avec le worker.
RUN mkdir -p /media && chown -R node:node /media /app
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
