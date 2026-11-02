# API + relayer container (Render/Hugging Face Docker Space/any container host). Secrets are provided as runtime env vars, never baked in.
FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY src/lib/protocol.ts src/lib/money.ts src/lib/retry.ts ./src/lib/
COPY src/contracts ./src/contracts
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["bun", "server/index.ts"]
