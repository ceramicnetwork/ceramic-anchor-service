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

CMD npm run start

FROM base as runner

# For running on AWS ECS
ENV AWS_REGION=${AWS_REGION}
ENV AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
ENV AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
ENV AWS_ECS_CLUSTER=${AWS_ECS_CLUSTER}
ENV AWS_ECS_FAMILY=${AWS_ECS_FAMILY}

# Discord notifications about running ECS tasks
ENV DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
ENV CLOUDWATCH_LOG_BASE_URL=${CLOUDWATCH_LOG_BASE_URL}

WORKDIR /cas

COPY runner ./runner
COPY runner.sh ./
COPY entrypoint.sh ./
RUN chmod +x ./runner.sh ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
CMD [ "./runner.sh" ]
