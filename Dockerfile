FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev          # tsx runs the TypeScript directly, so dev dependencies are needed at runtime
COPY tsconfig.json openapi.yaml ./
COPY sql ./sql
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]
