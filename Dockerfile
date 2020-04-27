FROM node:10

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /ceramic-anchor-service

COPY package.json package-lock.json ./

RUN npm install

RUN npm run build

COPY build ./build

EXPOSE 8081

CMD npm run start
