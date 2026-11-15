# Local CLI:  docker build -t pr-sentinel .
#             git diff main | docker run -i -e ANTHROPIC_API_KEY pr-sentinel --diff -
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
USER node
ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
