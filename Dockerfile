FROM node:19-slim AS build

RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get -qq install python3 make g++

ARG CODE_VERSION="00000"

ENV CODE_VERSION=${CODE_VERSION}

WORKDIR /cas

COPY package.json package-lock.json /cas/

COPY . /cas

RUN npm ci

RUN npm run postinstall

RUN npm run build

RUN npm prune --production

FROM node:19-slim AS slim

EXPOSE 8081

WORKDIR /cas

# copy from build image
COPY --from=build /cas/node_modules ./node_modules

CMD npm run start

FROM slim AS runner

RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get -qq install curl

ENV CAS_PATH=/cas

# For running on AWS ECS
ENV AWS_REGION=${AWS_REGION}
ENV AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
ENV AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
ENV AWS_ECS_CLUSTER=${AWS_ECS_CLUSTER}
ENV AWS_ECS_FAMILY=${AWS_ECS_FAMILY}

# Discord notifications about running ECS tasks
ENV DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
ENV CLOUDWATCH_LOG_BASE_URL=${CLOUDWATCH_LOG_BASE_URL}

WORKDIR /

ADD runner /runner

WORKDIR /runner
RUN npm install

WORKDIR /

COPY runner.sh .

CMD [ "./runner.sh" ]
