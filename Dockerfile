FROM node:10

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /ceramic-anchor-service

COPY . /ceramic-anchor-service

RUN npm install

RUN npm run postinstall

RUN npm run build

EXPOSE 8081

CMD npm run start
