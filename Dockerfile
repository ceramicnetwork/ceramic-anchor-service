FROM node:16

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

RUN apt-get update && apt-get install -y netcat

WORKDIR /cas

COPY package.json package-lock.json /cas/

RUN npm ci

COPY . /cas

RUN npm run postinstall

RUN npm run build

EXPOSE 8081

CMD npm run start
