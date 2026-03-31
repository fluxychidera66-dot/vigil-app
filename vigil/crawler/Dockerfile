FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
RUN npx playwright install chromium --with-deps

COPY . .
RUN npm run build

EXPOSE 3010
CMD ["node", "dist/index.js"]
