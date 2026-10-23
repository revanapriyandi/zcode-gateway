FROM node:24.14-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
ENV HOST=0.0.0.0 PORT=8080 ZCODE_DATA_DIR=/data
EXPOSE 8080
CMD ["node","src/cli.ts","serve"]
