FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/kylehild/actual-helpers"
LABEL org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production NODE_TLS_REJECT_UNAUTHORIZED=1 ACTUAL_HELPER_APP_DIR=/usr/src/app ACTUAL_HELPER_RETRY_DELAYS=60,300,900 ACTUAL_CACHE_DIR=/cache
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/app /cache /opt/homelab && chown -R node:node /usr/src/app /cache /opt/homelab
COPY --chown=node:node package.json package-lock.json ./
USER node
USER root
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && chown -R node:node /usr/src/app
USER node
RUN npm ci --omit=dev \
    && npm cache clean --force
USER root
RUN apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
USER node
COPY --chown=node:node *.js ./
COPY --chown=node:node run-helper.js /opt/homelab/run-helper.js
ENTRYPOINT ["node", "/opt/homelab/run-helper.js"]
CMD ["sync-banks.js"]

# Zillow/Selenium support is optional. The scheduled helpers do not need Chrome.
FROM runtime AS browser
USER root
ARG CHROME_VERSION
RUN test -n "$CHROME_VERSION" && test "$(uname -m)" = x86_64 \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends ca-certificates wget unzip libasound2 libatk-bridge2.0-0 libgtk-4-1 libnss3 xdg-utils \
    && wget -q -O /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
    && unzip -q /tmp/chrome.zip -d /opt \
    && ln -s /opt/chrome-linux64/chrome /usr/local/bin/chrome \
    && wget -q -O /tmp/driver.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip" \
    && unzip -j /tmp/driver.zip chromedriver-linux64/chromedriver -d /usr/local/bin \
    && rm -rf /var/lib/apt/lists/* /tmp/chrome.zip /tmp/driver.zip
USER node

FROM runtime AS default
