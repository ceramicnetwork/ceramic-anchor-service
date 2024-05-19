FROM node:20 as base

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /cas

COPY package.json package-lock.json /cas/

COPY . /cas

RUN npm ci

RUN npm run postinstall

RUN npm run build

RUN npm install dd-trace --save

EXPOSE 8081

COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
CMD npm run start
