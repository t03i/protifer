FROM alpine:3.19@sha256:b58899f069c47216f6002a6850143dc6fae0d35eb8b0df9300bbe6327b9c2171

RUN apk add --no-cache curl jq bash

COPY init.sh /init.sh
RUN chmod +x /init.sh

ENTRYPOINT ["/init.sh"]
