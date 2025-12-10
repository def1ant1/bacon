# Production-ready container that builds the widget + backend and boots the backend server.
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json tsconfig.json tsup.config.ts ./
COPY packages ./packages
COPY src ./src
COPY example ./example
COPY docs ./docs
RUN npm ci
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app /app
RUN apk add --no-cache wget
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:3001/healthz || exit 1
CMD ["node", "packages/bacon-backend/dist/server.cjs"]
