FROM node:16 as base

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

FROM base as runner

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

WORKDIR /runner

COPY runner/package*.json runner/*.js ./

RUN npm install

WORKDIR /

COPY runner.sh .

CMD [ "./runner.sh" ]
