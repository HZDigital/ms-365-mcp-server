FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run generate
RUN npm run build

FROM node:24-alpine AS release

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production
ENV PORT=3000

RUN npm ci --ignore-scripts --omit=dev

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js", "--http", "0.0.0.0:3000", "--org-mode"]
