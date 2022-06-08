FROM node:16

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /cas

COPY package.json package-lock.json /cas/

COPY . /cas

RUN npm ci

RUN npm run postinstall

RUN npm run build

EXPOSE 8081

CMD npm run start
