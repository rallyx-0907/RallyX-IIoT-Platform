FROM node:22.16.0-alpine
RUN apk add --no-cache chromium
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /workspace
CMD ["node", "--test", "tests/e2e/browser.test.mjs"]
